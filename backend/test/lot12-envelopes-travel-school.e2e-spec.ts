import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Tests Lot 12 (Lot 2 cadrage V1) — enveloppes CAS 2 (linkedAccountId informatif en
 * virtual_allocation), couverture physique par compte, assistant Voyage atomique,
 * périodicité par poste dans l'assistant scolaire (réutilise le moteur Lot 11).
 */
describe('Lot 12 — Enveloppes CAS2 + Voyage + École périodique (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let prisma: PrismaService;
  const run = Date.now();
  let seq = 0;

  const mailer = new FakeMailer();
  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold() {
    seq += 1;
    const signupToken = await signupVerified(http, mailer, `lot12+${run}+${seq}@example.com`, 'password123', 'L12', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer Lot12 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { accessToken, auth, householdId: household.body.household.id as string };
  }

  async function createAccount(auth: () => [string, string], name: string, initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  async function getAccount(auth: () => [string, string], id: string) {
    return http.get(`/accounts/${id}`).set(...auth()).expect(200);
  }

  async function createVirtualProvision(auth: () => [string, string], name: string, linkedAccountId?: string) {
    const res = await http
      .post('/provisions')
      .set(...auth())
      .send({ name, allocationMode: 'virtual_allocation', linkedAccountId })
      .expect(201);
    return res.body.id as string;
  }

  async function contribute(auth: () => [string, string], provisionId: string, amount: number) {
    return http.post(`/provisions/${provisionId}/contribute`).set(...auth()).send({ amount }).expect(201);
  }

  // ---------- TEST 1 : CAS 2 — montant partiel réservé sur un compte précis ----------
  it('TEST 1 — enveloppe virtuelle localisée sur un compte : le compte garde son solde entier, seule la réservation globale augmente', async () => {
    const { auth } = await newHousehold();
    const cih = await createAccount(auth, 'CIH', 10000);
    const provisionId = await createVirtualProvision(auth, 'École', cih);
    await contribute(auth, provisionId, 5000);

    const res = await getAccount(auth, cih);
    expect(res.body.soldeCourant).toBe(10000); // jamais touché, ce n'est pas backed_by_account
    expect(res.body.reservedByEnvelopes).toBe(5000);
  });

  // ---------- TEST 2 : plusieurs enveloppes sur le même compte ----------
  it('TEST 2 — 3 enveloppes localisées sur le même compte : réservation cumulée, pas de double comptage', async () => {
    const { auth } = await newHousehold();
    const bp = await createAccount(auth, 'Banque Populaire', 30000);
    const ecole = await createVirtualProvision(auth, 'École', bp);
    const assurance = await createVirtualProvision(auth, 'Assurance', bp);
    const voyage = await createVirtualProvision(auth, 'Voyage', bp);
    await contribute(auth, ecole, 10000);
    await contribute(auth, assurance, 4000);
    await contribute(auth, voyage, 6000);

    const res = await getAccount(auth, bp);
    expect(res.body.soldeCourant).toBe(30000);
    expect(res.body.reservedByEnvelopes).toBe(20000); // 10000+4000+6000, jamais fusionné avec un solde de compte
  });

  // ---------- TEST 3 : insuffisance détectable (solde baisse sous le réservé) ----------
  it('TEST 3 — le solde du compte baisse sous le total réservé : la couverture physique le reflète sans toucher les enveloppes', async () => {
    const { auth } = await newHousehold();
    const bp = await createAccount(auth, 'Banque Populaire', 30000);
    const ecole = await createVirtualProvision(auth, 'École', bp);
    const assurance = await createVirtualProvision(auth, 'Assurance', bp);
    const voyage = await createVirtualProvision(auth, 'Voyage', bp);
    await contribute(auth, ecole, 10000);
    await contribute(auth, assurance, 4000);
    await contribute(auth, voyage, 6000);

    // Dépense ponctuelle qui fait baisser BP à 15 000 DH (compte toujours réel).
    await http.post('/expenses').set(...auth()).send({ amount: 15000, accountId: bp }).expect(201);

    const res = await getAccount(auth, bp);
    expect(res.body.soldeCourant).toBe(15000);
    expect(res.body.reservedByEnvelopes).toBe(20000); // jamais réduit automatiquement
    // Manque = 20000 - 15000 = 5000, calculable côté mobile sans nouvelle formule.
    expect(res.body.reservedByEnvelopes - res.body.soldeCourant).toBe(5000);
  });

  // ---------- TEST 4 : Voyage — endpoint atomique ----------
  it('TEST 4 — POST /travel-wizard crée 1 FinancialPlan(travel) + N ChargePlan + N Deadline en une seule transaction', async () => {
    const { auth } = await newHousehold();
    const res = await http
      .post('/travel-wizard')
      .set(...auth())
      .send({
        label: 'Voyage Rome',
        destination: 'Rome',
        periodStart: '2027-04-12',
        periodEnd: '2027-04-18',
        items: [
          { label: 'Transport', amount: 8000, dueDate: '2027-04-12' },
          { label: 'Hôtel', amount: 12000, dueDate: '2027-04-12' },
          { label: 'Alimentation', amount: 6000, dueDate: '2027-04-12' },
          { label: 'Activités', amount: 4000, dueDate: '2027-04-12' },
          { label: 'Imprévus', amount: 5000, dueDate: '2027-04-12' },
        ],
      })
      .expect(201);

    expect(res.body.financialPlan.destination).toBe('Rome');
    expect(res.body.financialPlan.planType).toBe('travel');
    expect(res.body.chargePlans.length).toBe(5);

    const planId = res.body.financialPlan.id as string;
    const plan = await http.get(`/financial-plans/${planId}`).set(...auth()).expect(200);
    expect(plan.body.knownPlanCost).toBe(35000); // 8000+12000+6000+4000+5000, aucune formule recopiée ici
  });

  // ---------- TEST 5 : Voyage — couverture via enveloppe liée ----------
  it('TEST 5 — enveloppe Voyage (12000) liée au plan : couverture ~34%, reste à financer ~23000', async () => {
    const { auth } = await newHousehold();
    const bp = await createAccount(auth, 'Banque Populaire', 50000);
    const provisionId = await createVirtualProvision(auth, 'Voyage', bp);
    await contribute(auth, provisionId, 12000);

    const wizard = await http
      .post('/travel-wizard')
      .set(...auth())
      .send({
        label: 'Voyage Rome',
        destination: 'Rome',
        periodStart: '2027-04-12',
        periodEnd: '2027-04-18',
        linkedProvisionId: provisionId,
        items: [
          { label: 'Transport', amount: 8000, dueDate: '2027-04-12' },
          { label: 'Hôtel', amount: 12000, dueDate: '2027-04-13' },
          { label: 'Alimentation', amount: 6000, dueDate: '2027-04-14' },
          { label: 'Activités', amount: 4000, dueDate: '2027-04-15' },
          { label: 'Imprévus', amount: 5000, dueDate: '2027-04-16' },
        ],
      })
      .expect(201);

    // Lier explicitement chaque Deadline à la Provision pour que la couverture RG-090 s'applique
    // (linkedProvisionId sur le plan reste informatif, cf. financial-plans.service.ts).
    for (const cp of wizard.body.chargePlans) {
      const deadlines = await http.get(`/charge-plans/${cp.id}/deadlines`).set(...auth());
      for (const d of deadlines.body) {
        await http.post(`/provisions/${provisionId}/deadlines`).set(...auth()).send({ deadlineId: d.id }).expect(201);
      }
    }

    const plan = await http.get(`/financial-plans/${wizard.body.financialPlan.id}`).set(...auth()).expect(200);
    expect(plan.body.knownPlanCost).toBe(35000);
    expect(plan.body.provisionCoverage).toBe(12000); // couverture chronologique : le premier poste (Transport, 8000) + début du 2e
    expect(plan.body.remainingToFund).toBe(23000); // 35000 - 12000, cohérent avec l'exemple utilisateur
  });

  // ---------- TEST 6 : école — poste périodique génère ses occurrences futures ----------
  it('TEST 6 — garderie mensuelle dans le wizard scolaire : les mois suivants sont générés automatiquement (moteur Lot 11)', async () => {
    const { auth } = await newHousehold();
    const child = await http.post('/children').set(...auth()).send({ firstName: 'Wael', lastName: 'A.' }).expect(201);

    const wizard = await http
      .post('/school-wizard')
      .set(...auth())
      .send({
        label: 'École 2026/2027',
        childIds: [child.body.id],
        periodStart: '2026-09-01',
        periodEnd: '2027-06-30',
        items: [{ label: 'Garderie', amount: 800, dueDate: '2026-09-05', recurrenceRule: 'mensuel', obligationStatus: 'optionnelle_souscrite' }],
      })
      .expect(201);

    const garderiePlanId = wizard.body.chargePlans[0].id as string;

    // Déclenche la génération (même mécanisme que Lot 11 — via une lecture Projection).
    await http.get('/projection').set(...auth()).query({ at: '2026-09-01', horizon: 90 }).expect(200);

    const deadlines = await http.get(`/charge-plans/${garderiePlanId}/deadlines`).set(...auth()).expect(200);
    expect(deadlines.body.length).toBeGreaterThanOrEqual(3); // sept, oct, nov générés
  });

  // ---------- TEST 7 : école — poste ponctuel reste unique ----------
  it('TEST 7 — poste ponctuel (uniforme) : jamais de génération automatique, une seule Deadline pour toujours', async () => {
    const { auth } = await newHousehold();
    const child = await http.post('/children').set(...auth()).send({ firstName: 'Dina', lastName: 'A.' }).expect(201);

    const wizard = await http
      .post('/school-wizard')
      .set(...auth())
      .send({
        label: 'École 2026/2027',
        childIds: [child.body.id],
        periodStart: '2026-09-01',
        periodEnd: '2027-06-30',
        items: [{ label: 'Uniforme', amount: 3400, dueDate: '2026-09-30' }],
      })
      .expect(201);

    const uniformePlanId = wizard.body.chargePlans[0].id as string;
    await http.get('/projection').set(...auth()).query({ at: '2026-09-01', horizon: 300 }).expect(200);

    const deadlines = await http.get(`/charge-plans/${uniformePlanId}/deadlines`).set(...auth()).expect(200);
    expect(deadlines.body.length).toBe(1);
  });
});
