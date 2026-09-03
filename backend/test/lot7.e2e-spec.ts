import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Tests Lot 7 — Moteur global de projection & trous de trésorerie (docs/02 G.6,
 * RG-051). Chaque scénario utilise un foyer dédié, la date de référence est
 * toujours injectée (`?at=`), jamais l'horloge système. TEST 7 ancre sa semaine
 * de test sur nextMondayUTC (toujours dans le futur réel) plutôt qu'un littéral
 * historique figé, pour qu'un mouvement du même jour calendaire que la création
 * du compte reste toujours postérieur à l'AccountBalanceSnapshot (horodaté à
 * l'instant réel de création, RG-080) — même précaution que test/lot5.e2e-spec.ts
 * TEST B.
 */
describe('Lot 7 — Moteur global de projection & trous de trésorerie (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let prisma: PrismaService;
  const run = Date.now();
  let seq = 0;

  const mailer = new FakeMailer();
  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold() {
    seq += 1;
    const signupToken = await signupVerified(http, mailer, `lot7+${run}+${seq}@example.com`, 'password123', 'L7', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer Lot7 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { accessToken, auth, householdId: household.body.household.id as string };
  }

  async function createAccount(auth: () => [string, string], name: string, initialBalance: number, includeInOperationalTreasury = true) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance, includeInOperationalTreasury }).expect(201);
    return res.body.id as string;
  }

  async function createChargePlanDeadline(auth: () => [string, string], label: string, deadline: { dueDate: string; amountCurrent?: number; amountStatus?: string }, obligationStatus?: string) {
    const cp = await http.post('/charge-plans').set(...auth()).send({ label, generationMode: 'calendrier_manuel', obligationStatus, startDate: '2020-01-01' }).expect(201);
    const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send(deadline).expect(201);
    return { chargePlanId: cp.body.id as string, deadlineId: d.body.id as string };
  }

  async function createIncome(auth: () => [string, string], accountId: string, usualDate: string, amount: number) {
    const source = await http.post('/income-sources').set(...auth()).send({ label: 'Revenu', usualAmount: amount, defaultAccountId: accountId }).expect(201);
    return http.post(`/income-sources/${source.body.id}/occurrences`).set(...auth()).send({ usualDate, plannedAmount: amount }).expect(201);
  }

  async function createProvision(auth: () => [string, string], body: Record<string, unknown>) {
    const res = await http.post('/provisions').set(...auth()).send(body).expect(201);
    return res.body.id as string;
  }

  async function getProjection(auth: () => [string, string], query: Record<string, string | number>) {
    return http.get('/projection').set(...auth()).query(query).expect(200);
  }

  /** Voir test/lot5.e2e-spec.ts (même helper, même raison — TEST B). */
  function nextMondayUTC(from: Date): Date {
    const base = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const isoDay = base.getUTCDay() === 0 ? 7 : base.getUTCDay(); // 1=lundi..7=dimanche
    base.setUTCDate(base.getUTCDate() + (8 - isoDay));
    return base;
  }

  function addDaysUTC(date: Date, days: number): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  // =========================================================
  // TEST 1 — projection physique simple avec revenu et Deadline (= oracle §28)
  // =========================================================
  it('TEST 1 / ORACLE revenu — physique suit exactement Deadline puis salaire, point bas à J+5', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 20000);
    await createChargePlanDeadline(h.auth, 'Charge', { dueDate: '2026-09-06', amountCurrent: 15000, amountStatus: 'confirme' });
    await createIncome(h.auth, await createAccount(h.auth, 'dummy', 0), '2026-09-11', 18000); // compte dédié au revenu, non utilisé ailleurs

    const proj = await getProjection(h.auth, { at: '2026-09-01', to: '2026-09-11' });
    expect(proj.body.opening_physical_treasury).toBe(20000);
    expect(proj.body.closing_physical_treasury).toBe(23000);
    expect(proj.body.physical_low_point).toBe(5000);
    expect(proj.body.physical_low_point_date).toContain('2026-09-06');
  });

  // =========================================================
  // TEST 2 — point bas exact
  // =========================================================
  it('TEST 2 — point bas physique exact et sa date, indépendamment de la clôture', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 30000);
    await createChargePlanDeadline(h.auth, 'Charge', { dueDate: '2026-09-16', amountCurrent: 18000, amountStatus: 'confirme' });
    const incomeAccount = await createAccount(h.auth, 'dummy2', 0);
    await createIncome(h.auth, incomeAccount, '2026-09-26', 8000);

    const proj = await getProjection(h.auth, { at: '2026-09-01', to: '2026-09-30' });
    expect(proj.body.physical_low_point).toBe(12000);
    expect(proj.body.physical_low_point_date).toContain('2026-09-16');
    expect(proj.body.closing_physical_treasury).toBe(20000);
  });

  // =========================================================
  // TEST 3 / ORACLE trou de trésorerie (= oracle §29)
  // =========================================================
  it('TEST 3 / ORACLE déficit — trou physique temporaire signalé même si le solde redevient positif', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 10000);
    await createChargePlanDeadline(h.auth, 'Charge', { dueDate: '2026-09-06', amountCurrent: 15000, amountStatus: 'confirme' });
    const incomeAccount = await createAccount(h.auth, 'dummy3', 0);
    await createIncome(h.auth, incomeAccount, '2026-09-11', 18000);

    const proj = await getProjection(h.auth, { at: '2026-09-01', to: '2026-09-11' });
    expect(proj.body.first_negative_date).toContain('2026-09-06');
    expect(proj.body.deficit_at_first_negative).toBe(-5000);
    expect(proj.body.physical_low_point).toBe(-5000);
    expect(proj.body.closing_physical_treasury).toBe(13000);
    expect(proj.body.status).toBe('DEFICIT_PHYSIQUE');
  });

  // =========================================================
  // TEST 4 / ORACLE capacité libre (= oracle §30)
  // =========================================================
  it('TEST 4 / ORACLE tension — une nouvelle réserve projetée rend la capacité libre négative sans toucher le physique', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 30000);
    await http.patch('/households/settings').set(...h.auth()).send({ securityMarginAmount: 10000 }).expect(200);
    const provisionId = await createProvision(h.auth, { name: 'Provision', allocationMode: 'virtual_allocation' });
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 10000 }).expect(201);
    // Échéance INDÉPENDANTE de la provision (aucune couverture) — 5000 d'engagé non couvert, distinct des 10000 réservés.
    await createChargePlanDeadline(h.auth, 'Échéance', { dueDate: '2026-09-20', amountCurrent: 5000, amountStatus: 'confirme' });

    // Nouvelle réserve planifiée +8000 le J+3, sans mouvement physique.
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 8000, date: '2026-09-04', confirmed: false }).expect(201);

    // Un seul appel, horizon couvrant tout le scénario (l'échéance du 20 doit rester visible).
    const proj = await getProjection(h.auth, { at: '2026-09-01', to: '2026-09-25' });
    expect(proj.body.opening_physical_treasury).toBe(30000);
    expect(proj.body.opening_free_capacity).toBe(5000); // 30000 - 10000(réservé) - 5000(engagé non couvert) - 10000(coussin)

    const day4 = proj.body.timeline.find((t: { date: string }) => t.date === '2026-09-04');
    expect(day4.physicalTreasury).toBe(30000); // physique inchangé
    expect(day4.freeCapacity).toBe(-3000); // 30000 - 18000(réservé) - 5000(engagé) - 10000(coussin)
    expect(proj.body.status).toBe('TENSION'); // jamais DEFICIT_PHYSIQUE : le physique reste positif
  });

  // =========================================================
  // TEST 5 / ORACLE revenu-déficit (= oracle §27, première partie) — virtual Provision
  // =========================================================
  it('TEST 5 — provision virtual_allocation : aucune double sortie physique au paiement futur', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 50000);
    await http.patch('/households/settings').set(...h.auth()).send({ securityMarginAmount: 10000 }).expect(200);
    const provisionId = await createProvision(h.auth, { name: 'Provision', allocationMode: 'virtual_allocation' });
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 12000 }).expect(201);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'Échéance', { dueDate: '2026-09-11', amountCurrent: 20000, amountStatus: 'confirme' });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId }).expect(201);

    const proj = await getProjection(h.auth, { at: '2026-09-01', to: '2026-09-20' });
    expect(proj.body.opening_physical_treasury).toBe(50000);
    expect(proj.body.opening_free_capacity).toBe(20000); // 50000 - 12000 - 8000 - 10000, oracle §27 "avant paiement"
    expect(proj.body.closing_physical_treasury).toBe(30000); // jamais 50000-12000-20000=18000
  });

  // =========================================================
  // TEST 6 — backed Provision : utilisation correcte du compte physique
  // =========================================================
  it('TEST 6 — provision backed_by_account : seule la part non couverte quitte la trésorerie opérationnelle', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte opérationnel', 38000, true);
    const dedicatedId = await createAccount(h.auth, 'Compte dédié École', 12000, false);
    const provisionId = await createProvision(h.auth, { name: 'Provision École', allocationMode: 'backed_by_account', linkedAccountId: dedicatedId });
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'École', { dueDate: '2026-09-11', amountCurrent: 20000, amountStatus: 'confirme' });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId }).expect(201);

    const proj = await getProjection(h.auth, { at: '2026-09-01', to: '2026-09-15' });
    expect(proj.body.opening_physical_treasury).toBe(38000);
    expect(proj.body.closing_physical_treasury).toBe(30000); // 38000 - (20000-12000) = 30000, jamais 38000-20000=18000
  });

  // =========================================================
  // TEST 7 — BudgetExpense passée jamais reprojetée (IF-13)
  // =========================================================
  it('TEST 7 — une dépense déjà enregistrée (dans le solde réel) n\'est jamais reprojetée', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 20000);
    const category = await http.post('/categories').set(...h.auth()).send({ name: 'Courses L7', kind: 'expense' }).expect(201);
    await http.post('/variable-budgets').set(...h.auth()).send({ categoryId: category.body.id, referenceAmount: 1500, referencePeriod: 'semaine', startDate: '2020-01-01' }).expect(201);

    // Semaine ancrée sur nextMondayUTC (toujours dans le futur réel) — voir commentaire du helper.
    // Mercredi = 3e jour (lundi = jour 1), même construction que test/lot5.e2e-spec.ts TEST B.
    const weekStart = nextMondayUTC(new Date());
    const wednesday = addDaysUTC(weekStart, 2);
    const sunday = addDaysUTC(weekStart, 6);
    await http.post('/expenses').set(...h.auth()).send({ amount: 600, accountId, categoryId: category.body.id, spentDate: wednesday.toISOString() }).expect(201);

    const proj = await getProjection(h.auth, { at: isoDate(wednesday), to: isoDate(sunday) });
    // Solde réel déjà à 19400 (20000-600) — la projection ne doit soustraire QUE le restant (900).
    expect(proj.body.opening_physical_treasury).toBe(19400);
    expect(proj.body.closing_physical_treasury).toBe(18500); // 19400 - 900, jamais 19400-1500 ni 19400-2100
  });

  // =========================================================
  // TEST 8 — Projection_prudente_restante intégrée une seule fois, sur plusieurs semaines
  // =========================================================
  it('TEST 8 — plusieurs semaines calendaires réelles, aucune fenêtre glissante ni double intégration', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 100000);
    const category = await http.post('/categories').set(...h.auth()).send({ name: 'Courses L7b', kind: 'expense' }).expect(201);
    await http.post('/variable-budgets').set(...h.auth()).send({ categoryId: category.body.id, referenceAmount: 1400, referencePeriod: 'semaine', startDate: '2020-01-01' }).expect(201);

    const proj = await getProjection(h.auth, { at: '2026-09-02', to: '2026-09-21' });
    // Même fenêtre exacte que Lot 5 TEST C : 1400(courante) + 1400 + 1400 + 200(prorata) = 4400.
    expect(proj.body.opening_physical_treasury).toBe(100000);
    expect(proj.body.closing_physical_treasury).toBe(95600);
  });

  // =========================================================
  // TEST 9 — revenu déjà reçu jamais ajouté à nouveau
  // =========================================================
  it("TEST 9 — un revenu déjà reçu est dans le solde réel, jamais réinjecté dans la projection", async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 0);
    const source = await http.post('/income-sources').set(...h.auth()).send({ label: 'Salaire', usualAmount: 5000, defaultAccountId: accountId }).expect(201);
    const occ = await http.post(`/income-sources/${source.body.id}/occurrences`).set(...h.auth()).send({ usualDate: '2026-09-01' }).expect(201);
    await http.post(`/income-occurrences/${occ.body.id}/confirm`).set(...h.auth()).send({ actualAmount: 5000, accountId }).expect(201);

    const proj = await getProjection(h.auth, { at: '2026-09-02', to: '2026-09-10' });
    expect(proj.body.opening_physical_treasury).toBe(5000); // déjà dans le solde réel
    expect(proj.body.closing_physical_treasury).toBe(5000); // jamais 10000
  });

  // =========================================================
  // TEST 10 — Deadline partiellement payée : seulement reste_a_payer projeté
  // =========================================================
  it('TEST 10 — une échéance partiellement payée ne projette que son reste_a_payer', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 50000);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'Charge', { dueDate: '2026-09-15', amountCurrent: 20000, amountStatus: 'confirme' });
    await http.post(`/deadlines/${deadlineId}/payments`).set(...h.auth()).send({ amount: 12000, accountId }).expect(201);

    const proj = await getProjection(h.auth, { at: '2026-09-02', to: '2026-09-20' });
    expect(proj.body.opening_physical_treasury).toBe(38000); // déjà net du paiement réel
    expect(proj.body.closing_physical_treasury).toBe(30000); // 38000 - 8000(reste), jamais -20000
  });

  // =========================================================
  // TEST 11 — montant estimé intégré + contains_estimates
  // =========================================================
  it('TEST 11 — un montant estimé est intégré numériquement et signale contains_estimates', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 50000);
    await createChargePlanDeadline(h.auth, 'Charge estimée', { dueDate: '2026-09-15', amountCurrent: 5000, amountStatus: 'estime' });

    const proj = await getProjection(h.auth, { at: '2026-09-02', to: '2026-09-20' });
    expect(proj.body.contains_estimates).toBe(true);
    expect(proj.body.closing_physical_treasury).toBe(45000);
  });

  // =========================================================
  // TEST 12 — montant inconnu : unknown_events_count + is_complete=false
  // =========================================================
  it("TEST 12 — un montant inconnu n'est jamais traité comme 0, jamais une fausse certitude", async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 50000);
    await createChargePlanDeadline(h.auth, 'Charge inconnue', { dueDate: '2026-09-15', amountStatus: 'inconnu' });

    const proj = await getProjection(h.auth, { at: '2026-09-02', to: '2026-09-20' });
    expect(proj.body.unknown_events_count).toBe(1);
    expect(proj.body.is_complete).toBe(false);
    expect(proj.body.status).toBe('INCOMPLETE');
    expect(proj.body.closing_physical_treasury).toBe(50000); // jamais compté 0 ni exclu silencieusement du signalement
  });

  // =========================================================
  // TEST 13 — option envisagée hors courbe principale
  // =========================================================
  it("TEST 13 — une charge optionnelle envisagée reste hors de la courbe certaine, comptée séparément", async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 50000);
    await createChargePlanDeadline(h.auth, 'Garderie envisagée', { dueDate: '2026-09-15', amountCurrent: 3000, amountStatus: 'confirme' }, 'optionnelle_envisagee');

    const proj = await getProjection(h.auth, { at: '2026-09-02', to: '2026-09-20' });
    expect(proj.body.closing_physical_treasury).toBe(50000); // jamais soustraite de la courbe certaine
    expect(proj.body.envisaged_events_total).toBe(3000);
  });

  // =========================================================
  // TEST 14 — transfert opérationnel → opérationnel : trésorerie totale inchangée
  // =========================================================
  it('TEST 14 — un transfert entre deux comptes opérationnels laisse la trésorerie opérationnelle totale inchangée', async () => {
    const h = await newHousehold();
    const accountA = await createAccount(h.auth, 'Compte A', 30000, true);
    const accountB = await createAccount(h.auth, 'Compte B', 5000, true);
    await http.post('/accounts/transfers').set(...h.auth()).send({ fromAccountId: accountA, toAccountId: accountB, amount: 4000, plannedDate: '2026-09-10' }).expect(201);

    const proj = await getProjection(h.auth, { at: '2026-09-02', to: '2026-09-15' });
    expect(proj.body.opening_physical_treasury).toBe(35000);
    expect(proj.body.closing_physical_treasury).toBe(35000); // net zéro : la sortie d'un compte opérationnel annule l'entrée sur l'autre
  });

  // =========================================================
  // TEST 15 — transfert opérationnel → non opérationnel : trésorerie opérationnelle diminue
  // =========================================================
  it('TEST 15 — un transfert vers un compte non opérationnel diminue la trésorerie opérationnelle projetée', async () => {
    const h = await newHousehold();
    const accountA = await createAccount(h.auth, 'Compte A', 30000, true);
    const savings = await createAccount(h.auth, 'Épargne', 0, false);
    await http.post('/accounts/transfers').set(...h.auth()).send({ fromAccountId: accountA, toAccountId: savings, amount: 4000, plannedDate: '2026-09-10' }).expect(201);

    const proj = await getProjection(h.auth, { at: '2026-09-02', to: '2026-09-15' });
    expect(proj.body.opening_physical_treasury).toBe(30000);
    expect(proj.body.closing_physical_treasury).toBe(26000);
  });

  // =========================================================
  // TEST 16 — contribution virtuelle planifiée : physique inchangé, réserve ↑, capacité ↓
  // =========================================================
  it('TEST 16 — une contribution virtuelle planifiée augmente la réserve projetée sans toucher le physique', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 20000);
    const pocketId = (await http.post('/pockets').set(...h.auth()).send({ name: 'Poche', allocationMode: 'virtual_allocation' }).expect(201)).body.id;
    await http.post(`/pockets/${pocketId}/contribute`).set(...h.auth()).send({ amount: 3000, date: '2026-09-10', confirmed: false }).expect(201);

    const proj = await getProjection(h.auth, { at: '2026-09-02', to: '2026-09-15' });
    const day10 = proj.body.timeline.find((t: { date: string }) => t.date === '2026-09-10');
    expect(day10.physicalTreasury).toBe(20000);
    expect(day10.reservedAmount).toBe(3000);
    expect(day10.freeCapacity).toBe(17000);
  });

  // =========================================================
  // TEST 17 — coussin : impact capacité libre uniquement
  // =========================================================
  it('TEST 17 — le coussin de sécurité ne touche jamais la courbe physique, uniquement la capacité libre', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 20000);
    await http.patch('/households/settings').set(...h.auth()).send({ securityMarginAmount: 6000 }).expect(200);

    const proj = await getProjection(h.auth, { at: '2026-09-02', to: '2026-09-05' });
    expect(proj.body.opening_physical_treasury).toBe(20000);
    expect(proj.body.opening_free_capacity).toBe(14000); // 20000 - 0 - 0 - 6000
  });

  // =========================================================
  // TEST 18 — horizon 7/30/60/90 : moteur unique, résultats déterministes
  // =========================================================
  it('TEST 18 — un seul moteur pour tous les horizons, résultats stables et déterministes', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 20000);
    await createChargePlanDeadline(h.auth, 'Charge', { dueDate: '2026-09-05', amountCurrent: 3000, amountStatus: 'confirme' });

    const results = await Promise.all([7, 30, 60, 90].map((horizon) => getProjection(h.auth, { at: '2026-09-02', horizon })));
    for (const r of results) {
      expect(r.body.closing_physical_treasury).toBe(17000);
    }
    const again = await getProjection(h.auth, { at: '2026-09-02', horizon: 30 });
    expect(again.body.closing_physical_treasury).toBe(results[1].body.closing_physical_treasury); // déterministe
  });

  // =========================================================
  // TEST 19 — vrais mois calendaires (§35 : aucune approximation 30/31 jours)
  // =========================================================
  it('TEST 19 — un budget mensuel traverse septembre/octobre/novembre avec les vrais jours calendaires', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 100000);
    const category = await http.post('/categories').set(...h.auth()).send({ name: 'Loyer L7', kind: 'expense' }).expect(201);
    // 3100 DH/mois : un montant qui révélerait immédiatement une approximation 30 jours (3100/30 ≈ 103,33/j)
    // si le moteur ne respectait pas les vrais jours de chaque mois (30 en septembre, 31 en octobre).
    await http.post('/variable-budgets').set(...h.auth()).send({ categoryId: category.body.id, referenceAmount: 3100, referencePeriod: 'mois', startDate: '2020-01-01' }).expect(201);

    // Fenêtre couvrant exactement le mois d'octobre complet (31 jours) : doit valoir 3100 pile, jamais 3100×31/30.
    const proj = await getProjection(h.auth, { at: '2026-10-01', to: '2026-10-31' });
    expect(proj.body.opening_physical_treasury).toBe(100000);
    expect(proj.body.closing_physical_treasury).toBe(96900); // 100000 - 3100 exactement, un mois calendaire complet
  });

  // =========================================================
  // TEST 20 — isolation RLS
  // =========================================================
  it("TEST 20 — la projection du foyer B ne reflète jamais les données du foyer A", async () => {
    const a = await newHousehold();
    await createAccount(a.auth, 'Compte A', 500000);
    await createChargePlanDeadline(a.auth, 'Charge A', { dueDate: '2026-09-15', amountCurrent: 300000, amountStatus: 'confirme' });

    const b = await newHousehold();
    const proj = await getProjection(b.auth, { at: '2026-09-02', to: '2026-09-20' });
    expect(proj.body.opening_physical_treasury).toBe(0);
    expect(proj.body.closing_physical_treasury).toBe(0);
  });

  // =========================================================
  // ORACLE DOC06 §5 — provision virtuelle : impact physique TOUJOURS le montant total
  // =========================================================
  it("ORACLE DOC06 §5 — « la provision étant virtuelle et non un compte séparé », impact réel = -20000 dans tous les cas", async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte courant', 40000);
    const provisionId = await createProvision(h.auth, { name: 'Provision Scolarité', allocationMode: 'virtual_allocation' });
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 17000 }).expect(201);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'D-S3', { dueDate: '2026-09-15', amountCurrent: 20000, amountStatus: 'confirme' });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId }).expect(201);

    const proj = await getProjection(h.auth, { at: '2026-09-02', to: '2026-09-20' });
    expect(proj.body.closing_physical_treasury).toBe(20000); // 40000 - 20000 exactement, jamais 40000-3000(non couvert seul)
  });
});
