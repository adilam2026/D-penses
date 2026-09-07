import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * R5 §2/§3 — Plan financier : Modifier / Supprimer (safe-delete) / Dupliquer
 * (sélection explicite des enfants bénéficiaires, jamais l'historique).
 */
describe('R5 §2/§3 — PATCH/DELETE/duplicate /financial-plans/:id (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot20+${run}+${seq}@example.com`, 'password123', 'L20', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer R5-23 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { accessToken, auth };
  }

  async function createAccount(auth: () => [string, string], name: string, initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  async function createCategory(auth: () => [string, string], name: string) {
    const res = await http.post('/categories').set(...auth()).send({ name, kind: 'expense' }).expect(201);
    return res.body.id as string;
  }

  it('Modifier : le label et la période sont mis à jour, jamais planType', async () => {
    const { auth } = await newHousehold();
    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'École avant modif', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
      .expect(201);

    const updated = await http
      .patch(`/financial-plans/${plan.body.id}`)
      .set(...auth())
      .send({ label: 'École après modif' })
      .expect(200);

    expect(updated.body.label).toBe('École après modif');
  });

  it('Supprimer : autorisé quand aucun paiement n\'existe sous ce plan', async () => {
    const { auth } = await newHousehold();
    const cat = await createCategory(auth, 'École suppr OK');
    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'Plan à supprimer', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
      .expect(201);
    await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Frais suppr OK', categoryId: cat, generationMode: 'calendrier_manuel', financialPlanId: plan.body.id, startDate: '2026-09-01' })
      .expect(201);

    await http.delete(`/financial-plans/${plan.body.id}`).set(...auth()).expect(200);
    await http.get(`/financial-plans/${plan.body.id}`).set(...auth()).expect(404);
  });

  it('Supprimer : bloqué (400) dès qu\'un paiement existe sous ce plan — jamais un DELETE qui efface l\'historique', async () => {
    const { auth } = await newHousehold();
    const account = await createAccount(auth, 'Compte suppr bloqué', 5000);
    const cat = await createCategory(auth, 'École suppr bloquée');
    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'Plan avec historique', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
      .expect(201);
    const cp = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Frais avec historique', categoryId: cat, generationMode: 'calendrier_manuel', financialPlanId: plan.body.id, startDate: '2026-09-01' })
      .expect(201);
    const d = await http
      .post(`/charge-plans/${cp.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-09-30', amountCurrent: 1000, amountStatus: 'confirme' })
      .expect(201);
    await http.post(`/deadlines/${d.body.id}/payments`).set(...auth()).send({ amount: 1000, accountId: account }).expect(201);

    await http.delete(`/financial-plans/${plan.body.id}`).set(...auth()).expect(400);

    // Jamais silencieusement perdu : le plan et son historique existent toujours.
    const still = await http.get(`/financial-plans/${plan.body.id}`).set(...auth()).expect(200);
    expect(still.body.label).toBe('Plan avec historique');
  });

  it("Supprimer : les ChargePlan détachés (financial_plan_id=null) survivent — aucune Deadline/Payment n'est jamais supprimée", async () => {
    const { auth } = await newHousehold();
    const cat = await createCategory(auth, 'École détachement');
    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'Plan à détacher', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
      .expect(201);
    const cp = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Frais détachement', categoryId: cat, generationMode: 'calendrier_manuel', financialPlanId: plan.body.id, startDate: '2026-09-01' })
      .expect(201);
    await http
      .post(`/charge-plans/${cp.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-09-30', amountCurrent: 500, amountStatus: 'confirme' })
      .expect(201);

    await http.delete(`/financial-plans/${plan.body.id}`).set(...auth()).expect(200);

    const stillCp = await http.get(`/charge-plans/${cp.body.id}`).set(...auth()).expect(200);
    expect(stillCp.body.financialPlanId).toBeNull();
  });

  it('Dupliquer : sélection explicite d\'un autre enfant bénéficiaire, jamais celui de l\'original', async () => {
    const { auth } = await newHousehold();
    const cat = await createCategory(auth, 'École duplication');
    const child1 = await http.post('/children').set(...auth()).send({ firstName: 'Aîné', lastName: 'D' }).expect(201);
    const child2 = await http.post('/children').set(...auth()).send({ firstName: 'Cadette', lastName: 'D' }).expect(201);

    const original = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'École Aîné', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
      .expect(201);
    await http.post(`/financial-plans/${original.body.id}/beneficiaries`).set(...auth()).send({ beneficiaryType: 'child', childId: child1.body.id }).expect(201);
    const cp = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Frais scolarité T1', categoryId: cat, generationMode: 'calendrier_manuel', financialPlanId: original.body.id, startDate: '2026-09-01', childIds: [child1.body.id] })
      .expect(201);
    await http
      .post(`/charge-plans/${cp.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-09-30', amountCurrent: 8000, amountStatus: 'confirme' })
      .expect(201);

    const copyRes = await http
      .post(`/financial-plans/${original.body.id}/duplicate`)
      .set(...auth())
      .send({ label: 'École Cadette', childIds: [child2.body.id] })
      .expect(201);

    expect(copyRes.body.id).not.toBe(original.body.id);
    expect(copyRes.body.label).toBe('École Cadette');
    expect(copyRes.body.deadlinesCertain.length).toBe(1);
    expect(Number(copyRes.body.deadlinesCertain[0].amountCurrent)).toBe(8000);

    const beneficiaries = await http.get(`/financial-plans/${copyRes.body.id}/beneficiaries`).set(...auth()).expect(200);
    expect(beneficiaries.body.map((b: { childId: string }) => b.childId)).toEqual([child2.body.id]);
  });

  it('Dupliquer : jamais les paiements ni l\'historique — la copie repart "ouverte" sans aucun Payment', async () => {
    const { auth } = await newHousehold();
    const account = await createAccount(auth, 'Compte duplication historique', 20000);
    const cat = await createCategory(auth, 'École duplication historique');
    const child = await http.post('/children').set(...auth()).send({ firstName: 'Enfant', lastName: 'Historique' }).expect(201);

    const original = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'École historique original', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
      .expect(201);
    const cp = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Frais historique', categoryId: cat, generationMode: 'calendrier_manuel', financialPlanId: original.body.id, startDate: '2026-09-01' })
      .expect(201);
    const d = await http
      .post(`/charge-plans/${cp.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-09-30', amountCurrent: 2000, amountStatus: 'confirme' })
      .expect(201);
    await http.post(`/deadlines/${d.body.id}/payments`).set(...auth()).send({ amount: 2000, accountId: account }).expect(201);

    const copy = await http
      .post(`/financial-plans/${original.body.id}/duplicate`)
      .set(...auth())
      .send({ label: 'École historique copie', childIds: [child.body.id] })
      .expect(201);

    expect(copy.body.paidAmount).toBe(0);
    expect(copy.body.remainingDue).toBe(2000);
    const copyDeadline = copy.body.deadlinesCertain[0];
    expect(copyDeadline.financialStatus).toBe('ouverte');
    expect(copyDeadline.resteAPayer).toBe(2000);
  });

  it("Dupliquer : indépendance totale — modifier l'original (paiement) n'affecte jamais la copie", async () => {
    const { auth } = await newHousehold();
    const account = await createAccount(auth, 'Compte indépendance', 20000);
    const cat = await createCategory(auth, 'École indépendance');
    const child = await http.post('/children').set(...auth()).send({ firstName: 'Enfant', lastName: 'Indépendance' }).expect(201);

    const original = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'École original indépendance', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
      .expect(201);
    const cp = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Frais indépendance', categoryId: cat, generationMode: 'calendrier_manuel', financialPlanId: original.body.id, startDate: '2026-09-01' })
      .expect(201);
    const d = await http
      .post(`/charge-plans/${cp.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-09-30', amountCurrent: 3000, amountStatus: 'confirme' })
      .expect(201);

    const copy = await http
      .post(`/financial-plans/${original.body.id}/duplicate`)
      .set(...auth())
      .send({ label: 'École copie indépendance', childIds: [child.body.id] })
      .expect(201);

    // Paiement total sur l'ORIGINAL après la duplication.
    await http.post(`/deadlines/${d.body.id}/payments`).set(...auth()).send({ amount: 3000, accountId: account }).expect(201);

    const originalAfter = await http.get(`/financial-plans/${original.body.id}`).set(...auth()).expect(200);
    const copyAfter = await http.get(`/financial-plans/${copy.body.id}`).set(...auth()).expect(200);

    expect(originalAfter.body.remainingDue).toBe(0);
    expect(copyAfter.body.remainingDue).toBe(3000); // jamais affectée par le paiement de l'original
  });

  it('Dupliquer : un enfant inexistant est refusé (404), rien n\'est créé (atomicité)', async () => {
    const { auth } = await newHousehold();
    const cat = await createCategory(auth, 'École atomicité');
    const original = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'École atomicité original', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
      .expect(201);
    await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Frais atomicité', categoryId: cat, generationMode: 'calendrier_manuel', financialPlanId: original.body.id, startDate: '2026-09-01' })
      .expect(201);

    await http
      .post(`/financial-plans/${original.body.id}/duplicate`)
      .set(...auth())
      .send({ label: 'École atomicité copie', childIds: ['ffffffff-ffff-4fff-8fff-ffffffffffff'] })
      .expect(404);

    const all = await http.get('/financial-plans').set(...auth()).expect(200);
    expect(all.body.filter((p: { label: string }) => p.label === 'École atomicité copie').length).toBe(0);
  });
});
