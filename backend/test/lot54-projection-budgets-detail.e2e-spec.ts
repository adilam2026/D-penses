import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Corrections consolidées §10 — GET /projection/monthly expose désormais
 * budget_items (id/label/montant) par mois, listant EXACTEMENT les budgets
 * déjà comptés dans prudent_budget_remaining (jamais recalculé) : la somme
 * doit toujours égaler ce montant, y compris son caractère cumulatif (un
 * budget compté au mois N reste listé aux mois N+1, N+2..., même règle que
 * prudent_budget_remaining lui-même, cf. monthly-projection.util.ts).
 */
describe('Corrections consolidées §10 — budget_items du détail mensuel (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  const run = Date.now();
  let seq = 0;
  const REF = '2026-09-01';

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
    const signupToken = await signupVerified(http, mailer, `lot54proj+${run}+${seq}@example.com`, 'password123', 'L54', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer Lot54Proj ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function newAccount(auth: () => [string, string], initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name: 'Compte', type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  async function newCategory(auth: () => [string, string], name: string) {
    const res = await http.post('/categories').set(...auth()).send({ name, kind: 'expense' }).expect(201);
    return res.body.id as string;
  }

  async function newBudget(auth: () => [string, string], categoryId: string, referenceAmount: number) {
    const res = await http
      .post('/variable-budgets')
      .set(...auth())
      .send({ categoryId, referenceAmount, referencePeriod: 'mois', startDate: '2020-01-01', includeInPrudentProjection: true })
      .expect(201);
    return res.body.id as string;
  }

  async function monthly(auth: () => [string, string], horizonMonths: number) {
    const res = await http.get(`/projection/monthly?at=${REF}&horizonMonths=${horizonMonths}`).set(...auth()).expect(200);
    return res.body;
  }

  function findMonth(body: any, month: string) {
    return body.months.find((m: any) => m.month === month);
  }

  it('un budget non consommé apparaît dans budget_items du mois courant, et Σ amount === prudent_budget_remaining', async () => {
    const { auth } = await newHousehold();
    await newAccount(auth, 10000);
    const catId = await newCategory(auth, 'Courses');
    await newBudget(auth, catId, 3000);

    const body = await monthly(auth, 3);
    const month = findMonth(body, '2026-09');
    expect(month.prudent_budget_remaining).toBe(3000);
    expect(month.budget_items).toHaveLength(1);
    expect(month.budget_items[0].amount).toBe(3000);
    const sum = month.budget_items.reduce((s: number, b: { amount: number }) => s + b.amount, 0);
    expect(sum).toBe(month.prudent_budget_remaining);
  });

  it('sans aucun budget, budget_items est un tableau vide et prudent_budget_remaining=0', async () => {
    const { auth } = await newHousehold();
    await newAccount(auth, 10000);

    const body = await monthly(auth, 3);
    const month = findMonth(body, '2026-09');
    expect(month.budget_items).toEqual([]);
    expect(month.prudent_budget_remaining).toBe(0);
  });

  it('caractère cumulatif : le budget du mois 1 reste listé (et sommé) au mois 2, jamais réinitialisé', async () => {
    const { auth } = await newHousehold();
    await newAccount(auth, 10000);
    const catId = await newCategory(auth, 'Courses');
    await newBudget(auth, catId, 3000);

    const body = await monthly(auth, 3);
    const month1 = findMonth(body, '2026-09');
    const month2 = findMonth(body, '2026-10');

    expect(month1.budget_items.length).toBeGreaterThan(0);
    // Le mois 2 contient au moins le budget compté au mois 1 (cumul), en plus du sien propre.
    expect(month2.budget_items.length).toBeGreaterThanOrEqual(month1.budget_items.length);
    const sum2 = month2.budget_items.reduce((s: number, b: { amount: number }) => s + b.amount, 0);
    expect(sum2).toBe(month2.prudent_budget_remaining);
  });

  it("correction (point 1, projection budgets) — budget_items_this_period n'affiche qu'une seule occurrence par mois, jamais le cumul, même quand budget_items grandit", async () => {
    const { auth } = await newHousehold();
    await newAccount(auth, 10000);
    const catId = await newCategory(auth, 'Alimentation');
    await newBudget(auth, catId, 6000);

    const body = await monthly(auth, 3);
    const month1 = findMonth(body, '2026-09');
    const month2 = findMonth(body, '2026-10');
    const month3 = findMonth(body, '2026-11');

    // AFFICHAGE : une seule occurrence pertinente par mois, jamais le cumul des mois précédents.
    expect(month1.budget_items_this_period).toHaveLength(1);
    expect(month1.budget_items_this_period[0].amount).toBe(6000);
    expect(month1.budget_total_this_period).toBe(6000);

    expect(month2.budget_items_this_period).toHaveLength(1);
    expect(month2.budget_items_this_period[0].amount).toBe(6000);
    expect(month2.budget_total_this_period).toBe(6000);

    expect(month3.budget_items_this_period).toHaveLength(1);
    expect(month3.budget_total_this_period).toBe(6000);

    // CALCUL : le moteur cumulé (budget_items/prudent_budget_remaining) reste
    // intact et continue de croître — jamais supprimé du calcul financier.
    expect(month1.budget_items).toHaveLength(1);
    expect(month2.budget_items).toHaveLength(2);
    expect(month3.budget_items).toHaveLength(3);
    expect(month1.prudent_budget_remaining).toBe(6000);
    expect(month2.prudent_budget_remaining).toBe(12000);
    expect(month3.prudent_budget_remaining).toBe(18000);

    // Cohérence : Σ budget_items_this_period sur tous les mois === cumul final.
    const totalAcrossMonths = [month1, month2, month3].reduce((s: number, m: any) => s + m.budget_total_this_period, 0);
    expect(totalAcrossMonths).toBe(month3.prudent_budget_remaining);
  });

  it('includeInPrudentProjection=false → jamais listé dans budget_items', async () => {
    const { auth } = await newHousehold();
    await newAccount(auth, 10000);
    const catId = await newCategory(auth, 'Loisirs');
    await http
      .post('/variable-budgets')
      .set(...auth())
      .send({ categoryId: catId, referenceAmount: 2000, referencePeriod: 'mois', startDate: '2020-01-01', includeInPrudentProjection: false })
      .expect(201);

    const body = await monthly(auth, 3);
    const month = findMonth(body, '2026-09');
    expect(month.budget_items).toEqual([]);
    expect(month.prudent_budget_remaining).toBe(0);
  });
});
