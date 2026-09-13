import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Lot 3 (module Budgets) : alerte de rythme = % consommé (consommeADate/budgetPeriode)
 * vs % de période écoulée (joursEcoules/nominalTotalDays), jamais previsionRythmeRestant/
 * rythmeProjete (indicateurs informatifs distincts, ne définissent pas l'alerte). Additive
 * et distincte de healthStatus (ratio consommé/plafond seul) — jamais fusionnée.
 *
 * rythmeAlerte est calculée UNE SEULE FOIS dans computeBudgetPeriodStatus
 * (common/ledger/variable-budget.util.ts) et irrigue automatiquement GET
 * /variable-budgets (liste/détail) ET GET /dashboard/summary.budgetsResume
 * (Home) sans aucun code supplémentaire dans variable-budgets.service.ts ni
 * dashboard.service.ts — ces tests prouvent ce câblage bout-en-bout.
 */
describe('Lot 3 — Alerte de rythme des budgets variables, exposée sur le détail et le résumé Home (e2e)', () => {
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
    const token = await signupVerified(http, mailer, `lot30+${run}+${seq}@example.com`, 'password123', 'L30', 'T');
    const household = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer Lot30 ${seq}` }).expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function createAccount(auth: () => [string, string], initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name: 'Compte', type: 'courant', initialBalance }).expect(201);
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

  // ---------- TEST 1 — GET /variable-budgets/:id expose l'alerte de rythme (dépassement de rythme) ----------
  it("TEST 1 — GET /variable-budgets/:id : consumptionRatio/elapsedRatio/rythmeAlerte exposés, alerte=true quand le rythme dépasse le temps écoulé", async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const category = await http.post('/categories').set(...h.auth()).send({ name: 'Courses R1', kind: 'expense' }).expect(201);
    // Ancre weekStartDay sur le jour ISO d'aujourd'hui pour que "aujourd'hui" soit
    // toujours le jour 1 de la période courante (même contrainte que lot26 TEST 4 —
    // GET /variable-budgets/:id calcule sur `new Date()` réel, pas de paramètre `at`).
    const today = new Date();
    const isoDay = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId: category.body.id, referenceAmount: 1500, referencePeriod: 'semaine', weekStartDay: isoDay, startDate: '2020-01-01' })
      .expect(201);
    const budgetId = budget.body.id as string;

    // Jour 1/7 (aujourd'hui = jour 1) : elapsedRatio ≈ 1/7 ≈ 0,143. 1000 DH dépensés
    // dès ce premier jour ⇒ consumptionRatio = 1000/1500 ≈ 0,667 ≫ 0,143 → alerte.
    await http.post('/expenses').set(...h.auth()).send({ amount: 1000, accountId, categoryId: category.body.id, spentDate: today.toISOString() }).expect(201);

    const detail = await http.get(`/variable-budgets/${budgetId}`).set(...h.auth()).expect(200);
    expect(detail.body.status.consumptionRatio).toBeCloseTo(1000 / 1500, 2);
    expect(detail.body.status.elapsedRatio).toBeCloseTo(1 / 7, 2);
    expect(detail.body.status.rythmeAlerte).toBe(true);
    // healthStatus reste calculé indépendamment (ratio consommé/plafond seul, 1000/1500=66,7% < 80%) — jamais fusionné avec rythmeAlerte.
    expect(detail.body.status.healthStatus).toBe('sous_budget');
  });

  // ---------- TEST 2 — pas d'alerte quand le rythme reste dans les clous ----------
  it('TEST 2 — GET /variable-budgets/:id : rythmeAlerte=false quand % consommé reste sous % période écoulée', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const category = await http.post('/categories').set(...h.auth()).send({ name: 'Courses R2', kind: 'expense' }).expect(201);

    const weekStart = nextMondayUTC(new Date());
    const thursday = addDaysUTC(weekStart, 3); // jour 4/7 — elapsedRatio ≈ 0,571

    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId: category.body.id, referenceAmount: 1500, referencePeriod: 'semaine', startDate: '2020-01-01' })
      .expect(201);
    const budgetId = budget.body.id as string;

    // 300 DH sur 1500 au jour 4/7 : consumptionRatio=0,2 ≪ elapsedRatio≈0,571 → pas d'alerte.
    await http.post('/expenses').set(...h.auth()).send({ amount: 300, accountId, categoryId: category.body.id, spentDate: thursday.toISOString() }).expect(201);

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: thursday.toISOString().slice(0, 10) }).expect(200);
    const resume = dashboard.body.budgetsResume.find((b: any) => b.id === budgetId);
    expect(resume.status.rythmeAlerte).toBe(false);
  });

  // ---------- TEST 3 — GET /dashboard/summary.budgetsResume expose rythmeAlerte pour Home, sans code supplémentaire ----------
  it('TEST 3 — GET /dashboard/summary : budgetsResume expose consommé/plafond/restant/rythmeAlerte pour chaque budget (câblage Home)', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const category = await http.post('/categories').set(...h.auth()).send({ name: 'Courses R3', kind: 'expense' }).expect(201);

    const weekStart = nextMondayUTC(new Date());
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId: category.body.id, referenceAmount: 1500, referencePeriod: 'semaine', startDate: '2020-01-01' })
      .expect(201);
    const budgetId = budget.body.id as string;

    // Jour 1/7, 1000 DH dépensés dès le premier jour ⇒ alerte de rythme.
    await http.post('/expenses').set(...h.auth()).send({ amount: 1000, accountId, categoryId: category.body.id, spentDate: weekStart.toISOString() }).expect(201);

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: weekStart.toISOString().slice(0, 10) }).expect(200);
    const resume = dashboard.body.budgetsResume.find((b: any) => b.id === budgetId);
    expect(resume).toBeTruthy();
    expect(resume.categoryName).toBe(category.body.name);
    expect(resume.referenceAmount).toBe(1500);
    expect(resume.status.consommeADate).toBe(1000);
    expect(resume.status.budgetPeriode).toBe(1500);
    expect(resume.status.budgetContractuelRestant).toBe(500);
    expect(resume.status.rythmeAlerte).toBe(true);
  });
});
