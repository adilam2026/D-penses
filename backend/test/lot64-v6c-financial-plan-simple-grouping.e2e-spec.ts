import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Convergence V6C §1/§2/§6/§11 (Test F) — le plan financier redéfini comme
 * simple regroupement de charges : création minimale (Nom* + description
 * facultative, sans période/objectif), chargeCount exposé, et surtout la
 * garantie de non-perte de données réelles lors de la suppression d'un plan
 * créé avec ce nouveau flux (jamais un Payment/historique supprimé).
 */
describe('Convergence V6C — FinancialPlan simple grouping (e2e)', () => {
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

  async function newHousehold() {
    seq += 1;
    const signupToken = await signupVerified(http, mailer, `lot64+${run}+${seq}@example.com`, 'password123', 'L64', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer Lot64 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { accessToken, auth };
  }

  async function createAccount(auth: () => [string, string], name: string, initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  it('Créer un plan avec seulement Nom + description (sans période) → 201, active=true par défaut', async () => {
    const { auth } = await newHousehold();
    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'Vacances été 2027', description: "Voyage en famille l'été prochain" })
      .expect(201);

    expect(plan.body.label).toBe('Vacances été 2027');
    expect(plan.body.description).toBe("Voyage en famille l'été prochain");
    expect(plan.body.active).toBe(true);
  });

  it('chargeCount reflète le nombre de charges rattachées, sans second calcul côté mobile', async () => {
    const { auth } = await newHousehold();
    const plan = await http.post('/financial-plans').set(...auth()).send({ label: 'Scolarité 2026-2027' }).expect(201);

    await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Scolarité T1', generationMode: 'calendrier_manuel', financialPlanId: plan.body.id, startDate: '2026-09-15' })
      .expect(201);
    await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Restauration T1', generationMode: 'calendrier_manuel', financialPlanId: plan.body.id, startDate: '2026-09-15' })
      .expect(201);

    const detail = await http.get(`/financial-plans/${plan.body.id}`).set(...auth()).expect(200);
    expect(detail.body.chargeCount).toBe(2);
  });

  it("Test F — supprimer un plan (nouveau flux simple) avec une charge déjà payée : le paiement/l'historique réel n'est JAMAIS supprimé", async () => {
    const { auth } = await newHousehold();
    const account = await createAccount(auth, 'Compte Lot64', 10000);
    const plan = await http.post('/financial-plans').set(...auth()).send({ label: 'Scolarité Lot64' }).expect(201);

    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Scolarité T1', generationMode: 'calendrier_manuel', financialPlanId: plan.body.id, startDate: '2026-09-15' })
      .expect(201);
    await http.post(`/charge-plans/${chargePlan.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-09-15', amountCurrent: 5000, amountStatus: 'confirme' }).expect(201);
    const deadlines = await http.get(`/charge-plans/${chargePlan.body.id}/deadlines`).set(...auth()).expect(200);
    const deadlineId = deadlines.body[0].id as string;

    await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 5000, accountId: account }).expect(201);
    await http.post(`/deadlines/${deadlineId}/close`).set(...auth()).expect(201);

    // Trace réelle du paiement dans les transactions AVANT suppression du plan.
    const txBefore = await http.get('/transactions').set(...auth()).expect(200);
    const paymentTxBefore = txBefore.body.items ?? txBefore.body;
    expect(Array.isArray(paymentTxBefore) ? paymentTxBefore.length : 0).toBeGreaterThan(0);

    await http.delete(`/financial-plans/${plan.body.id}`).set(...auth()).expect(200);

    // La Deadline payée reste intacte (financialStatus soldée, resteAPayer=0) —
    // jamais supprimée, même si le FinancialPlan/ChargePlan est détaché.
    const deadlineAfter = await http.get(`/deadlines/${deadlineId}`).set(...auth()).expect(200);
    expect(deadlineAfter.body.financialStatus).toBe('soldee');
    expect(deadlineAfter.body.resteAPayer).toBe(0);

    // Le paiement réel reste visible dans les transactions après suppression du plan.
    const txAfter = await http.get('/transactions').set(...auth()).expect(200);
    const paymentTxAfter = txAfter.body.items ?? txAfter.body;
    expect(Array.isArray(paymentTxAfter) ? paymentTxAfter.length : 0).toBe(
      Array.isArray(paymentTxBefore) ? paymentTxBefore.length : 0,
    );
  });

  it('Archiver un plan (active=false) via PATCH : le plan et ses charges restent consultables, aucune suppression', async () => {
    const { auth } = await newHousehold();
    const plan = await http.post('/financial-plans').set(...auth()).send({ label: 'Plan à archiver' }).expect(201);
    await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Charge X', generationMode: 'calendrier_manuel', financialPlanId: plan.body.id, startDate: '2026-09-01' })
      .expect(201);

    const archived = await http.patch(`/financial-plans/${plan.body.id}`).set(...auth()).send({ active: false }).expect(200);
    expect(archived.body.active).toBe(false);

    const detail = await http.get(`/financial-plans/${plan.body.id}`).set(...auth()).expect(200);
    expect(detail.body.active).toBe(false);
    expect(detail.body.chargeCount).toBe(1);
  });
});
