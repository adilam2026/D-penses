import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Mini-lot weekStartDay foyer (module Budgets, après Lot 2) : HouseholdSettings.weekStartDay
 * porte le jour de début de semaine par défaut du foyer. À la création d'un budget
 * hebdomadaire (VariableBudgetsService.create) : valeur explicite > réglage foyer >
 * fallback technique lundi (1). Jamais rétroactif — n'affecte que la création ;
 * update() des budgets existants reste 100% explicite ; un budget mensuel n'est
 * jamais impacté (nominalPeriod ignore weekStartDay pour referencePeriod='mois').
 */
describe('Mini-lot weekStartDay foyer — défaut hebdomadaire, sans impact rétroactif ni mensuel (e2e)', () => {
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
    const token = await signupVerified(http, mailer, `lot29+${run}+${seq}@example.com`, 'password123', 'L29', 'T');
    const household = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer Lot29 ${seq}` }).expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function createCategory(auth: () => [string, string], name: string) {
    const res = await http.post('/categories').set(...auth()).send({ name, kind: 'expense' }).expect(201);
    return res.body.id as string;
  }

  // ---------- TEST 1 — foyer par défaut (weekStartDay=1, jamais modifié) → budget hebdo sans valeur explicite = 1 ----------
  it('TEST 1 — foyer non configuré (weekStartDay=1 par défaut du schéma) : un budget hebdo sans weekStartDay explicite est créé avec 1', async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation W1');

    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 1500, referencePeriod: 'semaine', startDate: '2020-01-01' })
      .expect(201);
    expect(budget.body.weekStartDay).toBe(1);
  });

  // ---------- TEST 2 — foyer réglé à 7 → budget hebdo sans valeur explicite = 7 ----------
  it('TEST 2 — foyer réglé à weekStartDay=7 : un budget hebdo sans weekStartDay explicite hérite de la valeur du foyer', async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation W2');

    await http.patch('/households/settings').set(...h.auth()).send({ weekStartDay: 7 }).expect(200);

    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 1500, referencePeriod: 'semaine', startDate: '2020-01-01' })
      .expect(201);
    expect(budget.body.weekStartDay).toBe(7);
  });

  // ---------- TEST 3 — valeur explicite gagne sur le réglage foyer ----------
  it('TEST 3 — foyer réglé à weekStartDay=7 mais requête avec weekStartDay explicite (3) : la valeur explicite gagne', async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation W3');

    await http.patch('/households/settings').set(...h.auth()).send({ weekStartDay: 7 }).expect(200);

    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 1500, referencePeriod: 'semaine', weekStartDay: 3, startDate: '2020-01-01' })
      .expect(201);
    expect(budget.body.weekStartDay).toBe(3);
  });

  // ---------- TEST 4 — budget mensuel jamais impacté par le réglage foyer ----------
  it('TEST 4 — foyer réglé à weekStartDay=7 : un budget MENSUEL sans weekStartDay explicite reste à 1, jamais impacté', async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation W4');

    await http.patch('/households/settings').set(...h.auth()).send({ weekStartDay: 7 }).expect(200);

    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 4000, referencePeriod: 'mois', startDate: '2020-01-01' })
      .expect(201);
    expect(budget.body.weekStartDay).toBe(1);
  });

  // ---------- TEST 5 — non-régression du calcul de période avec le nouveau défaut foyer ----------
  it('TEST 5 — non-régression : un budget hebdo créé avec le défaut foyer (7) calcule sa période courante sur ce jour, sans changement du moteur nominalPeriod', async () => {
    const h = await newHousehold();
    const accountId = (
      await http.post('/accounts').set(...h.auth()).send({ name: 'Compte', type: 'courant', initialBalance: 5000 }).expect(201)
    ).body.id as string;
    const categoryId = await createCategory(h.auth, 'Alimentation W5');

    // GET /variable-budgets/:id calcule toujours sur `new Date()` réel — on règle
    // donc le foyer sur le jour ISO d'aujourd'hui pour qu'"aujourd'hui" soit le
    // jour 1 de la période courante, quel que soit le jour réel d'exécution du test.
    const today = new Date();
    const isoDay = today.getUTCDay() === 0 ? 7 : today.getUTCDay();
    await http.patch('/households/settings').set(...h.auth()).send({ weekStartDay: isoDay }).expect(200);

    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 1500, referencePeriod: 'semaine', startDate: '2020-01-01' })
      .expect(201);
    expect(budget.body.weekStartDay).toBe(isoDay);
    const budgetId = budget.body.id as string;

    await http.post('/expenses').set(...h.auth()).send({ amount: 300, accountId, categoryId, spentDate: today.toISOString() }).expect(201);

    const detail = await http.get(`/variable-budgets/${budgetId}`).set(...h.auth()).expect(200);
    // Aujourd'hui = jour 1 de la période (weekStartDay=isoDay) : la fenêtre calculée
    // par nominalPeriod (moteur inchangé) commence donc exactement aujourd'hui.
    expect(detail.body.status.periodStart.slice(0, 10)).toBe(today.toISOString().slice(0, 10));
    expect(detail.body.status.consommeADate).toBe(300);
  });
});
