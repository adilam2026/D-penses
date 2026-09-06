import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Vague 3 §13/§14/§15 (accueil-cockpit) — GET /dashboard/summary expose désormais
 * tauxCouverture/provisionCoverage par plan (bloc "Mes plans") et coverageStatus
 * par échéance (bloc "Prochaines échéances", couvert ≠ payé), plus
 * closing_free_capacity (bloc "Projection") — toutes des extensions additives
 * du même moteur déjà testé (financial-plans.service, treasury.util,
 * projection.util) : ce fichier vérifie seulement qu'elles remontent bien
 * jusqu'à l'accueil, jamais une nouvelle logique de calcul.
 */
describe('Vague 3 — accueil-cockpit : champs dashboard enrichis (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot15+${run}+${seq}@example.com`, 'password123', 'L15', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer Vague3 dashboard ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  it('financialPlansResume expose tauxCouverture et provisionCoverage (bloc "Mes plans")', async () => {
    const { auth } = await newHousehold();
    const account = await http.post('/accounts').set(...auth()).send({ name: 'BP dashboard', type: 'courant', initialBalance: 20000 }).expect(201);
    const category = await http.post('/categories').set(...auth()).send({ name: 'École dashboard', kind: 'expense' }).expect(201);
    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'École 2026/2027', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
      .expect(201);
    const cp = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Scolarité', categoryId: category.body.id, generationMode: 'calendrier_manuel', financialPlanId: plan.body.id, startDate: '2026-09-01' })
      .expect(201);
    const deadline = await http
      .post(`/charge-plans/${cp.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-09-30', amountCurrent: 10000, amountStatus: 'confirme' })
      .expect(201);
    const provision = await http
      .post('/provisions')
      .set(...auth())
      .send({ name: 'Provision dashboard', allocationMode: 'virtual_allocation', linkedAccountId: account.body.id })
      .expect(201);
    await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 4000 }).expect(201);
    await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId: deadline.body.id }).expect(201);

    const dashboard = await http.get('/dashboard/summary').set(...auth()).expect(200);
    const planResume = dashboard.body.financialPlansResume.find((p: { id: string }) => p.id === plan.body.id);
    expect(planResume.provisionCoverage).toBe(4000);
    expect(planResume.tauxCouverture).toBe(40); // 4000 / 10000 * 100

    // Bloc "Prochaines échéances" — coverageStatus distinct du statut de paiement.
    const item = dashboard.body.deadlineItems.find((d: { id: string }) => d.id === deadline.body.id);
    expect(item.coverageStatus).toBe('partielle');
  });

  it('deadlineItems marque "couverte" quand la provision couvre tout, "non_couverte" sans provision', async () => {
    const { auth } = await newHousehold();
    const bp = await http.post('/accounts').set(...auth()).send({ name: 'BP couverte', type: 'courant', initialBalance: 10000 }).expect(201);
    const category = await http.post('/categories').set(...auth()).send({ name: 'Cat couverte', kind: 'expense' }).expect(201);

    const cpCouvert = await http.post('/charge-plans').set(...auth()).send({ label: 'Couvert', categoryId: category.body.id, generationMode: 'calendrier_manuel', startDate: '2026-09-01' }).expect(201);
    const dCouvert = await http.post(`/charge-plans/${cpCouvert.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-09-30', amountCurrent: 1000, amountStatus: 'confirme' }).expect(201);
    const provision = await http.post('/provisions').set(...auth()).send({ name: 'Provision couverte', allocationMode: 'virtual_allocation', linkedAccountId: bp.body.id }).expect(201);
    await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 1000 }).expect(201);
    await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId: dCouvert.body.id }).expect(201);

    const cpNonCouvert = await http.post('/charge-plans').set(...auth()).send({ label: 'Non couvert', categoryId: category.body.id, generationMode: 'calendrier_manuel', startDate: '2026-09-01' }).expect(201);
    const dNonCouvert = await http.post(`/charge-plans/${cpNonCouvert.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-09-30', amountCurrent: 500, amountStatus: 'confirme' }).expect(201);

    const dashboard = await http.get('/dashboard/summary').set(...auth()).expect(200);
    const itemCouvert = dashboard.body.deadlineItems.find((d: { id: string }) => d.id === dCouvert.body.id);
    const itemNonCouvert = dashboard.body.deadlineItems.find((d: { id: string }) => d.id === dNonCouvert.body.id);
    expect(itemCouvert.coverageStatus).toBe('couverte');
    expect(itemNonCouvert.coverageStatus).toBe('non_couverte');
    // §10 — jamais confondu avec le paiement : aucun Payment n'a été créé pour ces échéances.
    const deadlineCouvert = await http.get(`/deadlines/${dCouvert.body.id}`).set(...auth()).expect(200);
    expect(deadlineCouvert.body.financialStatus).toBe('ouverte');
  });

  it('next_30_days expose closing_free_capacity (bloc "Dans 30 jours")', async () => {
    const { auth } = await newHousehold();
    await http.post('/accounts').set(...auth()).send({ name: 'Compte projection', type: 'courant', initialBalance: 5000 }).expect(201);

    const dashboard = await http.get('/dashboard/summary').set(...auth()).expect(200);
    expect(typeof dashboard.body.next_30_days.closing_free_capacity).toBe('number');
    expect(dashboard.body.next_30_days.closing_free_capacity).toBe(5000);
  });
});
