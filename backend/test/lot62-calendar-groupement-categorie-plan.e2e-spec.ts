import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Correction (point 5) — GET /calendar expose désormais financialPlanId et
 * categoryId/categoryName par événement lié à une Deadline, additivement
 * (mêmes événements, même tri, jamais dupliqué), pour permettre à la vue
 * mobile "Par catégorie / plan financier" de regrouper sans recalcul métier
 * côté client ni second appel API.
 */
describe('Correction (point 5) — GET /calendar expose financialPlanId/categoryId pour le regroupement mobile (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot62+${run}+${seq}@example.com`, 'password123', 'L62', 'T');
    const household = await http.post('/households').set('Authorization', `Bearer ${signupToken}`).send({ name: `Foyer Lot62 ${seq}` }).expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  it("un poste rattaché à un plan financier : l'événement expose financialPlanId (categoryId/categoryName restent tels quels, jamais un second recalcul)", async () => {
    const { auth } = await newHousehold();
    const category = await http.post('/categories').set(...auth()).send({ name: 'Cat Lot62 A', kind: 'expense' }).expect(201);
    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'Voiture · Opel Astra', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
      .expect(201);

    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({
        label: 'Vidange',
        categoryId: category.body.id,
        startDate: '2026-10-01',
        financialPlanId: plan.body.id,
        generationMode: 'calendrier_manuel',
        obligationStatus: 'optionnelle_souscrite',
      })
      .expect(201);
    const deadline = await http
      .post(`/charge-plans/${chargePlan.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-10-05', amountCurrent: 400, amountStatus: 'confirme' })
      .expect(201);

    const calendar = await http.get('/calendar').set(...auth()).query({ from: '2026-10-01', to: '2026-10-31' }).expect(200);
    const event = calendar.body.events.find((e: { deadlineId?: string }) => e.deadlineId === deadline.body.id);
    expect(event).toBeDefined();
    expect(event.financialPlanId).toBe(plan.body.id);
    expect(event.categoryId).toBe(category.body.id);
    expect(event.categoryName).toBe('Cat Lot62 A');
  });

  it('une charge autonome (sans plan) avec catégorie : financialPlanId=null, categoryId/categoryName renseignés', async () => {
    const { auth } = await newHousehold();
    const category = await http.post('/categories').set(...auth()).send({ name: 'Cat Lot62 B', kind: 'expense' }).expect(201);
    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Internet', categoryId: category.body.id, startDate: '2026-10-01', generationMode: 'calendrier_manuel', obligationStatus: 'obligatoire' })
      .expect(201);
    const deadline = await http
      .post(`/charge-plans/${chargePlan.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-10-10', amountCurrent: 200, amountStatus: 'confirme' })
      .expect(201);

    const calendar = await http.get('/calendar').set(...auth()).query({ from: '2026-10-01', to: '2026-10-31' }).expect(200);
    const event = calendar.body.events.find((e: { deadlineId?: string }) => e.deadlineId === deadline.body.id);
    expect(event).toBeDefined();
    expect(event.financialPlanId).toBeNull();
    expect(event.categoryId).toBe(category.body.id);
    expect(event.categoryName).toBe('Cat Lot62 B');
  });

  it('une charge sans catégorie ni plan : financialPlanId/categoryId/categoryName tous null (le mobile applique "Autres")', async () => {
    const { auth } = await newHousehold();
    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Divers', startDate: '2026-10-01', generationMode: 'calendrier_manuel', obligationStatus: 'obligatoire' })
      .expect(201);
    const deadline = await http
      .post(`/charge-plans/${chargePlan.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-10-12', amountCurrent: 50, amountStatus: 'confirme' })
      .expect(201);

    const calendar = await http.get('/calendar').set(...auth()).query({ from: '2026-10-01', to: '2026-10-31' }).expect(200);
    const event = calendar.body.events.find((e: { deadlineId?: string }) => e.deadlineId === deadline.body.id);
    expect(event).toBeDefined();
    expect(event.financialPlanId).toBeNull();
    expect(event.categoryId).toBeNull();
    expect(event.categoryName).toBeNull();
  });
});
