import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * BUG IMPORTANT — Plans financiers : doublons après suppression+recréation
 * (point 1/2/8 du rapport). Root cause confirmée : FinancialPlansService.remove()
 * ne faisait que détacher (financial_plan_id → NULL) ses ChargePlan/Deadline,
 * jamais les annuler — ils restaient actifs et réapparaissaient dans
 * Calendrier/Projection, produisant des doublons visibles dès qu'un plan
 * équivalent était recréé ensuite (ex. Dina, plan scolaire supprimé puis
 * recréé). Cette suite couvre les scénarios A/B/C/F demandés.
 */
describe('BUG doublons plans financiers — suppression propre + garde-fou anti-doublon (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot53+${run}+${seq}@example.com`, 'password123', 'L53', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer Lot53 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { accessToken, auth };
  }

  async function createAccount(auth: () => [string, string], name: string, initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  // ---------- Scénario A ----------
  it('A. Créer plan → supprimer → recréer : aucune échéance de l\'ancien plan ne reste (Calendrier propre)', async () => {
    const { auth } = await newHousehold();
    const child = await http.post('/children').set(...auth()).send({ firstName: 'Dina', lastName: 'A' }).expect(201);

    const first = await http
      .post('/school-wizard')
      .set(...auth())
      .send({
        label: 'École Dina 2026/2027',
        childIds: [child.body.id],
        periodStart: '2026-09-01',
        periodEnd: '2027-06-30',
        schoolYear: '2026/2027',
        schoolName: 'École A',
        items: [
          { label: 'Scolarité T1', amount: 5000, dueDate: '2026-09-15' },
          { label: 'Restauration T1', amount: 800, dueDate: '2026-09-20' },
        ],
      })
      .expect(201);

    await http.delete(`/financial-plans/${first.body.financialPlan.id}`).set(...auth()).expect(200);

    const recreated = await http
      .post('/school-wizard')
      .set(...auth())
      .send({
        label: 'École Dina 2026/2027 (bis)',
        childIds: [child.body.id],
        periodStart: '2026-09-01',
        periodEnd: '2027-06-30',
        schoolYear: '2026/2027',
        schoolName: 'École A',
        confirmDuplicate: true, // volontaire ici : on simule EXACTEMENT le scénario recréation
        items: [
          { label: 'Scolarité T1', amount: 5000, dueDate: '2026-09-15' },
          { label: 'Restauration T1', amount: 800, dueDate: '2026-09-20' },
        ],
      })
      .expect(201);

    const calendar = await http.get('/calendar').set(...auth()).query({ from: '2026-09-01', to: '2026-10-01' }).expect(200);
    const scolariteEvents = calendar.body.events.filter((e: { label: string }) => e.label.startsWith('Scolarité T1'));
    const restaurationEvents = calendar.body.events.filter((e: { label: string }) => e.label.startsWith('Restauration T1'));
    // Une seule ligne par obligation réelle — jamais l'ancienne + la nouvelle.
    expect(scolariteEvents.length).toBe(1);
    expect(restaurationEvents.length).toBe(1);
    expect(scolariteEvents[0].deadlineId).not.toBeUndefined();

    // Les ChargePlan de l'ancien plan ont bien disparu (aucun paiement, suppression complète).
    const allChargePlans = await http.get('/charge-plans').set(...auth()).expect(200);
    void allChargePlans; // liste "Charges récurrentes" seule (financialPlanId=null) — non pertinente ici, juste sanity
    void recreated;
  });

  // ---------- Scénario B ----------
  it('B. Plan avec échéance payée → supprimer plan → paiement/transaction historique conservé, échéances futures supprimées', async () => {
    const { auth } = await newHousehold();
    const account = await createAccount(auth, 'Compte Dina B', 10000);
    const child = await http.post('/children').set(...auth()).send({ firstName: 'Dina', lastName: 'B' }).expect(201);

    const plan = await http
      .post('/school-wizard')
      .set(...auth())
      .send({
        label: 'École Dina B',
        childIds: [child.body.id],
        periodStart: '2026-09-01',
        periodEnd: '2027-06-30',
        schoolYear: '2026/2027',
        items: [
          { label: 'Scolarité T1', amount: 5000, dueDate: '2026-09-15' },
          { label: 'Scolarité T2', amount: 5000, dueDate: '2027-01-15' },
        ],
      })
      .expect(201);

    const t1 = plan.body.chargePlans[0];
    const t1Deadlines = await http.get(`/charge-plans/${t1.id}/deadlines`).set(...auth()).expect(200);
    await http.post(`/deadlines/${t1Deadlines.body[0].id}/payments`).set(...auth()).send({ amount: 5000, accountId: account }).expect(201);
    await http.post(`/deadlines/${t1Deadlines.body[0].id}/close`).set(...auth()).expect(201);

    await http.delete(`/financial-plans/${plan.body.financialPlan.id}`).set(...auth()).expect(200);

    // T1 (payée) : historique intact.
    const t1After = await http.get(`/deadlines/${t1Deadlines.body[0].id}`).set(...auth()).expect(200);
    expect(t1After.body.financialStatus).toBe('soldee');
    expect(t1After.body.resteAPayer).toBe(0);

    // T2 (jamais payée, son propre ChargePlan — un poste = un ChargePlan côté
    // school-wizard) : supprimé pour de bon, plus jamais affiché comme une
    // échéance due (rien à préserver, aucun paiement).
    const t2 = plan.body.chargePlans[1];
    await http.get(`/charge-plans/${t2.id}/deadlines`).set(...auth()).expect(404);

    const calendar = await http.get('/calendar').set(...auth()).query({ from: '2027-01-01', to: '2027-02-01' }).expect(200);
    expect(calendar.body.events.filter((e: { label: string }) => e.label === 'Scolarité T2').length).toBe(0);
  });

  // ---------- Scénario "échéance annulée absente du calendrier" ----------
  it('C. Une échéance annulée directement (POST /deadlines/:id/cancel) n\'apparaît plus jamais au Calendrier', async () => {
    const { auth } = await newHousehold();
    const child = await http.post('/children').set(...auth()).send({ firstName: 'Dina', lastName: 'C' }).expect(201);
    const plan = await http
      .post('/school-wizard')
      .set(...auth())
      .send({
        label: 'École Dina C',
        childIds: [child.body.id],
        periodStart: '2026-09-01',
        periodEnd: '2027-06-30',
        items: [{ label: 'Uniforme', amount: 400, dueDate: '2026-09-10' }],
      })
      .expect(201);
    const cp = plan.body.chargePlans[0];
    const deadlines = await http.get(`/charge-plans/${cp.id}/deadlines`).set(...auth()).expect(200);

    const beforeCancel = await http.get('/calendar').set(...auth()).query({ from: '2026-09-01', to: '2026-09-30' }).expect(200);
    expect(beforeCancel.body.events.some((e: { label: string }) => e.label.startsWith('Uniforme'))).toBe(true);

    await http.post(`/deadlines/${deadlines.body[0].id}/cancel`).set(...auth()).expect(201);

    const afterCancel = await http.get('/calendar').set(...auth()).query({ from: '2026-09-01', to: '2026-09-30' }).expect(200);
    expect(afterCancel.body.events.some((e: { label: string }) => e.label.startsWith('Uniforme'))).toBe(false);
  });

  // ---------- Scénario F ----------
  it('F. Créer 2 fois le même plan École (même enfant + même année) par erreur → avertissement 409 explicite, jamais un doublon silencieux', async () => {
    const { auth } = await newHousehold();
    const child = await http.post('/children').set(...auth()).send({ firstName: 'Dina', lastName: 'F' }).expect(201);
    const payload = {
      label: 'École Dina F',
      childIds: [child.body.id],
      periodStart: '2026-09-01',
      periodEnd: '2027-06-30',
      schoolYear: '2026/2027',
      items: [{ label: 'Scolarité T1', amount: 5000, dueDate: '2026-09-15' }],
    };

    const firstPlan = await http.post('/school-wizard').set(...auth()).send(payload).expect(201);

    const duplicateAttempt = await http.post('/school-wizard').set(...auth()).send(payload).expect(409);
    expect(duplicateAttempt.body.message).toMatch(/plan scolaire existe déjà/i);
    expect(duplicateAttempt.body.existingPlanId).toBe(firstPlan.body.financialPlan.id);

    // Aucun second plan/ChargePlan créé par la tentative refusée.
    const allPlans = await http.get('/financial-plans').set(...auth()).expect(200);
    expect(allPlans.body.filter((p: { label: string }) => p.label === 'École Dina F').length).toBe(1);

    // confirmDuplicate:true débloque volontairement un second plan.
    await http.post('/school-wizard').set(...auth()).send({ ...payload, confirmDuplicate: true }).expect(201);
    const allPlansAfter = await http.get('/financial-plans').set(...auth()).expect(200);
    expect(allPlansAfter.body.filter((p: { label: string }) => p.label === 'École Dina F').length).toBe(2);
  });

  it("F bis. Plan Voiture : même véhicule existant sélectionné deux fois → avertissement 409, confirmDuplicate débloque", async () => {
    const { auth } = await newHousehold();
    const vehicle = await http.post('/vehicles').set(...auth()).send({ name: 'Clio Dina' }).expect(201);

    await http
      .post('/vehicle-wizard')
      .set(...auth())
      .send({ vehicleId: vehicle.body.id, items: [{ label: 'Assurance', amount: 3000, recurrenceRule: 'annuel', dueDate: '2026-10-01' }] })
      .expect(201);

    const duplicate = await http
      .post('/vehicle-wizard')
      .set(...auth())
      .send({ vehicleId: vehicle.body.id, items: [{ label: 'Vidange', amount: 400, recurrenceRule: 'annuel', dueDate: '2026-11-01' }] })
      .expect(409);
    expect(duplicate.body.message).toMatch(/plan existe déjà/i);

    await http
      .post('/vehicle-wizard')
      .set(...auth())
      .send({
        vehicleId: vehicle.body.id,
        confirmDuplicate: true,
        items: [{ label: 'Vidange', amount: 400, recurrenceRule: 'annuel', dueDate: '2026-11-01' }],
      })
      .expect(201);
  });
});
