import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Tests Lot 6 — Épargne, provisions & objectifs (docs/02 §C.5/E.5/E.5bis-quinquies,
 * docs/06 Cas F/G/§3.1). Chaque scénario utilise un foyer dédié, la date de
 * référence est toujours injectée (jamais l'horloge système, §22/TEST 5 des Lots
 * précédents). Aucune assertion ne dépasse ce que le modèle normatif garantit.
 */
describe('Lot 6 — Épargne, provisions & objectifs (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let prisma: PrismaService;
  const run = Date.now();
  let seq = 0;

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold() {
    seq += 1;
    const signup = await http
      .post('/auth/signup')
      .send({ email: `lot6+${run}+${seq}@example.com`, password: 'password123', firstName: 'L6', lastName: 'T' })
      .expect(201);
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signup.body.accessToken}`)
      .send({ name: `Foyer Lot6 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { accessToken, auth, householdId: household.body.household.id as string };
  }

  async function createAccount(auth: () => [string, string], name: string, initialBalance: number, includeInOperationalTreasury = true) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance, includeInOperationalTreasury }).expect(201);
    return res.body.id as string;
  }

  async function createChargePlanDeadline(
    auth: () => [string, string],
    label: string,
    deadline: { dueDate: string; amountCurrent?: number; amountStatus?: string },
  ) {
    const cp = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label, generationMode: 'calendrier_manuel', startDate: '2020-01-01' })
      .expect(201);
    const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send(deadline).expect(201);
    return { chargePlanId: cp.body.id as string, deadlineId: d.body.id as string };
  }

  async function createSavingsPocket(auth: () => [string, string], body: Record<string, unknown>) {
    const res = await http.post('/pockets').set(...auth()).send(body).expect(201);
    return res.body.id as string;
  }

  async function createProvision(auth: () => [string, string], body: Record<string, unknown>) {
    const res = await http.post('/provisions').set(...auth()).send(body).expect(201);
    return res.body.id as string;
  }

  async function createChild(auth: () => [string, string], firstName: string) {
    const res = await http.post('/children').set(...auth()).send({ firstName, lastName: 'Enfant' }).expect(201);
    return res.body.id as string;
  }

  async function dashboard(auth: () => [string, string], at: string) {
    return http.get('/dashboard/summary').set(...auth()).query({ at }).expect(200);
  }

  // =========================================================
  // TEST 1 — virtual allocation
  // =========================================================
  it('TEST 1 — virtual_allocation : le compte physique ne bouge jamais, la réserve logique grandit', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 50000);
    const pocketId = await createSavingsPocket(h.auth, { name: 'Provision virtuelle', allocationMode: 'virtual_allocation' });
    await http.post(`/pockets/${pocketId}/contribute`).set(...h.auth()).send({ amount: 12000 }).expect(201);

    const account = await http.get(`/accounts/${accountId}`).set(...h.auth()).expect(200);
    expect(account.body.soldeCourant).toBe(50000); // §5 : aucun mouvement physique supplémentaire

    const d = await dashboard(h.auth, '2026-09-01');
    expect(d.body.operational_treasury).toBe(50000);
    expect(d.body.reserved_amount).toBe(12000);
  });

  // =========================================================
  // TEST 2 — backed_by_account
  // =========================================================
  it('TEST 2 — backed_by_account : le compte dédié est déjà hors trésorerie opérationnelle, réservé additionnel = 0', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Courant', 38000, true);
    const savingsAccountId = await createAccount(h.auth, 'Épargne dédiée', 12000, false);
    await createSavingsPocket(h.auth, { name: 'Poche adossée', allocationMode: 'backed_by_account', linkedAccountId: savingsAccountId });

    const d = await dashboard(h.auth, '2026-09-01');
    expect(d.body.patrimoine_liquide_total).toBe(50000);
    expect(d.body.operational_treasury).toBe(38000);
    expect(d.body.reserved_amount).toBe(0);
  });

  // =========================================================
  // TEST 3 — IF-06
  // =========================================================
  it('TEST 3 — IF-06 : le disponible libre ne redéduit jamais les 12 000 déjà hors trésorerie', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Courant', 38000, true);
    const savingsAccountId = await createAccount(h.auth, 'Épargne dédiée', 12000, false);
    await createSavingsPocket(h.auth, { name: 'Poche adossée', allocationMode: 'backed_by_account', linkedAccountId: savingsAccountId });

    const d = await dashboard(h.auth, '2026-09-01');
    expect(d.body.free_available).toBe(38000); // 38000 - 0(réservé) - 0(engagé) - 0(coussin)
  });

  // =========================================================
  // TEST 4 — couverture chronologique (RG-090)
  // =========================================================
  it('TEST 4 — couverture chronologique : la provision se répartit dans l\'ordre des due_date, jamais deux fois', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 100000);
    const provisionId = await createProvision(h.auth, { name: 'Provision École', allocationMode: 'virtual_allocation' });
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 12000 }).expect(201);

    const { deadlineId: t1 } = await createChargePlanDeadline(h.auth, 'T1', { dueDate: '2026-09-15', amountCurrent: 8000, amountStatus: 'confirme' });
    const { deadlineId: t2 } = await createChargePlanDeadline(h.auth, 'T2', { dueDate: '2026-10-15', amountCurrent: 10000, amountStatus: 'confirme' });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId: t1 }).expect(201);
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId: t2 }).expect(201);

    const provision = await http.get(`/provisions/${provisionId}`).set(...h.auth()).expect(200);
    const cov = (id: string) => provision.body.coverage.find((c: { deadlineId: string }) => c.deadlineId === id);
    expect(cov(t1).coverageAffectee).toBe(8000);
    expect(cov(t1).engagementNonCouvert).toBe(0);
    expect(cov(t2).coverageAffectee).toBe(4000);
    expect(cov(t2).engagementNonCouvert).toBe(6000);
  });

  // =========================================================
  // TEST 5 — invariant coverage + uncovered = reste_a_payer (IF-16)
  // =========================================================
  it('TEST 5 — invariant IF-16 : coverage + uncovered = reste_a_payer, pour chaque échéance', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 100000);
    const provisionId = await createProvision(h.auth, { name: 'Provision', allocationMode: 'virtual_allocation' });
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 9000 }).expect(201);

    const { deadlineId: d1 } = await createChargePlanDeadline(h.auth, 'D1', { dueDate: '2026-09-10', amountCurrent: 4449, amountStatus: 'confirme' });
    const { deadlineId: d2 } = await createChargePlanDeadline(h.auth, 'D2', { dueDate: '2026-09-25', amountCurrent: 2000, amountStatus: 'confirme' });
    const { deadlineId: d3 } = await createChargePlanDeadline(h.auth, 'D3', { dueDate: '2026-11-10', amountCurrent: 20000, amountStatus: 'confirme' });
    for (const id of [d1, d2, d3]) {
      await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId: id }).expect(201);
    }

    const provision = await http.get(`/provisions/${provisionId}`).set(...h.auth()).expect(200);
    for (const item of provision.body.coverage) {
      expect(item.coverageAffectee + item.engagementNonCouvert).toBe(item.resteAPayer);
    }
  });

  // =========================================================
  // TEST 6 — excédent de provision
  // =========================================================
  it('TEST 6 — excédent : la couverture totale ne dépasse jamais le besoin réel, le surplus reste réservé', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 100000);
    const provisionId = await createProvision(h.auth, { name: 'Provision', allocationMode: 'virtual_allocation' });
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 15000 }).expect(201);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'Seule échéance', { dueDate: '2026-09-15', amountCurrent: 10000, amountStatus: 'confirme' });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId }).expect(201);

    const provision = await http.get(`/provisions/${provisionId}`).set(...h.auth()).expect(200);
    const totalCoverage = provision.body.coverage.reduce((s: number, c: { coverageAffectee: number }) => s + c.coverageAffectee, 0);
    expect(totalCoverage).toBe(10000); // jamais plus que le besoin réel total
    expect(provision.body.currentAmount).toBe(15000); // les 5000 excédentaires restent réservés dans la provision

    const d = await dashboard(h.auth, '2026-09-01');
    expect(d.body.reserved_amount).toBe(15000); // Montants_réservés compte la TOTALITÉ (G.3)
    expect(d.body.deadline_commitments).toBe(0); // engagement_non_couvert = 0 (entièrement couvert)
  });

  // =========================================================
  // TEST 7 — oracle 50k/12k/20k/10k (doc06 Cas F)
  // =========================================================
  it('TEST 7 — oracle doc06 Cas F : réservé=12000, engagé non couvert=8000, disponible=20000', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 50000);
    await http.patch('/households/settings').set(...h.auth()).send({ securityMarginAmount: 10000 }).expect(200);
    const provisionId = await createProvision(h.auth, { name: 'Provision École', allocationMode: 'virtual_allocation' });
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 12000 }).expect(201);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'Échéance', { dueDate: '2026-09-15', amountCurrent: 20000, amountStatus: 'confirme' });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId }).expect(201);

    const d = await dashboard(h.auth, '2026-09-01');
    expect(d.body.reserved_amount).toBe(12000);
    expect(d.body.deadline_commitments).toBe(8000);
    expect(d.body.free_available).toBe(20000);
    expect(d.body.free_available).not.toBe(8000); // jamais le calcul erroné V2 (double comptage)
  });

  // =========================================================
  // TEST 8 — suffisance temporelle (RG-032bis)
  // =========================================================
  it("TEST 8 — suffisance temporelle : une contribution future trop tardive ne rend jamais la provision suffisante avant l'échéance", async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 100000);
    const provisionId = await createProvision(h.auth, { name: 'Provision', allocationMode: 'virtual_allocation' });
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 10000, date: '2026-09-01' }).expect(201);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'Échéance', { dueDate: '2026-09-30', amountCurrent: 20000, amountStatus: 'confirme' });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId }).expect(201);
    // Contribution planifiée seulement (non confirmée) le 15 octobre — arrive après le 30 septembre.
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 10000, date: '2026-10-15', confirmed: false }).expect(201);

    const sufficiency = await http.get(`/provisions/${provisionId}/sufficiency`).set(...h.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(sufficiency.body.currentAmount).toBe(10000); // la contribution planifiée n'est jamais réelle (RG-000)
    expect(sufficiency.body.steps[0].gap).toBe(10000); // 20000 - 10000, insuffisante au 30/09
  });

  // =========================================================
  // TEST 9 — contribution planifiée ≠ réelle
  // =========================================================
  it('TEST 9 — une contribution planifiée non confirmée ne modifie jamais le solde de la poche', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 100000);
    const pocketId = await createSavingsPocket(h.auth, { name: 'Épargne École', allocationMode: 'virtual_allocation' });
    await http.post(`/pockets/${pocketId}/contribute`).set(...h.auth()).send({ amount: 10000, confirmed: false }).expect(201);

    const pocket = await http.get(`/pockets/${pocketId}`).set(...h.auth()).expect(200);
    expect(pocket.body.currentAmount).toBe(0);
  });

  // =========================================================
  // TEST 10 — confirmation de contribution
  // =========================================================
  it('TEST 10 — la confirmation d\'une contribution virtual_allocation grandit la poche sans jamais toucher le compte physique', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 50000);
    const pocketId = await createSavingsPocket(h.auth, { name: 'Épargne École', allocationMode: 'virtual_allocation' });
    const contribution = await http.post(`/pockets/${pocketId}/contribute`).set(...h.auth()).send({ amount: 10000, confirmed: false }).expect(201);
    await http.post(`/pockets/movements/${contribution.body.movement.id}/confirm`).set(...h.auth()).send({}).expect(201);

    const pocket = await http.get(`/pockets/${pocketId}`).set(...h.auth()).expect(200);
    expect(pocket.body.currentAmount).toBe(10000);
    const account = await http.get(`/accounts/${accountId}`).set(...h.auth()).expect(200);
    expect(account.body.soldeCourant).toBe(50000);
    const d = await dashboard(h.auth, '2026-09-01');
    expect(d.body.reserved_amount).toBe(10000);
  });

  // =========================================================
  // TEST 11 — payer avec provision
  // =========================================================
  it('TEST 11 — payer avec provision : compte, provision et couverture recalculés cohéremment', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 50000);
    const provisionId = await createProvision(h.auth, { name: 'Provision École', allocationMode: 'virtual_allocation' });
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 12000 }).expect(201);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'Échéance', { dueDate: '2026-09-15', amountCurrent: 20000, amountStatus: 'confirme' });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId }).expect(201);

    await http
      .post(`/deadlines/${deadlineId}/payments`)
      .set(...h.auth())
      .send({ amount: 5000, accountId, fundingSource: 'provision', provisionId })
      .expect(201);

    const account = await http.get(`/accounts/${accountId}`).set(...h.auth()).expect(200);
    expect(account.body.soldeCourant).toBe(45000);
    const provision = await http.get(`/provisions/${provisionId}`).set(...h.auth()).expect(200);
    expect(provision.body.currentAmount).toBe(7000);
    const deadline = await http.get(`/deadlines/${deadlineId}`).set(...h.auth()).expect(200);
    expect(deadline.body.resteAPayer).toBe(15000);
    const cov = provision.body.coverage.find((c: { deadlineId: string }) => c.deadlineId === deadlineId);
    expect(cov.coverageAffectee).toBe(7000);
    expect(cov.engagementNonCouvert).toBe(8000);
  });

  // =========================================================
  // TEST 12 — atomicité
  // =========================================================
  it('TEST 12 — atomicité : un paiement refusé ne laisse ni Payment partiel, ni PocketMovement orphelin, ni impact compte', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 50000);
    const provisionId = await createProvision(h.auth, { name: 'Provision', allocationMode: 'virtual_allocation' });
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 5000 }).expect(201);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'Échéance', { dueDate: '2026-09-15', amountCurrent: 20000, amountStatus: 'confirme' });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId }).expect(201);

    await http
      .post(`/deadlines/${deadlineId}/payments`)
      .set(...h.auth())
      .send({ amount: 8000, accountId, fundingSource: 'provision', provisionId })
      .expect(400);

    const payments = await http.get(`/deadlines/${deadlineId}/payments`).set(...h.auth()).expect(200);
    expect(payments.body).toEqual([]); // aucun Payment partiel
    const movements = await http.get(`/provisions/${provisionId}/movements`).set(...h.auth()).expect(200);
    expect(movements.body.filter((m: { movementType: string }) => m.movementType === 'retrait')).toEqual([]); // aucun PocketMovement orphelin
    const account = await http.get(`/accounts/${accountId}`).set(...h.auth()).expect(200);
    expect(account.body.soldeCourant).toBe(50000); // aucun impact compte partiel
  });

  // =========================================================
  // TEST 13 — compte physique obligatoire
  // =========================================================
  it('TEST 13 — funding_source=provision sans account_id est refusé (une Provision n\'est jamais un compte)', async () => {
    const h = await newHousehold();
    const provisionId = await createProvision(h.auth, { name: 'Provision', allocationMode: 'virtual_allocation' });
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 5000 }).expect(201);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'Échéance', { dueDate: '2026-09-15', amountCurrent: 5000, amountStatus: 'confirme' });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId }).expect(201);

    await http
      .post(`/deadlines/${deadlineId}/payments`)
      .set(...h.auth())
      .send({ amount: 5000, fundingSource: 'provision', provisionId }) // accountId omis
      .expect(400);
  });

  // =========================================================
  // TEST 14 — provision insuffisante
  // =========================================================
  it('TEST 14 — provision insuffisante : refus propre, jamais un solde négatif silencieux', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 50000);
    const provisionId = await createProvision(h.auth, { name: 'Provision', allocationMode: 'virtual_allocation' });
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 5000 }).expect(201);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'Échéance', { dueDate: '2026-09-15', amountCurrent: 20000, amountStatus: 'confirme' });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId }).expect(201);

    const res = await http
      .post(`/deadlines/${deadlineId}/payments`)
      .set(...h.auth())
      .send({ amount: 8000, accountId, fundingSource: 'provision', provisionId })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('5000');

    const provision = await http.get(`/provisions/${provisionId}`).set(...h.auth()).expect(200);
    expect(provision.body.currentAmount).toBe(5000); // jamais négatif, jamais modifié par la tentative refusée
  });

  // =========================================================
  // TEST 15 — intention_label
  // =========================================================
  it("TEST 15 — intention_label est purement informatif : aucun changement de réservé/couverture/engagé/disponible", async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 50000);
    const provisionId = await createProvision(h.auth, { name: 'Provision', allocationMode: 'virtual_allocation' });
    const contrib = await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 5000, intentionLabel: 'Préparation T2' }).expect(201);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'T2', { dueDate: '2026-09-30', amountCurrent: 5000, amountStatus: 'confirme' });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId }).expect(201);

    const before = await dashboard(h.auth, '2026-09-01');

    // Un second versement porte une intention CONTRADICTOIRE ("aussi pour T2") — ne crée jamais de double réservation (IF-22).
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 0.01, intentionLabel: 'Aussi pour T2' }).expect(201);
    expect(contrib.body.movement.intentionLabel).toBe('Préparation T2');

    const after = await dashboard(h.auth, '2026-09-01');
    // Seul le nouveau montant réel (5000.01) doit apparaître dans réservé — jamais un effet du label lui-même.
    expect(after.body.reserved_amount).toBe(before.body.reserved_amount + 0.01);
  });

  // =========================================================
  // TEST 16 — épargne enfant protégée (RG-047)
  // =========================================================
  it('TEST 16 — épargne enfant protégée : jamais utilisée automatiquement pour couvrir une Deadline du foyer', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 50000);
    const childId = await createChild(h.auth, 'Wael');
    const pocketId = await createSavingsPocket(h.auth, {
      name: 'Épargne Wael',
      allocationMode: 'virtual_allocation',
      beneficiaryChildId: childId,
      hasRecurringContribution: true,
    });
    await http.post(`/pockets/${pocketId}/contribute`).set(...h.auth()).send({ amount: 5000 }).expect(201);

    const pocket = await http.get(`/pockets/${pocketId}`).set(...h.auth()).expect(200);
    expect(pocket.body.isProtected).toBe(true); // RG-047 : protection par défaut

    // Une Deadline foyer du même montant, SANS lien vers cette épargne (une SavingsPocket
    // n'a structurellement aucune relation vers une Deadline — seule une Provision en a).
    await createChargePlanDeadline(h.auth, 'Facture foyer', { dueDate: '2026-09-15', amountCurrent: 5000, amountStatus: 'confirme' });
    const d = await dashboard(h.auth, '2026-09-01');
    expect(d.body.deadline_commitments).toBe(5000); // jamais réduite par l'épargne enfant
    expect(d.body.reserved_amount).toBe(5000); // l'épargne enfant reste comptée comme réserve, jamais comme couverture
  });

  // =========================================================
  // TEST 17 — Goal
  // =========================================================
  it('TEST 17 — objectif PC : progression = déjà constitué, reste = cible - constitué', async () => {
    const h = await newHousehold();
    const goal = await http.post('/goals').set(...h.auth()).send({ label: 'PC', targetAmount: 15000 }).expect(201);
    await http.post(`/goals/${goal.body.id}/contributions`).set(...h.auth()).send({ plannedDate: '2026-09-01', plannedAmount: 5000, confirmed: true }).expect(201);

    const detail = await http.get(`/goals/${goal.body.id}`).set(...h.auth()).expect(200);
    expect(detail.body.savedAmount).toBe(5000);
    expect(detail.body.remainingToConstitute).toBe(10000);
    expect(detail.body.progressPercent).toBeCloseTo(33.33, 2);
  });

  // =========================================================
  // TEST 18 — contribution Goal prévue
  // =========================================================
  it('TEST 18 — une contribution Goal prévue mais non confirmée n\'a aucun impact sur le solde réel', async () => {
    const h = await newHousehold();
    const goal = await http.post('/goals').set(...h.auth()).send({ label: 'PC', targetAmount: 15000 }).expect(201);
    await http.post(`/goals/${goal.body.id}/contributions`).set(...h.auth()).send({ plannedDate: '2026-10-01', plannedAmount: 5000 }).expect(201);

    const detail = await http.get(`/goals/${goal.body.id}`).set(...h.auth()).expect(200);
    expect(detail.body.savedAmount).toBe(0);
    expect(detail.body.remainingToConstitute).toBe(15000);
  });

  // =========================================================
  // TEST 19 — isolation RLS
  // =========================================================
  it("TEST 19 — le foyer B ne peut jamais lire/modifier les SavingsPocket/Provision/PocketMovement/Goal/GoalContribution du foyer A", async () => {
    const a = await newHousehold();
    await createAccount(a.auth, 'Compte A', 50000);
    const pocketA = await createSavingsPocket(a.auth, { name: 'Poche A', allocationMode: 'virtual_allocation' });
    const provisionA = await createProvision(a.auth, { name: 'Provision A', allocationMode: 'virtual_allocation' });
    const goalA = await http.post('/goals').set(...a.auth()).send({ label: 'Goal A', targetAmount: 1000 }).expect(201);

    const b = await newHousehold();
    await http.get(`/pockets/${pocketA}`).set(...b.auth()).expect(404);
    await http.get(`/provisions/${provisionA}`).set(...b.auth()).expect(404);
    await http.get(`/goals/${goalA.body.id}`).set(...b.auth()).expect(404);

    const pocketsB = await http.get('/pockets').set(...b.auth()).expect(200);
    expect(pocketsB.body).toEqual([]);
    const provisionsB = await http.get('/provisions').set(...b.auth()).expect(200);
    expect(provisionsB.body).toEqual([]);
    const goalsB = await http.get('/goals').set(...b.auth()).expect(200);
    expect(goalsB.body).toEqual([]);
  });

  // =========================================================
  // ORACLE DOC06 — Cas G (backed_by_account ↔ échéance)
  // =========================================================
  it('ORACLE DOC06 Cas G — provision backed_by_account : réservé=0, couverture=15000, disponible=30000-marge', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte opérationnel', 30000, true);
    const schoolAccountId = await createAccount(h.auth, 'Compte école dédié', 15000, false);
    const provisionId = await createProvision(h.auth, { name: 'Provision école', allocationMode: 'backed_by_account', linkedAccountId: schoolAccountId });
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'École', { dueDate: '2026-09-15', amountCurrent: 15000, amountStatus: 'confirme' });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId }).expect(201);

    const d = await dashboard(h.auth, '2026-09-01');
    expect(d.body.reserved_amount).toBe(0);
    expect(d.body.deadline_commitments).toBe(0); // engagement_non_couvert = 0
    expect(d.body.free_available).toBe(30000);
  });

  // =========================================================
  // ORACLE DOC06 — §3.1 (couverture séquentielle D-S1/D-S2)
  // =========================================================
  it('ORACLE DOC06 §3.1 — provision 9000 couvre intégralement D-S1 (4449) puis D-S2 (2000), rien ne double-compte', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 100000);
    const provisionId = await createProvision(h.auth, { name: 'Provision Scolarité', allocationMode: 'virtual_allocation' });
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 9000 }).expect(201);
    const { deadlineId: ds1 } = await createChargePlanDeadline(h.auth, 'D-S1', { dueDate: '2026-09-15', amountCurrent: 4449, amountStatus: 'confirme' });
    const { deadlineId: ds2 } = await createChargePlanDeadline(h.auth, 'D-S2', { dueDate: '2026-09-30', amountCurrent: 2000, amountStatus: 'confirme' });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId: ds1 }).expect(201);
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId: ds2 }).expect(201);

    const provision = await http.get(`/provisions/${provisionId}`).set(...h.auth()).expect(200);
    const cov = (id: string) => provision.body.coverage.find((c: { deadlineId: string }) => c.deadlineId === id);
    expect(cov(ds1).coverageAffectee).toBe(4449);
    expect(cov(ds1).engagementNonCouvert).toBe(0);
    expect(cov(ds2).coverageAffectee).toBe(2000);
    expect(cov(ds2).engagementNonCouvert).toBe(0);

    const d = await dashboard(h.auth, '2026-09-01');
    expect(d.body.deadline_commitments).toBe(0); // les deux échéances sont intégralement couvertes
  });
});
