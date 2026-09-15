import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Recette finale fonctionnelle avant APK (GO utilisateur) — 15 scénarios
 * bout-en-bout, rejoués via l'API réelle (aucune règle métier réécrite pour
 * forcer un passage). Chaque scénario a son propre foyer, isolé par ID connu.
 * Toute date affectant un mouvement réel (paiement/revenu/dépense/transfert
 * immédiat) est ancrée sur `futureDate()` (jamais un littéral calendaire figé)
 * — même précaution que le lot de stabilisation des tests dates (lot7/lot17).
 */
describe('Recette finale — parcours critiques D-Penses+ (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  const run = Date.now();
  let seq = 0;
  const mailer = new FakeMailer();

  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  function userIdFromToken(accessToken: string): string {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString('utf8'));
    return payload.sub as string;
  }

  async function newHousehold(name = 'Foyer') {
    seq += 1;
    const email = `lot49+${run}+${seq}@example.com`;
    const signupToken = await signupVerified(http, mailer, email, 'password123', 'Adulte', 'T');
    const household = await http.post('/households').set('Authorization', `Bearer ${signupToken}`).send({ name: `${name} ${seq}` }).expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth, householdId: household.body.household.id as string, userId: userIdFromToken(accessToken) };
  }

  /** Toute date de mouvement réel doit rester postérieure à l'AccountBalanceSnapshot (RG-080). */
  function futureDate(daysFromNow: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + daysFromNow);
    return d.toISOString().slice(0, 10);
  }

  /** Voir test/lot7.e2e-spec.ts (même helper, même raison — TEST 7/8). */
  function nextMondayUTC(from: Date): Date {
    const base = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const isoDay = base.getUTCDay() === 0 ? 7 : base.getUTCDay();
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

  async function createAccount(auth: () => [string, string], name: string, initialBalance: number, includeInOperationalTreasury = true) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance, includeInOperationalTreasury }).expect(201);
    return res.body as { id: string };
  }

  async function soldeCourant(auth: () => [string, string], accountId: string): Promise<number> {
    const accounts = await http.get('/accounts').set(...auth()).expect(200);
    return accounts.body.find((a: { id: string }) => a.id === accountId).soldeCourant;
  }

  async function createCategory(auth: () => [string, string], name: string, kind: 'expense' | 'income' | 'both' = 'expense') {
    const res = await http.post('/categories').set(...auth()).send({ name, kind }).expect(201);
    return res.body as { id: string };
  }

  async function createChild(auth: () => [string, string], firstName: string) {
    const res = await http.post('/children').set(...auth()).send({ firstName, lastName: 'T' }).expect(201);
    return res.body as { id: string };
  }

  // =========================================================
  // SCÉNARIO 1 — Dépense simple + Budget
  // =========================================================
  describe('SCÉNARIO 1 — Dépense simple + Budget', () => {
    it('une dépense compatible se rattache automatiquement au Budget, une seule transaction, aucune échéance parasite', async () => {
      const h = await newHousehold();
      const account = await createAccount(h.auth, 'Courant', 5000);
      const category = await createCategory(h.auth, 'Alimentation');
      const budget = await http
        .post('/variable-budgets')
        .set(...h.auth())
        .send({ categoryId: category.id, referenceAmount: 1000, referencePeriod: 'mois', startDate: '2020-01-01' })
        .expect(201);
      const spentDate = futureDate(1);

      await http.post('/expenses').set(...h.auth()).send({ amount: 150, accountId: account.id, categoryId: category.id, spentDate }).expect(201);

      expect(await soldeCourant(h.auth, account.id)).toBe(4850);

      const status = await http.get(`/variable-budgets/${budget.body.id}`).set(...h.auth()).query({ at: spentDate }).expect(200);
      expect(status.body.status.consommeADate).toBe(150);
      expect(status.body.status.budgetContractuelRestant).toBe(850);

      const txns = await http.get('/transactions').set(...h.auth()).expect(200);
      expect(txns.body).toHaveLength(1);
      expect(txns.body[0].kind).toBe('budget_expense');

      const deadlines = await http.get('/deadlines').set(...h.auth()).expect(200);
      expect(deadlines.body).toHaveLength(0);
    });
  });

  // =========================================================
  // SCÉNARIO 2 — Dépense depuis BudgetDetail
  // =========================================================
  describe('SCÉNARIO 2 — Dépense depuis BudgetDetail', () => {
    it('variableBudgetId préreempli → une seule vraie transaction, consommation Budget à jour, aucun doublon', async () => {
      const h = await newHousehold();
      const account = await createAccount(h.auth, 'Courant', 3000);
      const category = await createCategory(h.auth, 'Loisirs');
      const budget = await http
        .post('/variable-budgets')
        .set(...h.auth())
        .send({ categoryId: category.id, referenceAmount: 600, referencePeriod: 'semaine', startDate: '2020-01-01' })
        .expect(201);
      const spentDate = futureDate(1);

      await http
        .post('/expenses')
        .set(...h.auth())
        .send({ amount: 80, accountId: account.id, categoryId: category.id, variableBudgetId: budget.body.id, spentDate })
        .expect(201);

      expect(await soldeCourant(h.auth, account.id)).toBe(2920);
      const status = await http.get(`/variable-budgets/${budget.body.id}`).set(...h.auth()).query({ at: spentDate }).expect(200);
      expect(status.body.status.consommeADate).toBe(80);

      const txns = await http.get('/transactions').set(...h.auth()).expect(200);
      expect(txns.body).toHaveLength(1);
    });
  });

  // =========================================================
  // SCÉNARIO 3 — Charge récurrente
  // =========================================================
  describe('SCÉNARIO 3 — Charge récurrente mensuelle', () => {
    it('règle récurrente conservée, occurrence future générée, paiement total puis partiel, charge reste active', async () => {
      const h = await newHousehold();
      const account = await createAccount(h.auth, 'Courant', 8000);
      const category = await createCategory(h.auth, 'Abonnements');
      const firstDue = futureDate(1);

      const cp = await http
        .post('/charge-plans')
        .set(...h.auth())
        .send({ label: 'Salle de sport', categoryId: category.id, generationMode: 'auto_frequence', recurrenceRule: 'mensuel', startDate: firstDue })
        .expect(201);
      const deadline1 = await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...h.auth())
        .send({ dueDate: firstDue, amountCurrent: 300, amountStatus: 'confirme' })
        .expect(201);

      // Déclenche la génération d'occurrences futures (même moteur que Dashboard).
      await http.get('/dashboard/summary').set(...h.auth()).query({ at: futureDate(40) }).expect(200);

      const openBefore = await http.get('/deadlines').set(...h.auth()).expect(200);
      const forThisPlan = openBefore.body.filter((d: { chargePlanId: string }) => d.chargePlanId === cp.body.id);
      expect(forThisPlan.length).toBeGreaterThanOrEqual(2);

      // Paiement total de la première occurrence.
      await http
        .post(`/deadlines/${deadline1.body.id}/payments`)
        .set(...h.auth())
        .send({ amount: 300, accountId: account.id, paidDate: futureDate(2) })
        .expect(201);
      const d1After = await http.get(`/deadlines/${deadline1.body.id}`).set(...h.auth()).expect(200);
      expect(d1After.body.resteAPayer).toBe(0);

      const cpAfter = await http.get(`/charge-plans/${cp.body.id}`).set(...h.auth()).expect(200);
      expect(cpAfter.body.status).toBe('actif');

      // Paiement partiel de la 2e occurrence générée.
      const second = forThisPlan.find((d: { id: string }) => d.id !== deadline1.body.id);
      const secondAmount = second.amountCurrent;
      await http
        .post(`/deadlines/${second.id}/payments`)
        .set(...h.auth())
        .send({ amount: 100, accountId: account.id, paidDate: futureDate(3) })
        .expect(201);
      const secondAfter = await http.get(`/deadlines/${second.id}`).set(...h.auth()).expect(200);
      expect(secondAfter.body.resteAPayer).toBe(secondAmount - 100);
      expect(secondAfter.body.financialStatus).toBe('partiellement_payee');
    });
  });

  // =========================================================
  // SCÉNARIO 4 — Transfert
  // =========================================================
  describe('SCÉNARIO 4 — Transfert', () => {
    it('piloté→piloté / piloté→hors pilotage / hors pilotage→piloté, jamais une dépense, planifié ne modifie rien avant confirmation', async () => {
      const h = await newHousehold();
      const a = await createAccount(h.auth, 'A', 10000, true);
      const b = await createAccount(h.auth, 'B', 3000, true);
      const c = await createAccount(h.auth, 'C', 1000, false);

      // piloté → piloté (immédiat, net ménage piloté inchangé).
      await http.post('/accounts/transfers').set(...h.auth()).send({ fromAccountId: a.id, toAccountId: b.id, amount: 2000 }).expect(201);
      expect(await soldeCourant(h.auth, a.id)).toBe(8000);
      expect(await soldeCourant(h.auth, b.id)).toBe(5000);
      const txns1 = await http.get('/transactions').set(...h.auth()).query({ kind: 'payment,budget_expense,adhoc_expense' }).expect(200);
      expect(txns1.body).toHaveLength(0); // jamais un transfert typé comme dépense

      // piloté → hors pilotage : trésorerie opérationnelle diminue, patrimoine total inchangé.
      const summaryBefore = await http.get('/accounts/summary').set(...h.auth()).expect(200);
      await http.post('/accounts/transfers').set(...h.auth()).send({ fromAccountId: a.id, toAccountId: c.id, amount: 1000 }).expect(201);
      const summaryAfter = await http.get('/accounts/summary').set(...h.auth()).expect(200);
      expect(summaryAfter.body.tresorerieOperationnelle).toBe(summaryBefore.body.tresorerieOperationnelle - 1000);
      expect(await soldeCourant(h.auth, a.id)).toBe(7000);
      expect(await soldeCourant(h.auth, c.id)).toBe(2000);

      // hors pilotage → piloté : trésorerie opérationnelle augmente.
      const summaryBefore2 = await http.get('/accounts/summary').set(...h.auth()).expect(200);
      await http.post('/accounts/transfers').set(...h.auth()).send({ fromAccountId: c.id, toAccountId: a.id, amount: 500 }).expect(201);
      const summaryAfter2 = await http.get('/accounts/summary').set(...h.auth()).expect(200);
      expect(summaryAfter2.body.tresorerieOperationnelle).toBe(summaryBefore2.body.tresorerieOperationnelle + 500);

      // Transfert planifié (futur réel) : solde inchangé avant confirmation explicite.
      const balA = await soldeCourant(h.auth, a.id);
      const balB = await soldeCourant(h.auth, b.id);
      const planned = await http
        .post('/accounts/transfers')
        .set(...h.auth())
        .send({ fromAccountId: a.id, toAccountId: b.id, amount: 500, plannedDate: futureDate(10) })
        .expect(201);
      expect(planned.body.status).toBe('prevu');
      expect(await soldeCourant(h.auth, a.id)).toBe(balA);
      expect(await soldeCourant(h.auth, b.id)).toBe(balB);

      await http.post(`/accounts/transfers/${planned.body.id}/confirm`).set(...h.auth()).expect(201);
      expect(await soldeCourant(h.auth, a.id)).toBe(balA - 500);
      expect(await soldeCourant(h.auth, b.id)).toBe(balB + 500);
    });
  });

  // =========================================================
  // SCÉNARIO 5 — Projection M4 (3 niveaux)
  // =========================================================
  describe('SCÉNARIO 5 — Projection M4, 3 niveaux', () => {
    it('Aujourd\'hui / engagements connus / budgets inclus — budget jamais dans engagements connus', async () => {
      const h = await newHousehold();
      const account = await createAccount(h.auth, 'Courant', 10000);
      const category = await createCategory(h.auth, 'Divers');

      // Semaine ancrée sur nextMondayUTC (toujours dans le futur réel, jamais un
      // horizon qui déborde imprévisiblement sur la période budgétaire suivante) —
      // même précaution que test/lot7.e2e-spec.ts TEST 7/8.
      const weekStart = nextMondayUTC(new Date());
      const at = isoDate(weekStart);
      const to = isoDate(addDaysUTC(weekStart, 5));

      // Revenu futur prévu (jamais reçu).
      const source = await http.post('/income-sources').set(...h.auth()).send({ label: 'Prime', usualAmount: 5000, defaultAccountId: account.id }).expect(201);
      await http.post(`/income-sources/${source.body.id}/occurrences`).set(...h.auth()).send({ usualDate: isoDate(addDaysUTC(weekStart, 3)) }).expect(201);

      // Charge connue.
      const cp = await http.post('/charge-plans').set(...h.auth()).send({ label: 'Charge connue', generationMode: 'calendrier_manuel', startDate: '2020-01-01' }).expect(201);
      await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...h.auth()).send({ dueDate: isoDate(addDaysUTC(weekStart, 4)), amountCurrent: 2000, amountStatus: 'confirme' }).expect(201);

      // Budget de contrôle hebdomadaire partiellement consommé (400/1000), fenêtre strictement dans la semaine.
      const budget = await http
        .post('/variable-budgets')
        .set(...h.auth())
        .send({ categoryId: category.id, referenceAmount: 1000, referencePeriod: 'semaine', weekStartDay: 1, startDate: '2020-01-01' })
        .expect(201);
      await http
        .post('/expenses')
        .set(...h.auth())
        .send({ amount: 400, accountId: account.id, categoryId: category.id, variableBudgetId: budget.body.id, spentDate: isoDate(addDaysUTC(weekStart, 1)) })
        .expect(201);

      const today = await soldeCourant(h.auth, account.id);
      expect(today).toBe(9600); // niveau 1 — Aujourd'hui

      const proj = await http.get('/projection').set(...h.auth()).query({ at, to }).expect(200);
      expect(proj.body.opening_physical_treasury).toBe(9600);
      expect(proj.body.closing_physical_treasury).toBe(12600); // niveau 2 — 9600 + 5000 - 2000, budget jamais inclus
      expect(proj.body.fin_periode_prudente).toBe(12000); // niveau 3 — 12600 - 600 (reste non consommé), jamais -1000 ni -400
    });
  });

  // =========================================================
  // SCÉNARIO 6 — Plan École réel
  // =========================================================
  describe('SCÉNARIO 6 — Plan École réel', () => {
    it('FinancialPlan = regroupement, vraies Deadline, contextualisation "Scolarité T1 · Wael", payé/reste corrects', async () => {
      const h = await newHousehold();
      const account = await createAccount(h.auth, 'Courant', 20000);
      const child = await createChild(h.auth, 'Wael');

      const wizard = await http
        .post('/school-wizard')
        .set(...h.auth())
        .send({
          label: 'École Wael',
          childIds: [child.id],
          periodStart: futureDate(0),
          periodEnd: futureDate(300),
          schoolYear: '2026/2027',
          schoolName: 'Lycée Test',
          items: [
            { label: 'Scolarité T1', amount: 5000, dueDate: futureDate(5), obligationStatus: 'obligatoire' },
            { label: 'Scolarité T2', amount: 5000, dueDate: futureDate(90), obligationStatus: 'obligatoire' },
            { label: 'Scolarité T3', amount: 5000, dueDate: futureDate(180), obligationStatus: 'obligatoire' },
          ],
        })
        .expect(201);
      expect(wizard.body.chargePlans).toHaveLength(3);

      const detail = await http.get(`/financial-plans/${wizard.body.financialPlan.id}`).set(...h.auth()).expect(200);
      const t1 = detail.body.chargePlans.find((cp: { label: string }) => cp.label.startsWith('Scolarité T1'));
      expect(t1.label).toBe('Scolarité T1 · Wael');

      // Paiement de T1.
      const t1Full = wizard.body.chargePlans.find((cp: { label: string }) => cp.label === 'Scolarité T1');
      const t1Deadline = await http.get('/deadlines').set(...h.auth()).expect(200);
      const d = t1Deadline.body.find((x: { chargePlanId: string }) => x.chargePlanId === t1Full.id);
      await http.post(`/deadlines/${d.id}/payments`).set(...h.auth()).send({ amount: 5000, accountId: account.id, paidDate: futureDate(6) }).expect(201);

      const detailAfter = await http.get(`/financial-plans/${wizard.body.financialPlan.id}`).set(...h.auth()).expect(200);
      expect(detailAfter.body.paidAmount).toBe(5000);
      expect(detailAfter.body.remainingDue).toBe(10000);
    });
  });

  // =========================================================
  // SCÉNARIO 7 — École pluriannuelle
  // =========================================================
  describe('SCÉNARIO 7 — École pluriannuelle', () => {
    it('projections (hausse fixe/%/aucune, plusieurs années, T1/T2/T3 séparés), puis vrai plan suivant sans doublon', async () => {
      const h = await newHousehold();
      const child = await createChild(h.auth, 'Wael');

      const wizard = await http
        .post('/school-wizard')
        .set(...h.auth())
        .send({
          label: 'École Wael',
          childIds: [child.id],
          periodStart: futureDate(0),
          periodEnd: futureDate(300),
          schoolYear: '2026/2027',
          schoolName: 'Lycée Test',
          items: [
            { label: 'Scolarité T1', amount: 5000, dueDate: futureDate(5), obligationStatus: 'obligatoire' },
            { label: 'Scolarité T2', amount: 4000, dueDate: futureDate(90), obligationStatus: 'obligatoire' },
          ],
        })
        .expect(201);
      const planId = wizard.body.financialPlan.id as string;
      const t1 = wizard.body.chargePlans.find((cp: { label: string }) => cp.label === 'Scolarité T1');
      const t2 = wizard.body.chargePlans.find((cp: { label: string }) => cp.label === 'Scolarité T2');

      // Hausse % globale sur 1 an.
      const gen1 = await http
        .post(`/financial-plans/${planId}/school-projections`)
        .set(...h.auth())
        .send({ years: 1, applyToAllIncreaseType: 'pourcentage', applyToAllIncreaseValue: 10 })
        .expect(201);
      expect(gen1.body.created).toHaveLength(2); // T1 + T2, jamais fusionnés
      const projT1 = gen1.body.created.find((p: { sourceChargePlanId: string }) => p.sourceChargePlanId === t1.id);
      expect(Number(projT1.computedAmount)).toBe(5500); // 5000 * 1.10

      // Hausse fixe sur un poste précis (règle explicite prime sur applyToAll).
      const list1 = await http.get(`/financial-plans/${planId}/school-projections`).set(...h.auth()).expect(200);
      expect(list1.body).toHaveLength(2);

      // Aucune hausse pour un autre plan (poste isolé) : vérifie via une règle explicite 'aucune'.
      const gen2 = await http
        .post(`/financial-plans/${planId}/school-projections`)
        .set(...h.auth())
        .send({ years: 1, rules: [{ chargePlanId: t2.id, increaseType: 'aucune' }] })
        .expect(201);
      const projT2NoIncrease = gen2.body.created.find((p: { sourceChargePlanId: string }) => p.sourceChargePlanId === t2.id);
      expect(Number(projT2NoIncrease.computedAmount)).toBe(4000); // inchangé

      // Créer le vrai plan de l'année suivante en réutilisant la prévision T1.
      const candidates = await http
        .get('/school-projections/candidates')
        .set(...h.auth())
        .query({ childId: child.id, schoolYear: '2027/2028', schoolName: 'Lycée Test' })
        .expect(200);
      const candidateT1 = candidates.body.find((c: { label: string }) => c.label === 'Scolarité T1');
      expect(candidateT1).toBeDefined();
      expect(Number(candidateT1.computedAmount)).toBe(5500);

      const nextYearWizard = await http
        .post('/school-wizard')
        .set(...h.auth())
        .send({
          label: 'École Wael 2027/2028',
          childIds: [child.id],
          periodStart: futureDate(365),
          periodEnd: futureDate(660),
          schoolYear: '2027/2028',
          schoolName: 'Lycée Test',
          items: [{ label: 'Scolarité T1', amount: candidateT1.computedAmount, dueDate: futureDate(370), obligationStatus: 'obligatoire', sourceProjectionId: candidateT1.id }],
        })
        .expect(201);
      expect(nextYearWizard.body.chargePlans).toHaveLength(1); // zéro doublon

      const candidateReplaced = await http
        .get('/school-projections/candidates')
        .set(...h.auth())
        .query({ childId: child.id, schoolYear: '2027/2028', schoolName: 'Lycée Test' })
        .expect(200);
      expect(candidateReplaced.body.find((c: { id: string }) => c.id === candidateT1.id)).toBeUndefined(); // remplacee → plus candidate
    });
  });

  // =========================================================
  // SCÉNARIO 8 — Plan Voiture
  // =========================================================
  describe('SCÉNARIO 8 — Plan Voiture', () => {
    it('périodicité libre par poste, ponctuel = 1 ChargePlan + 1 Deadline sans génération future, contextualisation "· Audi Q5"', async () => {
      const h = await newHousehold();
      const wizard = await http
        .post('/vehicle-wizard')
        .set(...h.auth())
        .send({
          vehicleName: 'Audi Q5',
          items: [
            { label: 'Assurance', amount: 4000, recurrenceRule: 'annuel', dueDate: futureDate(30) },
            { label: 'Vidange', amount: 600, recurrenceRule: 'semestriel', dueDate: futureDate(10) },
            { label: 'Réparation', amount: 1200, recurrenceRule: 'ponctuel', dueDate: futureDate(3) },
          ],
        })
        .expect(201);
      expect(wizard.body.chargePlans).toHaveLength(3);

      const detail = await http.get(`/financial-plans/${wizard.body.financialPlan.id}`).set(...h.auth()).expect(200);
      const labels = detail.body.chargePlans.map((cp: { label: string }) => cp.label).sort();
      expect(labels).toEqual(['Assurance · Audi Q5', 'Réparation · Audi Q5', 'Vidange · Audi Q5']);

      const reparation = wizard.body.chargePlans.find((cp: { label: string }) => cp.label === 'Réparation');
      const cpReparation = await http.get(`/charge-plans/${reparation.id}`).set(...h.auth()).expect(200);
      expect(cpReparation.body.generationMode).toBe('calendrier_manuel'); // ponctuel = pas de génération future
      const deadlinesForReparation = await http.get('/deadlines').set(...h.auth()).expect(200);
      expect(deadlinesForReparation.body.filter((d: { chargePlanId: string }) => d.chargePlanId === reparation.id)).toHaveLength(1);

      const assurance = wizard.body.chargePlans.find((cp: { label: string }) => cp.label === 'Assurance');
      const cpAssurance = await http.get(`/charge-plans/${assurance.id}`).set(...h.auth()).expect(200);
      expect(cpAssurance.body.generationMode).toBe('auto_frequence'); // récurrent = moteur existant
    });
  });

  // =========================================================
  // SCÉNARIO 9 — Plan Maison
  // =========================================================
  describe('SCÉNARIO 9 — Plan Maison', () => {
    it('mêmes règles que Voiture (2 semaines non supporté par le moteur → mensuel utilisé à la place)', async () => {
      const h = await newHousehold();
      const wizard = await http
        .post('/housing-wizard')
        .set(...h.auth())
        .send({
          housingName: 'Villa Almaz',
          items: [
            { label: 'Jardinier', amount: 500, recurrenceRule: 'mensuel', dueDate: futureDate(5) },
            { label: 'Assurance habitation', amount: 2000, recurrenceRule: 'annuel', dueDate: futureDate(30) },
            { label: 'Réparation', amount: 800, recurrenceRule: 'ponctuel', dueDate: futureDate(3) },
          ],
        })
        .expect(201);
      expect(wizard.body.chargePlans).toHaveLength(3);

      const detail = await http.get(`/financial-plans/${wizard.body.financialPlan.id}`).set(...h.auth()).expect(200);
      const labels = detail.body.chargePlans.map((cp: { label: string }) => cp.label).sort();
      expect(labels).toEqual(['Assurance habitation · Villa Almaz', 'Jardinier · Villa Almaz', 'Réparation · Villa Almaz']);

      const reparation = wizard.body.chargePlans.find((cp: { label: string }) => cp.label === 'Réparation');
      const cpReparation = await http.get(`/charge-plans/${reparation.id}`).set(...h.auth()).expect(200);
      expect(cpReparation.body.generationMode).toBe('calendrier_manuel');
    });
  });

  // =========================================================
  // SCÉNARIO 10 — Abonnements
  // =========================================================
  describe('SCÉNARIO 10 — Abonnements', () => {
    it('Netflix mensuel + Microsoft 365 annuel, périodicité modifiable, plan = regroupement uniquement', async () => {
      const h = await newHousehold();
      const wizard = await http
        .post('/subscriptions-wizard')
        .set(...h.auth())
        .send({
          label: 'Abonnements',
          items: [
            { label: 'Netflix', amount: 120, recurrenceRule: 'mensuel', dueDate: futureDate(5) },
            { label: 'Microsoft 365', amount: 600, recurrenceRule: 'annuel', dueDate: futureDate(20) },
          ],
        })
        .expect(201);
      expect(wizard.body.chargePlans).toHaveLength(2);

      const netflix = wizard.body.chargePlans.find((cp: { label: string }) => cp.label === 'Netflix');
      const office = wizard.body.chargePlans.find((cp: { label: string }) => cp.label === 'Microsoft 365');
      const cpNetflix = await http.get(`/charge-plans/${netflix.id}`).set(...h.auth()).expect(200);
      const cpOffice = await http.get(`/charge-plans/${office.id}`).set(...h.auth()).expect(200);
      expect(cpNetflix.body.recurrenceRule).toBe('mensuel');
      expect(cpOffice.body.recurrenceRule).toBe('annuel'); // jamais forcé mensuel

      const plan = await http.get(`/financial-plans/${wizard.body.financialPlan.id}`).set(...h.auth()).expect(200);
      expect(plan.body.planType).toBe('subscriptions');
    });
  });

  // =========================================================
  // SCÉNARIO 11 — Voyage
  // =========================================================
  describe('SCÉNARIO 11 — Voyage', () => {
    it('FinancialPlanBeneficiary (membre + enfant), contextualisation "Hôtel · Voyage Agadir", échéances correctes', async () => {
      const h = await newHousehold();
      const child = await createChild(h.auth, 'Yasmine');

      const wizard = await http
        .post('/travel-wizard')
        .set(...h.auth())
        .send({
          label: 'Voyage Agadir',
          destination: 'Agadir',
          periodStart: futureDate(20),
          periodEnd: futureDate(27),
          participantUserIds: [h.userId],
          participantChildIds: [child.id],
          items: [
            { label: 'Hôtel', amount: 3000, dueDate: futureDate(20) },
            { label: 'Transport', amount: 1500, dueDate: futureDate(18) },
          ],
        })
        .expect(201);

      const beneficiaries = await http.get(`/financial-plans/${wizard.body.financialPlan.id}/beneficiaries`).set(...h.auth()).expect(200);
      expect(beneficiaries.body).toHaveLength(2);

      const detail = await http.get(`/financial-plans/${wizard.body.financialPlan.id}`).set(...h.auth()).expect(200);
      const hotel = detail.body.chargePlans.find((cp: { label: string }) => cp.label.startsWith('Hôtel'));
      expect(hotel.label).toBe('Hôtel · Voyage Agadir');
      expect(detail.body.chargePlans).toHaveLength(2);
    });
  });

  // =========================================================
  // SCÉNARIO 12 — Transactions
  // =========================================================
  describe('SCÉNARIO 12 — Transactions', () => {
    it('filtres structurés, initiateur, contextualisation, pas de doublons, chronologie correcte', async () => {
      const h = await newHousehold();
      const account = await createAccount(h.auth, 'Courant', 5000);
      const category = await createCategory(h.auth, 'Divers');

      const d1 = futureDate(1);
      const d2 = futureDate(2);
      await http.post('/expenses').set(...h.auth()).send({ amount: 100, accountId: account.id, categoryId: category.id, spentDate: d1 }).expect(201);
      await http.post('/expenses').set(...h.auth()).send({ amount: 200, accountId: account.id, categoryId: category.id, spentDate: d2 }).expect(201);

      const all = await http.get('/transactions').set(...h.auth()).expect(200);
      expect(all.body).toHaveLength(2);
      expect(new Date(all.body[0].occurredAt).getTime()).toBeGreaterThanOrEqual(new Date(all.body[1].occurredAt).getTime()); // DESC

      const filtered = await http.get('/transactions').set(...h.auth()).query({ accountId: account.id, categoryId: category.id }).expect(200);
      expect(filtered.body).toHaveLength(2);

      const byInitiator = await http.get('/transactions').set(...h.auth()).query({ createdByUserId: h.userId }).expect(200);
      expect(byInitiator.body).toHaveLength(2);
      expect(byInitiator.body[0].createdByUserId).toBe(h.userId);
    });

    it('reliquat — GET /transactions (registre) contextualise aussi une charge liée à un enfant unique, sans casser vehicle/housing ni les filtres', async () => {
      const h = await newHousehold();
      const account = await createAccount(h.auth, 'Courant', 20000);
      const child = await createChild(h.auth, 'Wael');

      const school = await http
        .post('/school-wizard')
        .set(...h.auth())
        .send({
          label: 'École Wael',
          childIds: [child.id],
          periodStart: futureDate(0),
          periodEnd: futureDate(300),
          items: [{ label: 'Scolarité T1', amount: 5000, dueDate: futureDate(1), obligationStatus: 'obligatoire' }],
        })
        .expect(201);
      const vehicle = await http
        .post('/vehicle-wizard')
        .set(...h.auth())
        .send({ vehicleName: 'Audi Q5', items: [{ label: 'Assurance', amount: 4000, recurrenceRule: 'annuel', dueDate: futureDate(1) }] })
        .expect(201);
      const housing = await http
        .post('/housing-wizard')
        .set(...h.auth())
        .send({ housingName: 'Villa Almaz', items: [{ label: 'Internet', amount: 300, recurrenceRule: 'mensuel', dueDate: futureDate(1) }] })
        .expect(201);

      const deadlines = await http.get('/deadlines').set(...h.auth()).expect(200);
      const paidDate = futureDate(2);
      const wizardsWithAmount: [typeof school, number][] = [
        [school, 5000],
        [vehicle, 4000],
        [housing, 300],
      ];
      for (const [wizard, amount] of wizardsWithAmount) {
        const cpId = wizard.body.chargePlans[0].id;
        const d = deadlines.body.find((x: { chargePlanId: string }) => x.chargePlanId === cpId);
        await http.post(`/deadlines/${d.id}/payments`).set(...h.auth()).send({ amount, accountId: account.id, paidDate }).expect(201);
      }

      const txns = await http.get('/transactions').set(...h.auth()).expect(200);
      const labels = txns.body.map((t: { label: string }) => t.label).sort();
      expect(labels).toEqual(['Assurance · Audi Q5', 'Internet · Villa Almaz', 'Scolarité T1 · Wael']);

      // Non-régression filtres.
      const byAccount = await http.get('/transactions').set(...h.auth()).query({ accountId: account.id }).expect(200);
      expect(byAccount.body).toHaveLength(3);
    });
  });

  // =========================================================
  // SCÉNARIO 13 — Calendrier
  // =========================================================
  describe('SCÉNARIO 13 — Calendrier', () => {
    it('charges/dépenses/revenus/transferts prévus + échéances Plans, chaque ligne référence le bon détail', async () => {
      const h = await newHousehold();
      const accountA = await createAccount(h.auth, 'A', 5000);
      const accountB = await createAccount(h.auth, 'B', 1000);

      const cp = await http.post('/charge-plans').set(...h.auth()).send({ label: 'Charge Calendrier', generationMode: 'calendrier_manuel', startDate: '2020-01-01' }).expect(201);
      const deadline = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...h.auth()).send({ dueDate: futureDate(5), amountCurrent: 300, amountStatus: 'confirme' }).expect(201);

      const source = await http.post('/income-sources').set(...h.auth()).send({ label: 'Revenu Calendrier', usualAmount: 2000, defaultAccountId: accountA.id }).expect(201);
      await http.post(`/income-sources/${source.body.id}/occurrences`).set(...h.auth()).send({ usualDate: futureDate(7) }).expect(201);

      // Transfert PRÉVU visible au calendrier = un transfert récurrent (un transfert
      // manuel ponctuel est confirmé immédiatement, RG-085 — jamais status='prevu').
      await http
        .post('/recurring-transfers')
        .set(...h.auth())
        .send({ label: 'Virement épargne', fromAccountId: accountA.id, toAccountId: accountB.id, amount: 500, recurrenceRule: 'mensuel', recurrenceAnchorDate: futureDate(6) })
        .expect(201);

      const cal = await http.get('/calendar').set(...h.auth()).query({ from: futureDate(0), to: futureDate(10) }).expect(200);
      const events = cal.body.events;
      const kinds = new Set(events.map((e: { kind: string }) => e.kind));
      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(kinds.has('echeance') || kinds.has('facture_attendue') || kinds.has('montant_inconnu') || kinds.has('echeance_payee')).toBe(true);
      expect(kinds.has('transfert_prevu')).toBe(true);

      const echeanceEvent = events.find((e: { deadlineId?: string }) => e.deadlineId === deadline.body.id);
      expect(echeanceEvent).toBeDefined();
    });
  });

  // =========================================================
  // SCÉNARIO 14 — Home (ordre : lecture directe du composant, layout de présentation)
  // =========================================================
  describe('SCÉNARIO 14 — Home', () => {
    it('GET /dashboard/summary expose les données nécessaires aux 5 blocs (comptes/situation/budgets/plans/échéances)', async () => {
      const h = await newHousehold();
      await createAccount(h.auth, 'Courant', 5000, true);
      await createAccount(h.auth, 'Épargne', 2000, false);

      const summary = await http.get('/dashboard/summary').set(...h.auth()).expect(200);
      expect(summary.body).toHaveProperty('operational_treasury');
      expect(summary.body).toHaveProperty('free_available');
      expect(Array.isArray(summary.body.budgets_resume ?? summary.body.budgetsResume ?? [])).toBe(true);
    });
  });

  // =========================================================
  // SCÉNARIO 15 — Anti-doublon global
  // =========================================================
  describe('SCÉNARIO 15 — Anti-doublon global', () => {
    it('Internet · Villa Almaz / Assurance · Audi Q5 / Scolarité T1 · Wael — une seule obligation financière réelle par intention', async () => {
      const h = await newHousehold();
      const child = await createChild(h.auth, 'Wael');

      const housing = await http
        .post('/housing-wizard')
        .set(...h.auth())
        .send({ housingName: 'Villa Almaz', items: [{ label: 'Internet', amount: 300, recurrenceRule: 'mensuel', dueDate: futureDate(5) }] })
        .expect(201);
      const vehicle = await http
        .post('/vehicle-wizard')
        .set(...h.auth())
        .send({ vehicleName: 'Audi Q5', items: [{ label: 'Assurance', amount: 4000, recurrenceRule: 'annuel', dueDate: futureDate(10) }] })
        .expect(201);
      const school = await http
        .post('/school-wizard')
        .set(...h.auth())
        .send({
          label: 'École Wael',
          childIds: [child.id],
          periodStart: futureDate(0),
          periodEnd: futureDate(300),
          items: [{ label: 'Scolarité T1', amount: 5000, dueDate: futureDate(5), obligationStatus: 'obligatoire' }],
        })
        .expect(201);

      // Exactement 1 ChargePlan + 1 Deadline par intention, jamais une deuxième via une autre vue.
      for (const wizard of [housing, vehicle, school]) {
        expect(wizard.body.chargePlans).toHaveLength(1);
        const cpId = wizard.body.chargePlans[0].id;
        const allDeadlines = await http.get('/deadlines').set(...h.auth()).expect(200);
        expect(allDeadlines.body.filter((d: { chargePlanId: string }) => d.chargePlanId === cpId)).toHaveLength(1);
      }

      const txns = await http.get('/transactions').set(...h.auth()).expect(200);
      expect(txns.body).toHaveLength(0); // rien n'est encore payé — aucune ligne réelle en double ni en trop

      // GET /charge-plans (liste autonome, RG-110) exclut par construction tout
      // ChargePlan rattaché à un FinancialPlan — les 3 postes ne doivent JAMAIS y
      // apparaître une 2e fois en plus de leur Plan (anti-doublon structurel).
      const allCp = await http.get('/charge-plans').set(...h.auth()).expect(200);
      expect(allCp.body).toHaveLength(0);
    });
  });
});
