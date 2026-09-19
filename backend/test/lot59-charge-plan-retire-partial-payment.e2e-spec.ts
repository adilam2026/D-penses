import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Correction (point 14.1) — POST /charge-plans/:id/retire sur un poste dont
 * l'échéance est PARTIELLEMENT payée (1000 prévu, 400 payé, reliquat 600).
 *
 * Bug corrigé : retire() excluait auparavant toute échéance ayant déjà un
 * paiement (filtre `payments.length === 0`), donc une échéance partiellement
 * payée restait 'ouverte'/'partiellement_payee' avec son reliquat encore dû
 * après retrait du plan. Comportement attendu, aligné sur la règle déjà
 * appliquée par POST /deadlines/:id/cancel (point 14.2) :
 * - le paiement de 400 déjà enregistré reste intégralement dans l'historique
 *   (aucun Payment supprimé ni modifié) ;
 * - le reliquat de 600 est annulé (financialStatus → annulee), n'est plus
 *   une dette future ;
 * - l'échéance disparaît de Calendrier et de Projection (mêmes filtres
 *   d'exclusion déjà en place pour toute échéance annulée) ;
 * - le ChargePlan devient inactif et détaché du plan (financialPlanId=null).
 */
describe('Correction (point 14.1) — retrait d\'un poste avec échéance partiellement payée (e2e)', () => {
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

  async function newHousehold() {
    const signupToken = await signupVerified(http, mailer, `lot59+${run}@example.com`, 'password123', 'L59', 'T');
    const household = await http.post('/households').set('Authorization', `Bearer ${signupToken}`).send({ name: 'Foyer Lot59' }).expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  it('1000 prévu / 400 payé : retire() préserve le paiement, annule le reliquat, exclut de Calendrier/Projection, détache et désactive', async () => {
    const { auth } = await newHousehold();

    const category = await http.post('/categories').set(...auth()).send({ name: 'Cat Lot59', kind: 'expense' }).expect(201);
    const account = await http.post('/accounts').set(...auth()).send({ name: 'Compte Lot59', type: 'courant', initialBalance: 5000 }).expect(201);
    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'Plan Lot59', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
      .expect(201);
    const planId = plan.body.id as string;

    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({
        label: 'Poste Lot59',
        categoryId: category.body.id,
        startDate: '2026-10-01',
        financialPlanId: planId,
        generationMode: 'calendrier_manuel',
        obligationStatus: 'optionnelle_souscrite',
      })
      .expect(201);

    const deadline = await http
      .post(`/charge-plans/${chargePlan.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-10-05', amountCurrent: 1000, amountStatus: 'confirme' })
      .expect(201);

    // Paiement PARTIEL : 400 sur 1000 dû → reliquat 600, jamais soldée.
    await http.post(`/deadlines/${deadline.body.id}/payments`).set(...auth()).send({ amount: 400, accountId: account.body.id }).expect(201);
    const beforeRetire = await http.get(`/deadlines/${deadline.body.id}`).set(...auth()).expect(200);
    expect(beforeRetire.body.financialStatus).toBe('partiellement_payee');

    // Avant retrait : l'échéance apparaît bien au Calendrier et en Projection.
    const calendarBefore = await http.get('/calendar').set(...auth()).query({ from: '2026-10-01', to: '2026-10-31' }).expect(200);
    expect(calendarBefore.body.events.some((e: { deadlineId?: string }) => e.deadlineId === deadline.body.id)).toBe(true);
    const projectionBefore = await http.get('/projection/monthly').set(...auth()).query({ at: '2026-09-15', horizonMonths: 3 }).expect(200);
    const octoberBefore = projectionBefore.body.months.find((m: { month: string }) => m.month === '2026-10');
    expect(octoberBefore.expense_items.some((it: { entityId: string }) => it.entityId === deadline.body.id)).toBe(true);

    // Action : retrait du poste hors du plan.
    const retired = await http.post(`/charge-plans/${chargePlan.body.id}/retire`).set(...auth()).expect(201);
    expect(retired.body.status).toBe('inactif');
    expect(retired.body.financialPlanId).toBeNull();
    expect(retired.body.cancelledDeadlinesCount).toBe(1);

    // Le reliquat (600) est annulé — l'échéance n'est plus une dette future.
    const afterRetire = await http.get(`/deadlines/${deadline.body.id}`).set(...auth()).expect(200);
    expect(afterRetire.body.financialStatus).toBe('annulee');

    // Le paiement de 400 déjà réalisé reste intégralement dans l'historique —
    // jamais supprimé ni modifié.
    const paymentsAfter = await http.get(`/deadlines/${deadline.body.id}/payments`).set(...auth()).expect(200);
    expect(paymentsAfter.body).toHaveLength(1);
    expect(Number(paymentsAfter.body[0].amount)).toBe(400);

    // Après retrait : l'échéance disparaît du Calendrier (plus de dette active).
    const calendarAfter = await http.get('/calendar').set(...auth()).query({ from: '2026-10-01', to: '2026-10-31' }).expect(200);
    expect(calendarAfter.body.events.some((e: { deadlineId?: string }) => e.deadlineId === deadline.body.id)).toBe(false);

    // Après retrait : l'échéance disparaît de Projection (plus de reliquat futur).
    const projectionAfter = await http.get('/projection/monthly').set(...auth()).query({ at: '2026-09-15', horizonMonths: 3 }).expect(200);
    const octoberAfter = projectionAfter.body.months.find((m: { month: string }) => m.month === '2026-10');
    expect(octoberAfter.expense_items.some((it: { entityId: string }) => it.entityId === deadline.body.id)).toBe(false);

    // Aucune nouvelle échéance générée pour ce poste (inactif + détaché).
    const deadlinesAfter = await http.get(`/charge-plans/${chargePlan.body.id}/deadlines`).set(...auth()).expect(200);
    expect(deadlinesAfter.body).toHaveLength(1);
  });
});
