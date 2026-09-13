import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Lot 1 (module Budgets, correction validée) : le Solde prudent (G.4/G.5,
 * dashboard.variable_budget_commitments) ne doit retrancher que le restant
 * CONTRACTUEL non consommé d'un budget — jamais la prévision au rythme actuel,
 * qui reste un indicateur de pilotage affiché sur la fiche budget (rythmeProjete/
 * previsionRythmeRestant/projectionPrudenteRestante, inchangés). Seuls les
 * budgets à includeInPrudentProjection=true (défaut) participent à ce calcul.
 *
 * Avant ce correctif, computeVariableBudgetCommitments utilisait
 * projectionPrudenteRestante = MAX(contractuel, rythme, 0), qui pouvait retenir
 * le rythme quand il dépassait le contractuel — majorant à tort la réservation
 * budgétaire dans le disponible. TEST 1 reproduit exactement ce cas.
 */
describe('Lot 1 — Solde prudent des budgets variables : restant contractuel uniquement (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  const run = Date.now();
  const mailer = new FakeMailer();
  let seq = 0;

  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold() {
    seq += 1;
    const token = await signupVerified(http, mailer, `lot26+${run}+${seq}@example.com`, 'password123', 'L26', 'T');
    const household = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer Lot26 ${seq}` }).expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function createAccount(auth: () => [string, string], initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name: 'Compte', type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  async function createWeeklyBudget(auth: () => [string, string], categoryId: string, referenceAmount: number, includeInPrudentProjection?: boolean) {
    const res = await http
      .post('/variable-budgets')
      .set(...auth())
      .send({ categoryId, referenceAmount, referencePeriod: 'semaine', startDate: '2020-01-01', includeInPrudentProjection })
      .expect(201);
    return res.body.id as string;
  }

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

  // ---------- TEST 1 — le rythme ne majore plus le solde prudent ----------
  it("TEST 1 — rythme (1800) > contractuel (1200) : le solde prudent retient 1200, jamais 1800", async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const category = await http.post('/categories').set(...h.auth()).send({ name: 'Courses T1', kind: 'expense' }).expect(201);
    await createWeeklyBudget(h.auth, category.body.id, 1500);

    const weekStart = nextMondayUTC(new Date()); // jour 1 de la semaine (lundi)
    const sunday = addDaysUTC(weekStart, 6);

    // 300 DH dépensés dès le 1er jour de la période : rythme = (300/1)×7 = 2100,
    // rythme_restant = 2100-300 = 1800 ; contractuel = 1500-300 = 1200.
    await http.post('/expenses').set(...h.auth()).send({ amount: 300, accountId, categoryId: category.body.id, spentDate: weekStart.toISOString() }).expect(201);
    // H* fixé à la fin de cette même semaine (aucune queue de semaine future à additionner).
    const source = await http.post('/income-sources').set(...h.auth()).send({ label: 'Salaire', usualAmount: 8000, defaultAccountId: accountId }).expect(201);
    await http.post(`/income-sources/${source.body.id}/occurrences`).set(...h.auth()).send({ usualDate: isoDate(sunday) }).expect(201);

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: isoDate(weekStart) }).expect(200);
    expect(dashboard.body.variable_budget_commitments).toBe(1200); // jamais 1800 (rythme) ni 1500 (budget entier)
  });

  // ---------- TEST 2 — includeInPrudentProjection=false exclut le budget ----------
  it('TEST 2 — includeInPrudentProjection=false : le budget est totalement exclu du solde prudent', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const category = await http.post('/categories').set(...h.auth()).send({ name: 'Courses T2', kind: 'expense' }).expect(201);
    await createWeeklyBudget(h.auth, category.body.id, 1500, false);

    const weekStart = nextMondayUTC(new Date());
    const sunday = addDaysUTC(weekStart, 6);
    const source = await http.post('/income-sources').set(...h.auth()).send({ label: 'Salaire', usualAmount: 8000, defaultAccountId: accountId }).expect(201);
    await http.post(`/income-sources/${source.body.id}/occurrences`).set(...h.auth()).send({ usualDate: isoDate(sunday) }).expect(201);

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: isoDate(weekStart) }).expect(200);
    expect(dashboard.body.variable_budget_commitments).toBe(0);
  });

  // ---------- TEST 3 — non-régression : défaut true, budget non consommé compte en entier ----------
  it('TEST 3 — non-régression : includeInPrudentProjection par défaut (true), budget non consommé = montant entier', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const category = await http.post('/categories').set(...h.auth()).send({ name: 'Courses T3', kind: 'expense' }).expect(201);
    await createWeeklyBudget(h.auth, category.body.id, 4000); // includeInPrudentProjection omis — doit rester true

    const weekStart = nextMondayUTC(new Date());
    const sunday = addDaysUTC(weekStart, 6);
    const source = await http.post('/income-sources').set(...h.auth()).send({ label: 'Salaire', usualAmount: 8000, defaultAccountId: accountId }).expect(201);
    await http.post(`/income-sources/${source.body.id}/occurrences`).set(...h.auth()).send({ usualDate: isoDate(sunday) }).expect(201);

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: isoDate(weekStart) }).expect(200);
    expect(dashboard.body.variable_budget_commitments).toBe(4000);
  });

  // ---------- TEST 4 — non-régression : les indicateurs de pilotage restent inchangés sur la fiche budget ----------
  it('TEST 4 — non-régression : rythmeProjete/previsionRythmeRestant/projectionPrudenteRestante restent affichés tels quels sur la fiche budget', async () => {
    // GET /variable-budgets/:id calcule toujours sur `new Date()` réel (pas de
    // paramètre `at`) — on ancre donc weekStartDay sur le jour ISO d'aujourd'hui
    // pour qu'"aujourd'hui" soit systématiquement le jour 1 de la période
    // courante, quel que soit le jour réel d'exécution du test (déterministe).
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const category = await http.post('/categories').set(...h.auth()).send({ name: 'Courses T4', kind: 'expense' }).expect(201);
    const today = new Date();
    const isoDay = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId: category.body.id, referenceAmount: 1500, referencePeriod: 'semaine', weekStartDay: isoDay, startDate: '2020-01-01' })
      .expect(201);
    const budgetId = budget.body.id as string;
    await http.post('/expenses').set(...h.auth()).send({ amount: 300, accountId, categoryId: category.body.id, spentDate: today.toISOString() }).expect(201);

    const detail = await http.get(`/variable-budgets/${budgetId}`).set(...h.auth()).expect(200);
    // Le calcul de rythme (pilotage) reste exposé intact — seul le calcul de trésorerie (TEST 1) a changé.
    expect(detail.body.status.rythmeProjete).toBe(2100);
    expect(detail.body.status.previsionRythmeRestant).toBe(1800);
    expect(detail.body.status.projectionPrudenteRestante).toBe(1800); // MAX(1200,1800,0) — inchangé, affichage informatif uniquement
    expect(detail.body.status.budgetContractuelRestant).toBe(1200);
  });
});
