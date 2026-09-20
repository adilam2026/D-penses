import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Point 7 — "Modifier un plan financier" doit permettre de gérer réellement
 * les bénéficiaires d'un poste EXISTANT (charge_plan_child), jamais réservé
 * à la création. GET /charge-plans/:id expose désormais children +
 * financialPlan.planType (additif) pour que le mobile sache si le champ a un
 * sens pour ce poste (uniquement un plan scolaire, même règle que "Ajouter un
 * poste"). PATCH childIds remplace intégralement la liste, sans jamais
 * toucher Deadline/Payment (relation indépendante de l'historique payé).
 */
describe('Point 7 — bénéficiaires d\'un poste existant : GET expose children/planType, PATCH childIds les remplace (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot63+${run}+${seq}@example.com`, 'password123', 'L63', 'T');
    const household = await http.post('/households').set('Authorization', `Bearer ${signupToken}`).send({ name: `Foyer Lot63 ${seq}` }).expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function createChild(auth: () => [string, string], firstName: string) {
    const res = await http.post('/children').set(...auth()).send({ firstName, lastName: 'D' }).expect(201);
    return res.body.id as string;
  }

  // POST /financial-plans (générique) n'accepte pas planType (réservé aux
  // assistants dédiés, school-wizard/travel-wizard) — on passe par
  // /school-wizard pour obtenir un vrai FinancialPlan.planType='school'.
  async function createSchoolPlan(auth: () => [string, string], childId: string) {
    const res = await http
      .post('/school-wizard')
      .set(...auth())
      .send({
        label: 'École 2026/2027',
        childIds: [childId],
        periodStart: '2026-09-01',
        periodEnd: '2027-06-30',
        items: [{ label: 'Scolarité T1', amount: 5000, dueDate: '2026-09-30' }],
      })
      .expect(201);
    return res.body.financialPlan.id as string;
  }

  it('GET /charge-plans/:id expose children (vide à la création) et financialPlan.planType pour un plan scolaire', async () => {
    const { auth } = await newHousehold();
    const childId = await createChild(auth, 'Aîné');
    const res = await http
      .post('/school-wizard')
      .set(...auth())
      .send({
        label: 'École Lot63',
        childIds: [childId],
        periodStart: '2026-09-01',
        periodEnd: '2027-06-30',
        items: [{ label: 'Scolarité T1', amount: 5000, dueDate: '2026-09-30' }],
      })
      .expect(201);
    const chargePlanId = (res.body.chargePlans as { id: string }[])[0].id;

    const detail = await http.get(`/charge-plans/${chargePlanId}`).set(...auth()).expect(200);
    expect(detail.body.financialPlan?.planType).toBe('school');
    expect(Array.isArray(detail.body.children)).toBe(true);
  });

  it('PATCH childIds ajoute puis remplace intégralement les bénéficiaires (jamais un ajout cumulatif)', async () => {
    const { auth } = await newHousehold();
    const category = await http.post('/categories').set(...auth()).send({ name: 'Cat Lot63', kind: 'expense' }).expect(201);
    const child1 = await createChild(auth, 'Aîné');
    const child2 = await createChild(auth, 'Cadette');
    const financialPlanId = await createSchoolPlan(auth, child1);
    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({
        label: 'Fournitures',
        categoryId: category.body.id,
        financialPlanId,
        startDate: '2026-10-01',
        generationMode: 'calendrier_manuel',
        obligationStatus: 'obligatoire',
      })
      .expect(201);

    // Ajout d'un premier bénéficiaire.
    const patch1 = await http
      .patch(`/charge-plans/${chargePlan.body.id}`)
      .set(...auth())
      .send({ childIds: [child1] })
      .expect(200);
    expect(patch1.body.children.map((c: { childId: string }) => c.childId)).toEqual([child1]);

    // Remplacement complet (jamais cumulatif) : child1 retiré, child2 ajouté.
    const patch2 = await http
      .patch(`/charge-plans/${chargePlan.body.id}`)
      .set(...auth())
      .send({ childIds: [child2] })
      .expect(200);
    expect(patch2.body.children.map((c: { childId: string }) => c.childId)).toEqual([child2]);

    // childIds=[] retire tous les bénéficiaires.
    const patch3 = await http
      .patch(`/charge-plans/${chargePlan.body.id}`)
      .set(...auth())
      .send({ childIds: [] })
      .expect(200);
    expect(patch3.body.children).toEqual([]);
  });

  it('PATCH childIds ne touche jamais une échéance déjà payée (Deadline/Payment intacts)', async () => {
    const { auth } = await newHousehold();
    const account = await http.post('/accounts').set(...auth()).send({ name: 'Compte', type: 'courant', initialBalance: 5000 }).expect(201);
    const childId = await createChild(auth, 'Aîné');
    const financialPlanId = await createSchoolPlan(auth, childId);
    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({
        label: 'Scolarité',
        financialPlanId,
        startDate: '2026-10-01',
        generationMode: 'calendrier_manuel',
        obligationStatus: 'obligatoire',
      })
      .expect(201);
    const deadline = await http
      .post(`/charge-plans/${chargePlan.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-10-05', amountCurrent: 400, amountStatus: 'confirme' })
      .expect(201);
    await http
      .post(`/deadlines/${deadline.body.id}/payments`)
      .set(...auth())
      .send({ amount: 400, accountId: account.body.id, paidDate: '2026-10-05' })
      .expect(201);
    await http.post(`/deadlines/${deadline.body.id}/close`).set(...auth()).expect(201);

    await http
      .patch(`/charge-plans/${chargePlan.body.id}`)
      .set(...auth())
      .send({ childIds: [childId] })
      .expect(200);

    const deadlineAfter = await http.get(`/deadlines/${deadline.body.id}`).set(...auth()).expect(200);
    expect(deadlineAfter.body.financialStatus).toBe('soldee');
    expect(Number(deadlineAfter.body.amountCurrent)).toBe(400);
  });

  it('un poste hors plan (financialPlanId=null) : financialPlan est absent/null, children reste [] par défaut', async () => {
    const { auth } = await newHousehold();
    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Internet', startDate: '2026-10-01', generationMode: 'calendrier_manuel', obligationStatus: 'obligatoire' })
      .expect(201);

    const detail = await http.get(`/charge-plans/${chargePlan.body.id}`).set(...auth()).expect(200);
    expect(detail.body.financialPlan).toBeNull();
    expect(detail.body.children).toEqual([]);
  });
});
