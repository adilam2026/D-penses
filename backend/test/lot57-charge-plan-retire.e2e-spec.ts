import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Corrections consolidées (point 14.1) — POST /charge-plans/:id/retire : action
 * métier explicite et distincte de DELETE /charge-plans/:id (contrat de DELETE
 * inchangé, vérifié ci-dessous). Retire un poste d'un plan financier SANS
 * jamais le supprimer : historique payé intégralement conservé, seules les
 * échéances futures ouvertes SANS paiement sont annulées, le poste passe
 * inactif (récurrence arrêtée) et est détaché du plan (financialPlanId=null).
 */
describe('Corrections consolidées (point 14.1) — retrait explicite d\'un poste de plan (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  const run = Date.now();

  const mailer = new FakeMailer();
  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold(tag: string) {
    const signupToken = await signupVerified(http, mailer, `lot57+${tag}+${run}@example.com`, 'password123', 'L57', 'T');
    const household = await http.post('/households').set('Authorization', `Bearer ${signupToken}`).send({ name: `Foyer Lot57 ${tag}` }).expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function newPlan(auth: () => [string, string]) {
    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'Plan Lot57', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
      .expect(201);
    return plan.body.id as string;
  }

  it('A. poste AVEC historique de paiement : DELETE reste refusé (409, contrat inchangé), retire() conserve tout, annule seulement le futur sans paiement, détache et désactive', async () => {
    const { auth } = await newHousehold('a');
    const planId = await newPlan(auth);
    const category = await http.post('/categories').set(...auth()).send({ name: 'Cat Lot57 A', kind: 'expense' }).expect(201);
    const account = await http.post('/accounts').set(...auth()).send({ name: 'Compte Lot57 A', type: 'courant', initialBalance: 5000 }).expect(201);

    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Poste A', categoryId: category.body.id, startDate: '2026-10-01', financialPlanId: planId, generationMode: 'calendrier_manuel', obligationStatus: 'optionnelle_souscrite' })
      .expect(201);

    // d1 : payée intégralement (historique à protéger).
    const d1 = await http.post(`/charge-plans/${chargePlan.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-10-05', amountCurrent: 100, amountStatus: 'confirme' }).expect(201);
    await http.post(`/deadlines/${d1.body.id}/payments`).set(...auth()).send({ amount: 100, accountId: account.body.id }).expect(201);
    await http.post(`/deadlines/${d1.body.id}/close`).set(...auth()).expect(201);

    // d2 : ouverte, SANS paiement — doit être annulée par retire().
    const d2 = await http.post(`/charge-plans/${chargePlan.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-11-05', amountCurrent: 200, amountStatus: 'confirme' }).expect(201);

    // Le contrat DELETE existant reste inchangé : refus 409 (historique de paiement).
    await http.delete(`/charge-plans/${chargePlan.body.id}`).set(...auth()).expect(409);

    // retire() : action distincte, jamais un détournement de DELETE.
    const retired = await http.post(`/charge-plans/${chargePlan.body.id}/retire`).set(...auth()).expect(201);
    expect(retired.body.status).toBe('inactif');
    expect(retired.body.financialPlanId).toBeNull();
    expect(retired.body.cancelledDeadlinesCount).toBe(1);

    // d1 (payée) totalement inchangée — aucune transaction réelle supprimée.
    const d1After = await http.get(`/deadlines/${d1.body.id}`).set(...auth()).expect(200);
    expect(d1After.body.financialStatus).toBe('soldee');
    const d1Payments = await http.get(`/deadlines/${d1.body.id}/payments`).set(...auth()).expect(200);
    expect(d1Payments.body).toHaveLength(1);
    expect(Number(d1Payments.body[0].amount)).toBe(100);

    // d2 (sans paiement) annulée.
    const d2After = await http.get(`/deadlines/${d2.body.id}`).set(...auth()).expect(200);
    expect(d2After.body.financialStatus).toBe('annulee');

    // Le ChargePlan lui-même existe toujours (jamais supprimé, contrairement à DELETE sans historique).
    await http.get(`/charge-plans/${chargePlan.body.id}`).set(...auth()).expect(200);
  });

  it("B. poste SANS aucun historique : retire() conserve quand même le ChargePlan (jamais de suppression physique via cette route)", async () => {
    const { auth } = await newHousehold('b');
    const planId = await newPlan(auth);
    const category = await http.post('/categories').set(...auth()).send({ name: 'Cat Lot57 B', kind: 'expense' }).expect(201);

    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Poste B', categoryId: category.body.id, startDate: '2026-10-01', financialPlanId: planId, generationMode: 'calendrier_manuel', obligationStatus: 'optionnelle_souscrite' })
      .expect(201);
    const deadline = await http.post(`/charge-plans/${chargePlan.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-10-05', amountCurrent: 50, amountStatus: 'confirme' }).expect(201);

    const retired = await http.post(`/charge-plans/${chargePlan.body.id}/retire`).set(...auth()).expect(201);
    expect(retired.body.status).toBe('inactif');
    expect(retired.body.financialPlanId).toBeNull();
    expect(retired.body.cancelledDeadlinesCount).toBe(1);

    await http.get(`/charge-plans/${chargePlan.body.id}`).set(...auth()).expect(200);
    const deadlineAfter = await http.get(`/deadlines/${deadline.body.id}`).set(...auth()).expect(200);
    expect(deadlineAfter.body.financialStatus).toBe('annulee');
  });

  it("C. un poste hors plan (financialPlanId déjà null) refuse retire() — rien à en retirer", async () => {
    const { auth } = await newHousehold('c');
    const category = await http.post('/categories').set(...auth()).send({ name: 'Cat Lot57 C', kind: 'expense' }).expect(201);
    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Charge autonome C', categoryId: category.body.id, startDate: '2026-10-01', generationMode: 'calendrier_manuel', obligationStatus: 'obligatoire' })
      .expect(201);

    await http.post(`/charge-plans/${chargePlan.body.id}/retire`).set(...auth()).expect(400);
  });
});
