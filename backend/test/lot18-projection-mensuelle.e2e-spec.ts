import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Round 4 (« ÉVOLUTION AVANT BUILD — PROJECTION GLOBALE MENSUELLE ») — vue mensuelle
 * consolidée (GET /projection/monthly, POST /projection/monthly/simulate), moteur
 * UNIQUE : monthly-projection.util.ts regroupe par mois les événements DÉJÀ calculés
 * par computeProjection (projection.util.ts, Lot 7/8) — aucun second moteur (§19).
 * Contrat API en snake_case (même convention que /projection, cf. ProjectionService.toApi).
 * Scénarios A à R du cahier des charges, un describe par lettre.
 */
describe('Round 4 — Projection Globale Mensuelle (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  const run = Date.now();
  let seq = 0;
  const REF = '2026-09-01'; // référence fixe pour tous les tests (déterministe)

  const mailer = new FakeMailer();
  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold() {
    seq += 1;
    const signupToken = await signupVerified(http, mailer, `lot18+${run}+${seq}@example.com`, 'password123', 'L18', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer Lot18 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function newAccount(auth: () => [string, string], name: string, initialBalance = 0, type: 'courant' | 'especes' = 'courant') {
    const res = await http.post('/accounts').set(...auth()).send({ name, type, initialBalance }).expect(201);
    return res.body.id as string;
  }

  async function newCategory(auth: () => [string, string], name: string, kind: 'income' | 'expense' | 'both' = 'expense') {
    const res = await http.post('/categories').set(...auth()).send({ name, kind }).expect(201);
    return res.body.id as string;
  }

  async function newDeadline(
    auth: () => [string, string],
    categoryId: string,
    label: string,
    dueDate: string,
    amount: number,
    opts: { obligationStatus?: string; financialPlanId?: string; defaultAccountId?: string; amountStatus?: 'estime' | 'confirme' | 'inconnu' } = {},
  ) {
    const cp = await http
      .post('/charge-plans')
      .set(...auth())
      .send({
        label,
        categoryId,
        generationMode: 'calendrier_manuel',
        startDate: '2026-01-01',
        obligationStatus: opts.obligationStatus,
        financialPlanId: opts.financialPlanId,
        defaultAccountId: opts.defaultAccountId,
      })
      .expect(201);
    const deadlineBody: Record<string, unknown> = { dueDate };
    if (opts.amountStatus === 'inconnu') {
      // Aucun montant fourni : reste amount_status=inconnu par défaut (RG-102/103).
    } else {
      deadlineBody.amountCurrent = amount;
      deadlineBody.amountStatus = opts.amountStatus ?? 'confirme';
    }
    const deadline = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send(deadlineBody).expect(201);
    return { chargePlanId: cp.body.id as string, deadlineId: deadline.body.id as string };
  }

  async function newIncome(auth: () => [string, string], accountId: string, label: string, amount: number, usualDate: string) {
    const source = await http
      .post('/income-sources')
      .set(...auth())
      .send({ label, usualAmount: amount, defaultAccountId: accountId, isRecurring: false })
      .expect(201);
    const occurrence = await http
      .post(`/income-sources/${source.body.id}/occurrences`)
      .set(...auth())
      .send({ usualDate, plannedAmount: amount })
      .expect(201);
    return { sourceId: source.body.id as string, occurrenceId: occurrence.body.id as string };
  }

  async function monthly(
    auth: () => [string, string],
    query: { horizonMonths?: number; incomeAccountIds?: string; expenseAccountIds?: string; at?: string } = {},
  ) {
    let qs = `at=${query.at ?? REF}`;
    if (query.horizonMonths) qs += `&horizonMonths=${query.horizonMonths}`;
    if (query.incomeAccountIds !== undefined) qs += `&incomeAccountIds=${query.incomeAccountIds}`;
    if (query.expenseAccountIds !== undefined) qs += `&expenseAccountIds=${query.expenseAccountIds}`;
    const res = await http.get(`/projection/monthly?${qs}`).set(...auth()).expect(200);
    return res.body;
  }

  function findMonth(body: any, month: string) {
    return body.months.find((m: any) => m.month === month);
  }

  describe('A — revenus 30 000 / dépenses 28 000 → balance +2 000', () => {
    it('calcule la balance mensuelle correcte', async () => {
      const { auth } = await newHousehold();
      const accIn = await newAccount(auth, 'Compte revenus');
      const accOut = await newAccount(auth, 'Compte dépenses');
      await newCategory(auth, 'Salaire', 'income');
      const catExp = await newCategory(auth, 'Dépenses A');
      await newIncome(auth, accIn, 'Salaire', 30000, '2026-09-10');
      await newDeadline(auth, catExp, 'Charges A', '2026-09-15', 28000, { defaultAccountId: accOut });

      const body = await monthly(auth);
      const sep = findMonth(body, '2026-09');
      expect(sep.total_income).toBe(30000);
      expect(sep.total_expense).toBe(28000);
      expect(sep.balance).toBe(2000);
    });
  });

  describe('B — revenus 30 000 / dépenses 35 000 → balance -5 000', () => {
    it('calcule un déficit mensuel correct', async () => {
      const { auth } = await newHousehold();
      const accIn = await newAccount(auth, 'Compte revenus');
      const accOut = await newAccount(auth, 'Compte dépenses');
      await newCategory(auth, 'Salaire', 'income');
      const catExp = await newCategory(auth, 'Dépenses B');
      await newIncome(auth, accIn, 'Salaire', 30000, '2026-11-05');
      await newDeadline(auth, catExp, 'Grosses charges', '2026-11-20', 35000, { defaultAccountId: accOut });

      const body = await monthly(auth);
      const nov = findMonth(body, '2026-11');
      expect(nov.total_income).toBe(30000);
      expect(nov.total_expense).toBe(35000);
      expect(nov.balance).toBe(-5000);
      expect(body.summary.deficit_months_count).toBe(1);
    });
  });

  describe('C — cumul +2k, +1k, -5k → cumul -2k', () => {
    it('calcule la balance cumulée correcte sur 3 mois consécutifs', async () => {
      const { auth } = await newHousehold();
      const accIn = await newAccount(auth, 'Compte revenus');
      const accOut = await newAccount(auth, 'Compte dépenses');
      await newCategory(auth, 'Salaire', 'income');
      const catExp = await newCategory(auth, 'Dépenses C');

      await newIncome(auth, accIn, 'Salaire sept', 30000, '2026-09-05');
      await newDeadline(auth, catExp, 'Charges sept', '2026-09-10', 28000, { defaultAccountId: accOut });

      await newIncome(auth, accIn, 'Salaire oct', 30000, '2026-10-05');
      await newDeadline(auth, catExp, 'Charges oct', '2026-10-10', 29000, { defaultAccountId: accOut });

      await newIncome(auth, accIn, 'Salaire nov', 30000, '2026-11-05');
      await newDeadline(auth, catExp, 'Charges nov', '2026-11-10', 35000, { defaultAccountId: accOut });

      const body = await monthly(auth, { horizonMonths: 3 });
      const sep = findMonth(body, '2026-09');
      const oct = findMonth(body, '2026-10');
      const nov = findMonth(body, '2026-11');
      expect(sep.cumulative_balance).toBe(2000);
      expect(oct.cumulative_balance).toBe(3000);
      expect(nov.cumulative_balance).toBe(-2000);
    });
  });

  describe('D — dépense réelle remplace correctement son prévu (aucun double comptage)', () => {
    it('une échéance intégralement payée dans le même mois reste comptée UNE SEULE FOIS (ni 0, ni doublée)', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte D', 10000);
      const catExp = await newCategory(auth, 'Dépenses D');
      const { deadlineId } = await newDeadline(auth, catExp, 'Facture D', '2026-09-15', 1000, { defaultAccountId: account });

      const before = await monthly(auth);
      expect(findMonth(before, '2026-09').total_expense).toBe(1000);

      await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 1000, accountId: account, paidDate: '2026-09-15' }).expect(201);

      const after = await monthly(auth);
      // Round 4bis §1 : RÉEL+PRÉVU = UNION, jamais une disparition ni un doublon — le
      // paiement réel (payeNet=1000, daté paidDate) REMPLACE le prévu (resteAPayer=0,
      // donc plus généré par computeProjection) : le mois reste à 1000, jamais 0 ni 2000.
      const sep = findMonth(after, '2026-09');
      expect(sep.total_expense).toBe(1000);
      const item = sep.expense_items.find((i: any) => i.label === 'Facture D');
      expect(item.realized).toBe(true);
      expect(item.amount).toBe(1000);
    });
  });

  describe('E — échéance d\'un FinancialPlan comptée une seule fois', () => {
    it('un ChargePlan rattaché à un FinancialPlan apparaît une seule fois dans le mois', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte E');
      const catExp = await newCategory(auth, 'Dépenses E');
      const plan = await http.post('/financial-plans').set(...auth()).send({ label: 'Plan École', periodStart: '2026-09-01', periodEnd: '2027-06-30' }).expect(201);
      await newDeadline(auth, catExp, 'Scolarité T1', '2026-09-20', 6000, { defaultAccountId: account, financialPlanId: plan.body.id });

      const body = await monthly(auth);
      const sep = findMonth(body, '2026-09');
      const matches = sep.expense_items.filter((i: any) => i.label === 'Scolarité T1');
      expect(matches).toHaveLength(1);
      expect(matches[0].amount).toBe(6000);
      expect(matches[0].category).toBe('projet');
    });
  });

  describe('F — enveloppe/provision : pas une dépense supplémentaire', () => {
    it('mettre de côté sur une Provision ne crée aucune ligne de dépense mensuelle propre', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte F', 5000);
      const catExp = await newCategory(auth, 'Dépenses F');
      const { deadlineId } = await newDeadline(auth, catExp, 'Facture F', '2026-09-25', 3000, { defaultAccountId: account });
      const provision = await http.post('/provisions').set(...auth()).send({ name: 'École F', allocationMode: 'virtual_allocation' }).expect(201);
      await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 3000, date: '2026-09-05' }).expect(201);
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId }).expect(201);

      const body = await monthly(auth);
      const sep = findMonth(body, '2026-09');
      // La Deadline reste la SEULE ligne de dépense (3000) — la contribution à la Provision
      // (mouvement de réserve, pas un flux physique) n'apparaît jamais séparément.
      expect(sep.expense_items).toHaveLength(1);
      expect(sep.total_expense).toBe(3000);
    });
  });

  describe('G — transfert interne : net zéro consolidé', () => {
    it('un transfert planifié entre deux comptes du foyer n\'apparaît ni en revenu ni en dépense', async () => {
      const { auth } = await newHousehold();
      const accA = await newAccount(auth, 'Compte G1', 5000);
      const accB = await newAccount(auth, 'Compte G2', 0);
      await http.post('/accounts/transfers').set(...auth()).send({ fromAccountId: accA, toAccountId: accB, amount: 1000, plannedDate: '2026-09-12' }).expect(201);

      const body = await monthly(auth);
      const sep = findMonth(body, '2026-09');
      expect(sep.total_income).toBe(0);
      expect(sep.total_expense).toBe(0);
      expect(sep.income_items).toHaveLength(0);
      expect(sep.expense_items).toHaveLength(0);
    });
  });

  describe('H — revenu réel : pas de double comptage avec prévu', () => {
    it('une occurrence confirmée reçue dans le même mois reste comptée UNE SEULE FOIS (ni 0, ni doublée)', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte H');
      const { occurrenceId } = await newIncome(auth, account, 'Salaire H', 15000, '2026-09-08');

      const before = await monthly(auth);
      expect(findMonth(before, '2026-09').total_income).toBe(15000);

      await http.post(`/income-occurrences/${occurrenceId}/confirm`).set(...auth()).send({ actualAmount: 15000, actualDate: '2026-09-08', accountId: account }).expect(201);

      const after = await monthly(auth);
      // Round 4bis §1/§3 : IncomeOccurrence bascule 'prevu' → 'recu' (jamais les deux), donc
      // le prévu disparaît de computeProjection MAIS le réel (actualAmount, actualDate) est
      // réintégré par la couche réelle — le mois reste à 15000, jamais 0.
      const sep = findMonth(after, '2026-09');
      expect(sep.total_income).toBe(15000);
      const item = sep.income_items.find((i: any) => i.label === 'Salaire H');
      expect(item.realized).toBe(true);
      expect(item.amount).toBe(15000);
    });
  });

  describe('I — montant inconnu : projection marquée incomplète', () => {
    it('une échéance à montant inconnu rend le mois incomplet sans jamais compter 0', async () => {
      const { auth } = await newHousehold();
      const catExp = await newCategory(auth, 'Dépenses I');
      await newDeadline(auth, catExp, 'Facture inconnue', '2026-09-18', 0, { amountStatus: 'inconnu' });

      const body = await monthly(auth);
      const sep = findMonth(body, '2026-09');
      expect(sep.is_complete).toBe(false);
      expect(sep.unknown_count).toBe(1);
      expect(sep.unknown_labels).toContain('Facture inconnue');
      expect(body.summary.is_complete).toBe(false);
    });
  });

  describe('J — filtre comptes : recalcul correct', () => {
    it('exclut les dépenses du compte non sélectionné et recalcule le total', async () => {
      const { auth } = await newHousehold();
      const accKept = await newAccount(auth, 'Compte gardé');
      const accExcluded = await newAccount(auth, 'Compte exclu');
      const catExp = await newCategory(auth, 'Dépenses J');
      await newDeadline(auth, catExp, 'Charge gardée', '2026-09-14', 1000, { defaultAccountId: accKept });
      await newDeadline(auth, catExp, 'Charge exclue', '2026-09-16', 500, { defaultAccountId: accExcluded });

      const all = await monthly(auth);
      expect(findMonth(all, '2026-09').total_expense).toBe(1500);

      const filtered = await monthly(auth, { expenseAccountIds: accKept });
      const sep = findMonth(filtered, '2026-09');
      expect(sep.total_expense).toBe(1000);
      expect(sep.excluded_by_filter_count).toBe(1);
      expect(sep.excluded_by_filter_total).toBe(500);
    });
  });

  describe('K — compte non déterminé : opération non perdue silencieusement', () => {
    it('un budget variable (sans compte propre) reste comptabilisé dans "Tous" et signalé quand filtré', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte K');
      const catExp = await newCategory(auth, 'Courses K');
      await http.post('/variable-budgets').set(...auth()).send({ categoryId: catExp, referenceAmount: 2000, referencePeriod: 'mois', startDate: '2026-09-01' }).expect(201);

      const all = await monthly(auth);
      const sepAll = findMonth(all, '2026-09');
      expect(sepAll.total_expense).toBeGreaterThan(0);

      const filtered = await monthly(auth, { expenseAccountIds: account });
      const sepFiltered = findMonth(filtered, '2026-09');
      // Jamais silencieusement disparu : exclu des totaux (compte non déterminé, pas sélectionné)
      // MAIS explicitement compté dans excluded_by_filter.
      expect(sepFiltered.total_expense).toBe(0);
      expect(sepFiltered.excluded_by_filter_count).toBeGreaterThan(0);
      expect(sepFiltered.excluded_by_filter_total).toBe(sepAll.total_expense);
    });
  });

  describe('L — déplacement simulé novembre → décembre recalcule les deux mois', () => {
    it('POST /projection/monthly/simulate déplace le montant du mois source au mois cible', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte L');
      const catExp = await newCategory(auth, 'Dépenses L');
      const { deadlineId } = await newDeadline(auth, catExp, 'PC', '2026-11-15', 8000, { defaultAccountId: account, obligationStatus: 'optionnelle_souscrite' });

      const res = await http
        .post('/projection/monthly/simulate')
        .set(...auth())
        .send({ at: REF, horizonMonths: 6, moves: [{ deadlineId, newDate: '2026-12-15' }] })
        .expect(201);

      const baseNov = findMonth(res.body.baseline, '2026-11');
      const baseDec = findMonth(res.body.baseline, '2026-12');
      const scenNov = findMonth(res.body.scenario, '2026-11');
      const scenDec = findMonth(res.body.scenario, '2026-12');

      expect(baseNov.total_expense).toBe(8000);
      expect(baseDec.total_expense).toBe(0);
      expect(scenNov.total_expense).toBe(0);
      expect(scenDec.total_expense).toBe(8000);
    });
  });

  describe('M — simulation : aucune donnée réelle modifiée', () => {
    it('la due_date réelle de la Deadline reste inchangée après simulation', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte M');
      const catExp = await newCategory(auth, 'Dépenses M');
      const { deadlineId } = await newDeadline(auth, catExp, 'Vélo', '2026-11-10', 4000, { defaultAccountId: account, obligationStatus: 'optionnelle_souscrite' });

      await http.post('/projection/monthly/simulate').set(...auth()).send({ at: REF, moves: [{ deadlineId, newDate: '2027-01-10' }] }).expect(201);

      const deadline = await http.get(`/deadlines/${deadlineId}`).set(...auth()).expect(200);
      expect(deadline.body.dueDate).toContain('2026-11-10');
    });
  });

  describe('N — modification réelle d\'une dépense flexible : nouvelle date persistée', () => {
    it('PATCH /deadlines/:id sur une échéance optionnelle_souscrite déplace réellement la date', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte N');
      const catExp = await newCategory(auth, 'Dépenses N');
      const { deadlineId } = await newDeadline(auth, catExp, 'Vélo N', '2026-11-10', 4000, { defaultAccountId: account, obligationStatus: 'optionnelle_souscrite' });

      const updated = await http.patch(`/deadlines/${deadlineId}`).set(...auth()).send({ dueDate: '2026-12-10' }).expect(200);
      expect(updated.body.dueDate).toContain('2026-12-10');

      const body = await monthly(auth);
      expect(findMonth(body, '2026-11').total_expense).toBe(0);
      expect(findMonth(body, '2026-12').total_expense).toBe(4000);
    });
  });

  describe('O — échéance contractuelle : simulation possible, vraie date inchangée', () => {
    it('PATCH /deadlines/:id refuse le déplacement réel d\'une échéance obligatoire (400)', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte O');
      const catExp = await newCategory(auth, 'Dépenses O');
      const { deadlineId } = await newDeadline(auth, catExp, 'Prêt immobilier', '2026-11-05', 8000, { defaultAccountId: account, obligationStatus: 'obligatoire' });

      await http.patch(`/deadlines/${deadlineId}`).set(...auth()).send({ dueDate: '2026-12-05' }).expect(400);

      const deadline = await http.get(`/deadlines/${deadlineId}`).set(...auth()).expect(200);
      expect(deadline.body.dueDate).toContain('2026-11-05');

      // La simulation, elle, reste possible pour une échéance contractuelle.
      const res = await http
        .post('/projection/monthly/simulate')
        .set(...auth())
        .send({ at: REF, moves: [{ deadlineId, newDate: '2026-12-05' }] })
        .expect(201);
      expect(findMonth(res.body.scenario, '2026-12').total_expense).toBe(8000);
    });
  });

  describe('P — horizon 3/6/12/24/36/60 mois : calcul correct', () => {
    it.each([3, 6, 12, 24, 36, 60])('horizonMonths=%i retourne exactement %i mois', async (h) => {
      const { auth } = await newHousehold();
      const body = await monthly(auth, { horizonMonths: h });
      expect(body.months).toHaveLength(h);
      expect(body.months[0].month).toBe('2026-09');
    });

    it('refuse une valeur d\'horizon non autorisée (400)', async () => {
      const { auth } = await newHousehold();
      await http.get(`/projection/monthly?at=${REF}&horizonMonths=13`).set(...auth()).expect(400);
    });
  });

  describe('Q — récurrences longues : absence de dérive de dates', () => {
    it('une charge mensuelle ancrée le 31 reste correctement clampée sur 60 mois, sans dérive', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte Q', 100000);
      const category = await newCategory(auth, 'Loyer Q');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({
          label: 'Loyer',
          categoryId: category,
          generationMode: 'auto_frequence',
          recurrenceRule: 'mensuel',
          startDate: '2026-01-31',
          defaultAccountId: account,
          obligationStatus: 'obligatoire',
        })
        .expect(201);
      // Une échéance confirmée sert de référence (RG-102/103) pour toutes les échéances
      // AUTO-générées suivantes — sans elle, amount_status resterait "inconnu" partout.
      await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-01-31', amountCurrent: 5000, amountStatus: 'confirme' })
        .expect(201);

      const body = await monthly(auth, { horizonMonths: 60 });
      // Février n'a pas de 31 : la charge doit apparaître le dernier jour de février (28/29),
      // jamais glisser sur mars — vérifié sur février 2027.
      const feb = findMonth(body, '2027-02');
      expect(feb.total_expense).toBeGreaterThan(0);
      expect(feb.expense_items[0].date).toBe('2027-02-28');
      // 60 mois de mensuel = 60 occurrences, chacune facturée exactement une fois : le total
      // sur l'horizon complet doit être cohérent, jamais un doublon ni un mois sauté.
      const monthsWithExpense = body.months.filter((m: any) => m.total_expense > 0);
      expect(monthsWithExpense).toHaveLength(60);
    });
  });

  describe('R — paiement/revenu déjà réel : cohérence avec accountId', () => {
    it('une échéance payée reste comptée une seule fois, filtrée sur le VRAI compte débité (celui du paiement réel)', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte R', 10000);
      const other = await newAccount(auth, 'Autre compte R');
      const catExp = await newCategory(auth, 'Dépenses R');
      const { deadlineId } = await newDeadline(auth, catExp, 'Facture R', '2026-09-12', 1500, { defaultAccountId: account });
      await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 1500, accountId: account, paidDate: '2026-09-12' }).expect(201);

      // Round 4bis §1/§9 : le paiement réel porte SON PROPRE accountId (celui réellement
      // débité) — le filtre-compte doit donc l'inclure sur le compte payé, et l'exclure
      // explicitement (jamais silencieusement) sur tout autre compte.
      const filteredOnPaidAccount = await monthly(auth, { expenseAccountIds: account });
      const filteredOnOtherAccount = await monthly(auth, { expenseAccountIds: other });
      expect(findMonth(filteredOnPaidAccount, '2026-09').total_expense).toBe(1500);
      const otherMonth = findMonth(filteredOnOtherAccount, '2026-09');
      expect(otherMonth.total_expense).toBe(0);
      expect(otherMonth.excluded_by_filter_count).toBe(1);
      expect(otherMonth.excluded_by_filter_total).toBe(1500);
    });
  });

  describe('S — salaire prévu reçu dans le même mois : union réel+prévu = montant unique', () => {
    it('salaire prévu 29 500 puis reçu 29 500 en septembre → total revenus septembre = 29 500 (ni 0 ni 59 000)', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte S');
      const { occurrenceId } = await newIncome(auth, account, 'Salaire S', 29500, '2026-09-05');

      await http
        .post(`/income-occurrences/${occurrenceId}/confirm`)
        .set(...auth())
        .send({ actualAmount: 29500, actualDate: '2026-09-05', accountId: account })
        .expect(201);

      const body = await monthly(auth);
      expect(findMonth(body, '2026-09').total_income).toBe(29500);
    });
  });

  describe('T — échéance prévue payée dans le même mois : union réel+prévu = montant unique', () => {
    it('échéance prévue 5 000 puis payée 5 000 en septembre → total dépenses septembre = 5 000 (ni 0 ni 10 000)', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte T', 10000);
      const catExp = await newCategory(auth, 'Dépenses T');
      const { deadlineId } = await newDeadline(auth, catExp, 'Facture T', '2026-09-15', 5000, { defaultAccountId: account });

      await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 5000, accountId: account, paidDate: '2026-09-15' }).expect(201);

      const body = await monthly(auth);
      expect(findMonth(body, '2026-09').total_expense).toBe(5000);
    });
  });

  describe('U — paiement partiel dans le même mois : réel + reste prévu = montant total, jamais deux fois', () => {
    it('échéance 10 000, payé 4 000 en septembre, reste 6 000 dû en septembre → total septembre = 10 000', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte U', 20000);
      const catExp = await newCategory(auth, 'Dépenses U');
      const { deadlineId } = await newDeadline(auth, catExp, 'Facture U', '2026-09-20', 10000, { defaultAccountId: account });

      await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 4000, accountId: account, paidDate: '2026-09-10' }).expect(201);

      const body = await monthly(auth);
      const sep = findMonth(body, '2026-09');
      expect(sep.total_expense).toBe(10000);
      const realItem = sep.expense_items.find((i: any) => i.realized === true);
      const prevuItem = sep.expense_items.find((i: any) => i.realized === false);
      expect(realItem.amount).toBe(4000);
      expect(prevuItem.amount).toBe(6000);
    });
  });

  describe('V — date réelle différente de la date prévue (dépense) : le réel compte dans SON mois réel', () => {
    it('échéance due le 30 septembre mais payée le 28 août → août contient le réel, septembre ne le contient plus', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte V', 20000);
      const catExp = await newCategory(auth, 'Dépenses V');
      const { deadlineId } = await newDeadline(auth, catExp, 'Facture V', '2026-09-30', 7000, { defaultAccountId: account });

      await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 7000, accountId: account, paidDate: '2026-08-28' }).expect(201);

      const body = await monthly(auth, { at: '2026-08-01', horizonMonths: 3 });
      const aug = findMonth(body, '2026-08');
      const sep = findMonth(body, '2026-09');
      expect(aug.total_expense).toBe(7000);
      const item = aug.expense_items.find((i: any) => i.label === 'Facture V');
      expect(item.realized).toBe(true);
      expect(item.date).toBe('2026-08-28');
      expect(sep.total_expense).toBe(0);
    });
  });

  describe('W — date réelle différente de la date prévue (revenu) : le réel compte dans SON mois réel', () => {
    it('revenu prévu le 10 septembre mais reçu le 28 août → août contient le réel, septembre ne contient plus le prévu', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte W');
      const { occurrenceId } = await newIncome(auth, account, 'Prime W', 12000, '2026-09-10');

      await http
        .post(`/income-occurrences/${occurrenceId}/confirm`)
        .set(...auth())
        .send({ actualAmount: 12000, actualDate: '2026-08-28', accountId: account })
        .expect(201);

      const body = await monthly(auth, { at: '2026-08-01', horizonMonths: 3 });
      const aug = findMonth(body, '2026-08');
      const sep = findMonth(body, '2026-09');
      expect(aug.total_income).toBe(12000);
      const item = aug.income_items.find((i: any) => i.label === 'Prime W');
      expect(item.realized).toBe(true);
      expect(item.date).toBe('2026-08-28');
      expect(sep.total_income).toBe(0);
    });
  });

  describe('X — besoin de financement temporaire suit la trésorerie projetée, jamais le cumul de flux seul', () => {
    it('trésorerie initiale 3 000, cumul au point bas -5 000 → trésorerie projetée -2 000 → besoin temporaire = 2 000 (pas 5 000)', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte X', 3000);
      const catExp = await newCategory(auth, 'Dépenses X');
      await newDeadline(auth, catExp, 'Grosse charge X', '2026-09-15', 5000, { defaultAccountId: account });

      const body = await monthly(auth, { horizonMonths: 3 });
      const sep = findMonth(body, '2026-09');
      expect(sep.cumulative_balance).toBe(-5000);
      expect(sep.projected_cash_balance).toBe(-2000);
      expect(body.summary.opening_cash_balance).toBe(3000);
      expect(body.summary.cash_low_point).toEqual({ month: '2026-09', value: -2000 });
      expect(body.summary.max_financing_need).toBe(2000);
    });
  });

  describe('Y — trésorerie initiale : règle d\'union explicite entre filtres Revenus et Dépenses', () => {
    it('un filtre "Tous" (non fourni) fait couvrir tous les comptes actifs ; deux filtres explicites font l\'union', async () => {
      const { auth } = await newHousehold();
      const accA = await newAccount(auth, 'Compte Y1', 1000);
      const accB = await newAccount(auth, 'Compte Y2', 2000);

      const incomeFilterOnly = await monthly(auth, { incomeAccountIds: accA }); // expenseAccountIds omis = "Tous"
      expect(incomeFilterOnly.summary.opening_cash_balance).toBe(3000);
      expect([...incomeFilterOnly.summary.treasury_account_ids].sort()).toEqual([accA, accB].sort());

      const bothFilteredOnA = await monthly(auth, { incomeAccountIds: accA, expenseAccountIds: accA });
      expect(bothFilteredOnA.summary.opening_cash_balance).toBe(1000);
      expect(bothFilteredOnA.summary.treasury_account_ids).toEqual([accA]);
    });
  });

  describe('Z — simulation : le déplacement recalcule aussi trésorerie projetée / point bas / besoin de financement', () => {
    it('déplacer une grosse charge de novembre à décembre déplace le creux de trésorerie, sans faire disparaître le besoin', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte Z', 4000);
      const catExp = await newCategory(auth, 'Dépenses Z');
      const { deadlineId } = await newDeadline(auth, catExp, 'PC Z', '2026-11-15', 9000, {
        defaultAccountId: account,
        obligationStatus: 'optionnelle_souscrite',
      });

      const res = await http
        .post('/projection/monthly/simulate')
        .set(...auth())
        .send({ at: REF, horizonMonths: 6, moves: [{ deadlineId, newDate: '2026-12-15' }] })
        .expect(201);

      const baseline = res.body.baseline;
      const scenario = res.body.scenario;
      // Baseline : trésorerie 4000 - 9000 = -5000 dès novembre → besoin temporaire 5000.
      expect(baseline.summary.max_financing_need).toBe(5000);
      expect(baseline.summary.cash_low_point.month).toBe('2026-11');

      // Scénario : la charge est décalée en décembre — le creux se déplace lui aussi,
      // preuve que le déplacement est réellement recalculé (jamais juste réaffiché) :
      // le besoin ne disparaît pas, il se DÉCALE (même montant, mois différent).
      expect(scenario.summary.cash_low_point.month).toBe('2026-12');
      expect(scenario.summary.max_financing_need).toBe(5000);
    });
  });
});
