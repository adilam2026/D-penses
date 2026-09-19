import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Corrections consolidées (point 14.2) — POST /deadlines/:id/cancel sur une
 * échéance déjà PARTIELLEMENT payée : le paiement déjà enregistré reste
 * intégralement historisé (jamais supprimé), l'échéance sort de Calendrier
 * et de Projection comme n'importe quelle échéance annulée (même exclusion
 * déjà appliquée partout, cf. calendar.service.ts/projection.util.ts), et
 * les AUTRES échéances du même ChargePlan restent totalement inchangées —
 * l'annulation est strictement scoped à l'échéance ciblée (deadlines.service.ts
 * cancel() : `where: { id }`, jamais une opération de masse sur le poste).
 */
describe('Corrections consolidées (point 14.2) — annulation échéance partiellement payée (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot56+${run}@example.com`, 'password123', 'L56', 'T');
    const household = await http.post('/households').set('Authorization', `Bearer ${signupToken}`).send({ name: 'Foyer Lot56' }).expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  it('paiement partiel préservé, échéance annulée exclue de Calendrier/Projection, échéances sœurs du même ChargePlan inchangées', async () => {
    const { auth } = await newHousehold();

    const category = await http.post('/categories').set(...auth()).send({ name: 'Loisirs Lot56', kind: 'expense' }).expect(201);
    const account = await http.post('/accounts').set(...auth()).send({ name: 'Compte Lot56', type: 'courant', initialBalance: 5000 }).expect(201);

    // Un seul ChargePlan (calendrier_manuel), DEUX échéances — pour prouver que
    // l'annulation de l'une n'affecte jamais l'autre.
    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Activités Lot56', categoryId: category.body.id, startDate: '2026-10-01', generationMode: 'calendrier_manuel', obligationStatus: 'optionnelle_souscrite' })
      .expect(201);

    const d1 = await http
      .post(`/charge-plans/${chargePlan.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-10-05', amountCurrent: 200, amountStatus: 'confirme' })
      .expect(201);
    const d2 = await http
      .post(`/charge-plans/${chargePlan.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-10-08', amountCurrent: 300, amountStatus: 'confirme' })
      .expect(201);

    // Paiement PARTIEL sur d1 (100 sur 200 dû) — jamais soldée.
    await http.post(`/deadlines/${d1.body.id}/payments`).set(...auth()).send({ amount: 100, accountId: account.body.id }).expect(201);
    const d1Partial = await http.get(`/deadlines/${d1.body.id}`).set(...auth()).expect(200);
    expect(d1Partial.body.financialStatus).toBe('partiellement_payee');

    // Avant annulation : les deux échéances apparaissent au Calendrier.
    const calendarBefore = await http.get('/calendar').set(...auth()).query({ from: '2026-10-01', to: '2026-10-31' }).expect(200);
    expect(calendarBefore.body.events.some((e: { deadlineId?: string }) => e.deadlineId === d1.body.id)).toBe(true);
    expect(calendarBefore.body.events.some((e: { deadlineId?: string }) => e.deadlineId === d2.body.id)).toBe(true);

    // Annulation de d1 (partiellement payée) — autorisée (RG §12 : seules soldée/déjà annulée sont refusées).
    const cancelled = await http.post(`/deadlines/${d1.body.id}/cancel`).set(...auth()).expect(201);
    expect(cancelled.body.financialStatus).toBe('annulee');

    // Le paiement de 100 reste intégralement historisé — jamais supprimé/modifié.
    const paymentsAfter = await http.get(`/deadlines/${d1.body.id}/payments`).set(...auth()).expect(200);
    expect(paymentsAfter.body).toHaveLength(1);
    expect(Number(paymentsAfter.body[0].amount)).toBe(100);

    // d2 (échéance sœur du même ChargePlan) totalement inchangée.
    const d2After = await http.get(`/deadlines/${d2.body.id}`).set(...auth()).expect(200);
    expect(d2After.body.financialStatus).toBe('ouverte');
    expect(Number(d2After.body.amountCurrent)).toBe(300);

    // Après annulation : d1 disparaît du Calendrier, d2 y reste.
    const calendarAfter = await http.get('/calendar').set(...auth()).query({ from: '2026-10-01', to: '2026-10-31' }).expect(200);
    expect(calendarAfter.body.events.some((e: { deadlineId?: string }) => e.deadlineId === d1.body.id)).toBe(false);
    expect(calendarAfter.body.events.some((e: { deadlineId?: string }) => e.deadlineId === d2.body.id)).toBe(true);

    // Après annulation : d1 disparaît de Projection (expense_items du mois d'octobre), d2 y reste.
    const projection = await http.get('/projection/monthly').set(...auth()).query({ at: '2026-09-15', horizonMonths: 3 }).expect(200);
    const octoberBucket = projection.body.months.find((m: { month: string }) => m.month === '2026-10');
    expect(octoberBucket).toBeDefined();
    expect(octoberBucket.expense_items.some((it: { entityId: string }) => it.entityId === d1.body.id)).toBe(false);
    expect(octoberBucket.expense_items.some((it: { entityId: string }) => it.entityId === d2.body.id)).toBe(true);
  });
});
