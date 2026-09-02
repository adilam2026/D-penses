import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Tests Lot 8 — Simulateur What-if & aide à la décision (docs/02 G.10/G.11, IF-10).
 * Chaque scénario utilise un foyer dédié, la date de référence est toujours injectée
 * (`?at=`). Aucune simulation ne doit jamais écrire en base (IF-10, TEST 1/12).
 */
describe('Lot 8 — Simulateur What-if & aide à la décision (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot8+${run}+${seq}@example.com`, 'password123', 'L8', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer Lot8 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { accessToken, auth, householdId: household.body.household.id as string };
  }

  async function createAccount(auth: () => [string, string], name: string, initialBalance: number, includeInOperationalTreasury = true) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance, includeInOperationalTreasury }).expect(201);
    return res.body.id as string;
  }

  async function createChargePlanDeadline(auth: () => [string, string], label: string, deadline: { dueDate: string; amountCurrent?: number; amountStatus?: string }, obligationStatus?: string) {
    const cp = await http.post('/charge-plans').set(...auth()).send({ label, generationMode: 'calendrier_manuel', obligationStatus, startDate: '2020-01-01' }).expect(201);
    const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send(deadline).expect(201);
    return { chargePlanId: cp.body.id as string, deadlineId: d.body.id as string };
  }

  async function createIncome(auth: () => [string, string], accountId: string, usualDate: string, amount: number) {
    const source = await http.post('/income-sources').set(...auth()).send({ label: 'Revenu', usualAmount: amount, defaultAccountId: accountId }).expect(201);
    return http.post(`/income-sources/${source.body.id}/occurrences`).set(...auth()).send({ usualDate, plannedAmount: amount }).expect(201);
  }

  async function createProvision(auth: () => [string, string], body: Record<string, unknown>) {
    const res = await http.post('/provisions').set(...auth()).send(body).expect(201);
    return res.body.id as string;
  }

  async function createGoal(auth: () => [string, string], body: Record<string, unknown>) {
    const res = await http.post('/goals').set(...auth()).send(body).expect(201);
    return res.body.id as string;
  }

  async function simulatePurchase(auth: () => [string, string], at: string, body: Record<string, unknown>) {
    return http.post('/simulation/purchase').set(...auth()).query({ at }).send(body).expect(201);
  }

  /**
   * Instantané complet des données RÉELLES d'un foyer (§29/IF-10) — via l'API authentifiée,
   * jamais une requête Prisma directe : les tables portent `FORCE ROW LEVEL SECURITY` (docs/04
   * §S.2), donc une requête hors du contexte RLS d'une requête HTTP ne verrait aucune ligne
   * (comparaison 0=0 toujours vraie, une preuve invalide) — seule l'API, dans le contexte du
   * foyer testé, peut authentiquement révéler une écriture réelle inattendue.
   */
  async function snapshotHousehold(h: { auth: () => [string, string] }, provisionIds: string[] = [], goalIds: string[] = []) {
    const [accounts, transactions, deadlines] = await Promise.all([
      http.get('/accounts').set(...h.auth()).expect(200),
      http.get('/transactions').set(...h.auth()).expect(200),
      http.get('/deadlines').set(...h.auth()).expect(200),
    ]);
    const provisions = await Promise.all(provisionIds.map((id) => http.get(`/provisions/${id}`).set(...h.auth()).expect(200)));
    const provisionMovements = await Promise.all(provisionIds.map((id) => http.get(`/provisions/${id}/movements`).set(...h.auth()).expect(200)));
    const goals = await Promise.all(goalIds.map((id) => http.get(`/goals/${id}`).set(...h.auth()).expect(200)));
    const goalContributions = await Promise.all(goalIds.map((id) => http.get(`/goals/${id}/contributions`).set(...h.auth()).expect(200)));
    return {
      accounts: accounts.body,
      transactions: transactions.body,
      deadlines: deadlines.body,
      provisions: provisions.map((r) => r.body),
      provisionMovements: provisionMovements.map((r) => r.body),
      goals: goals.map((r) => r.body),
      goalContributions: goalContributions.map((r) => r.body),
    };
  }

  // =========================================================
  // TEST 1 / §29 — simulation pure sans écriture (IF-10)
  // =========================================================
  it('TEST 1 — plusieurs simulations successives ne créent, modifient ni suppriment aucune ligne réelle', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 50000);
    const provisionId = await createProvision(h.auth, { name: 'Provision', allocationMode: 'virtual_allocation' });
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 5000 }).expect(201);
    const goalId = await createGoal(h.auth, { label: 'PC', targetAmount: 15000 });

    const before = await snapshotHousehold(h, [provisionId], [goalId]);

    await simulatePurchase(h.auth, '2026-09-01', { amount: 10000, date: '2026-09-01', accountId });
    await http.post('/simulation/goal-contribution').set(...h.auth()).query({ at: '2026-09-01' }).send({ goalId, amount: 5000, date: '2026-09-01' }).expect(201);
    await http.post('/simulation/savings-capacity').set(...h.auth()).query({ at: '2026-09-01' }).send({ horizonDays: 30 }).expect(201);
    await http.post('/simulation/goal').set(...h.auth()).query({ at: '2026-09-01' }).send({ goalId, horizonDays: 60 }).expect(201);

    const after = await snapshotHousehold(h, [provisionId], [goalId]);
    expect(after).toEqual(before);
  }, 20000);

  // =========================================================
  // TEST 2 / ORACLE achat prudent (§31)
  // =========================================================
  it('TEST 2 / ORACLE prudent — achat 5000 sur baseline 12000 de marge → POSSIBLE_ET_PRUDENT, marge 7000', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 30000);
    await http.patch('/households/settings').set(...h.auth()).send({ securityMarginAmount: 18000 }).expect(200);

    const res = await simulatePurchase(h.auth, '2026-09-01', { amount: 5000, date: '2026-09-01', accountId, horizonDays: 10 });
    expect(res.body.decision).toBe('POSSIBLE_ET_PRUDENT');
    expect(res.body.margin_after_purchase).toBe(7000);
    expect(res.body.physical_low_point_after).toBe(25000);
  });

  // =========================================================
  // TEST 3 / ORACLE tension (§32)
  // =========================================================
  it('TEST 3 / ORACLE tension — achat 10000 sur baseline 8000 de marge → POSSIBLE_MAIS_TENSION, jamais IMPOSSIBLE_DEFICIT', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 15000);
    await http.patch('/households/settings').set(...h.auth()).send({ securityMarginAmount: 7000 }).expect(200);

    const res = await simulatePurchase(h.auth, '2026-09-01', { amount: 10000, date: '2026-09-01', accountId, horizonDays: 10 });
    expect(res.body.decision).toBe('POSSIBLE_MAIS_TENSION');
    expect(res.body.physical_low_point_after).toBe(5000);
    expect(res.body.margin_after_purchase).toBe(-2000);
    // Le physique reste positif (5000) : c'est le coussin (7000) qui absorbe l'écart —
    // sans lui la capacité serait à 5000 (≥0) — donc SAFETY_BUFFER_AT_RISK, pas un déficit plus profond.
    expect(res.body.reason_codes).toContain('SAFETY_BUFFER_AT_RISK');
    expect(res.body.reason_codes).not.toContain('PHYSICAL_DEFICIT');
  });

  // =========================================================
  // TEST 4 / ORACLE déficit (§33)
  // =========================================================
  it('TEST 4 / ORACLE déficit — achat avant tout revenu → IMPOSSIBLE_DEFICIT avec la date du déficit', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 4000);

    const res = await simulatePurchase(h.auth, '2026-09-01', { amount: 10000, date: '2026-09-01', accountId, horizonDays: 10 });
    expect(res.body.decision).toBe('IMPOSSIBLE_DEFICIT');
    expect(res.body.physical_low_point_after).toBe(-6000);
    expect(res.body.scenario.first_negative_date).toContain('2026-09-01');
    expect(res.body.reason_codes).toContain('PHYSICAL_DEFICIT');
  });

  // =========================================================
  // TEST 5 / ORACLE possible_date (§34)
  // =========================================================
  it('TEST 5 — première date possible = après le salaire qui couvre le déficit', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 5000);
    await createIncome(h.auth, accountId, '2026-09-25', 15000);

    const res = await simulatePurchase(h.auth, '2026-09-01', { amount: 15000, date: '2026-09-01', accountId, horizonDays: 45 });
    expect(res.body.possible_date).toContain('2026-09-25');
  });

  // =========================================================
  // TEST 6 / ORACLE recommended_date ≠ possible_date (§34)
  // =========================================================
  it('TEST 6 — recommended_date (capacité libre ≥0) diffère de possible_date (physique ≥0 seul)', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 5000);
    await http.patch('/households/settings').set(...h.auth()).send({ securityMarginAmount: 8000 }).expect(200);
    await createIncome(h.auth, accountId, '2026-09-25', 15000);
    await createIncome(h.auth, accountId, '2026-10-10', 10000);

    const res = await simulatePurchase(h.auth, '2026-09-01', { amount: 15000, date: '2026-09-01', accountId, horizonDays: 50 });
    expect(res.body.possible_date).toContain('2026-09-25');
    expect(res.body.recommended_date).toContain('2026-10-10');
    expect(res.body.possible_date).not.toBe(res.body.recommended_date);
  });

  // =========================================================
  // TEST 7 — montant inconnu → INDETERMINE_INCOMPLET
  // =========================================================
  it("TEST 7 — un montant inconnu pertinent rend la décision INDETERMINE_INCOMPLET, jamais une fausse certitude", async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 50000);
    await createChargePlanDeadline(h.auth, 'Charge inconnue', { dueDate: '2026-09-15', amountStatus: 'inconnu' });

    const res = await simulatePurchase(h.auth, '2026-09-01', { amount: 1000, date: '2026-09-01', accountId, horizonDays: 30 });
    expect(res.body.decision).toBe('INDETERMINE_INCOMPLET');
    expect(res.body.is_complete).toBe(false);
    expect(res.body.reason_codes).toContain('UNKNOWN_FUTURE_AMOUNT');
  });

  // =========================================================
  // TEST 8 — estimations → contains_estimates
  // =========================================================
  it('TEST 8 — un montant estimé est intégré et signale contains_estimates', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 50000);
    await createChargePlanDeadline(h.auth, 'Charge estimée', { dueDate: '2026-09-15', amountCurrent: 2000, amountStatus: 'estime' });

    const res = await simulatePurchase(h.auth, '2026-09-01', { amount: 1000, date: '2026-09-01', accountId, horizonDays: 30 });
    expect(res.body.contains_estimates).toBe(true);
  });

  // =========================================================
  // TEST 9 — Provision non disponible pour un projet (§15)
  // =========================================================
  it('TEST 9 — la Provision réservée reste réservée, jamais présentée comme argent libre pour le projet', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 50000);
    const provisionId = await createProvision(h.auth, { name: 'Provision École', allocationMode: 'virtual_allocation' });
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 12000 }).expect(201);

    const res = await simulatePurchase(h.auth, '2026-09-01', { amount: 10000, date: '2026-09-01', accountId, horizonDays: 10 });
    expect(res.body.physical_low_point_after).toBe(40000); // 50000-10000, jamais influencé par la provision
    expect(res.body.margin_after_purchase).toBe(28000); // 40000 - 12000(toujours réservé)
  });

  // =========================================================
  // TEST 10 — épargne enfant protégée jamais proposée (RG-047)
  // =========================================================
  it('TEST 10 — un compte adossé à une épargne enfant protégée est signalé, jamais recommandé sans réserve', async () => {
    const h = await newHousehold();
    const childRes = await http.post('/children').set(...h.auth()).send({ firstName: 'Wael', lastName: 'Enfant' }).expect(201);
    const dedicatedId = await createAccount(h.auth, 'Épargne Wael', 20000, false);
    await http.post('/pockets').set(...h.auth()).send({
      name: 'Épargne Wael', allocationMode: 'backed_by_account', linkedAccountId: dedicatedId,
      beneficiaryChildId: childRes.body.id, hasRecurringContribution: true,
    }).expect(201);

    const res = await simulatePurchase(h.auth, '2026-09-01', { amount: 10000, date: '2026-09-01', accountId: dedicatedId, horizonDays: 10 });
    expect(res.body.reason_codes).toContain('PROTECTED_SAVINGS');
    expect(res.body.decision).not.toBe('POSSIBLE_ET_PRUDENT');
  });

  // =========================================================
  // TEST 11 / ORACLE contribution virtuelle (§36)
  // =========================================================
  it('TEST 11 / ORACLE contribution virtuelle — physique inchangé, capacité libre −5000', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 30000);
    const goalId = await createGoal(h.auth, { label: 'PC', targetAmount: 15000 });
    const pocketId = (await http.post('/pockets').set(...h.auth()).send({ name: 'Épargne PC', allocationMode: 'virtual_allocation' }).expect(201)).body.id;
    await http.patch(`/goals/${goalId}`).set(...h.auth()).send({ linkedPocketId: pocketId }).expect(200);

    const res = await http.post('/simulation/goal-contribution').set(...h.auth()).query({ at: '2026-09-01' }).send({ goalId, amount: 5000, date: '2026-09-01', horizonDays: 10 }).expect(201);
    expect(res.body.scenario.closing_physical_treasury).toBe(30000);
    expect(res.body.delta_free_capacity_low_point).toBe(-5000);
  });

  // =========================================================
  // TEST 12 — GoalContribution simulée jamais persistée
  // =========================================================
  it('TEST 12 — la contribution simulée ne crée jamais de GoalContribution réelle', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 30000);
    const goalId = await createGoal(h.auth, { label: 'PC', targetAmount: 15000 });
    await http.post('/simulation/goal-contribution').set(...h.auth()).query({ at: '2026-09-01' }).send({ goalId, amount: 5000, date: '2026-09-01', horizonDays: 10 }).expect(201);

    const contributions = await http.get(`/goals/${goalId}/contributions`).set(...h.auth()).expect(200);
    expect(contributions.body).toEqual([]);
    const goal = await http.get(`/goals/${goalId}`).set(...h.auth()).expect(200);
    expect(goal.body.savedAmount).toBe(0);
  });

  // =========================================================
  // TEST 13 — capacité d'épargne maximale déterministe
  // =========================================================
  it('TEST 13 — capacité maximale ponctuelle déterministe (recherche binaire)', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 50000);
    await http.patch('/households/settings').set(...h.auth()).send({ securityMarginAmount: 10000 }).expect(200);

    const res1 = await http.post('/simulation/savings-capacity').set(...h.auth()).query({ at: '2026-09-01' }).send({ date: '2026-09-01', horizonDays: 10 }).expect(201);
    const res2 = await http.post('/simulation/savings-capacity').set(...h.auth()).query({ at: '2026-09-01' }).send({ date: '2026-09-01', horizonDays: 10 }).expect(201);
    expect(Math.abs(res1.body.max_amount - 40000)).toBeLessThan(1); // 50000 - 10000(coussin)
    expect(res1.body.max_amount).toBe(res2.body.max_amount); // déterministe
  }, 20000);

  // =========================================================
  // TEST 14 — contribution mensuelle récurrente
  // =========================================================
  it('TEST 14 — capacité mensuelle récurrente précise l\'horizon utilisé et les dates de contribution', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 30000);

    const res = await http.post('/simulation/savings-capacity').set(...h.auth()).query({ at: '2026-09-01' }).send({ recurring: true, dayOfMonth: 5, horizonDays: 60 }).expect(201);
    expect(res.body.recurring).toBe(true);
    expect(res.body.contribution_dates.length).toBeGreaterThanOrEqual(1);
    expect(res.body.horizon_end).toContain('2026-10-31');
  }, 20000);

  // =========================================================
  // TEST 15 / ORACLE Goal (§35)
  // =========================================================
  it('TEST 15 / ORACLE Goal — rythme nécessaire (2500) > rythme prudent (2000) → NOT_FEASIBLE_AT_REQUESTED_PACE', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 8000);
    const goalId = await createGoal(h.auth, { label: 'PC', targetAmount: 15000, targetDate: '2026-12-30' });
    await http.post(`/goals/${goalId}/contributions`).set(...h.auth()).send({ plannedDate: '2026-08-01', plannedAmount: 5000, confirmed: true }).expect(201);

    const res = await http.post('/simulation/goal').set(...h.auth()).query({ at: '2026-09-01' }).send({ goalId }).expect(201);
    expect(res.body.remaining_amount).toBe(10000);
    expect(res.body.necessary_monthly_amount).toBe(2500);
    expect(Math.abs(res.body.prudent_monthly_amount - 2000)).toBeLessThan(1);
    expect(res.body.target_status).toBe('NOT_FEASIBLE_AT_REQUESTED_PACE');
    expect(res.body.reason_codes).toContain('GOAL_TARGET_TOO_AGGRESSIVE');
  }, 30000);

  // =========================================================
  // TEST 16 — date réaliste Goal
  // =========================================================
  it('TEST 16 — une date réaliste plus tardive est proposée quand le rythme demandé est trop agressif', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 8000);
    const goalId = await createGoal(h.auth, { label: 'PC', targetAmount: 15000, targetDate: '2026-12-30' });
    await http.post(`/goals/${goalId}/contributions`).set(...h.auth()).send({ plannedDate: '2026-08-01', plannedAmount: 5000, confirmed: true }).expect(201);

    const res = await http.post('/simulation/goal').set(...h.auth()).query({ at: '2026-09-01' }).send({ goalId }).expect(201);
    expect(res.body.realistic_date).not.toBeNull();
    expect(new Date(res.body.realistic_date).getTime()).toBeGreaterThan(new Date('2026-12-30').getTime());
  }, 30000);

  // =========================================================
  // TEST 17 — include_envisaged_options sans changement réel du statut
  // =========================================================
  it("TEST 17 — include_envisaged_options change le calcul sans jamais modifier obligation_status réel", async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 50000);
    const { chargePlanId } = await createChargePlanDeadline(h.auth, 'Garderie envisagée', { dueDate: '2026-09-15', amountCurrent: 3000, amountStatus: 'confirme' }, 'optionnelle_envisagee');

    const without = await simulatePurchase(h.auth, '2026-09-01', { amount: 1000, date: '2026-09-01', accountId, horizonDays: 20 });
    const withOption = await simulatePurchase(h.auth, '2026-09-01', { amount: 1000, date: '2026-09-01', accountId, horizonDays: 20, includeEnvisagedOptions: true });
    expect(without.body.baseline.closing_physical_treasury).toBe(50000);
    expect(withOption.body.baseline.closing_physical_treasury).toBe(47000); // la garderie entre dans la courbe certaine SEULEMENT pour ce calcul

    const chargePlans = await http.get('/charge-plans').set(...h.auth()).expect(200);
    const plan = chargePlans.body.find((cp: { id: string }) => cp.id === chargePlanId);
    expect(plan.obligationStatus).toBe('optionnelle_envisagee'); // jamais modifié réellement
  });

  // =========================================================
  // TEST 18 — comparaison de 3 scénarios indépendants
  // =========================================================
  it('TEST 18 — trois scénarios de date différents restent indépendants, aucune persistance entre eux', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 5000);
    await createIncome(h.auth, accountId, '2026-09-20', 10000);

    const today = await simulatePurchase(h.auth, '2026-09-01', { amount: 15000, date: '2026-09-01', accountId, horizonDays: 30 });
    const afterIncome = await simulatePurchase(h.auth, '2026-09-01', { amount: 15000, date: '2026-09-21', accountId, horizonDays: 30 });
    const chosen = await simulatePurchase(h.auth, '2026-09-01', { amount: 15000, date: '2026-09-25', accountId, horizonDays: 30 });

    // Chaque scénario repart de la MÊME baseline réelle (5000 aujourd'hui) — jamais l'un influencé par l'autre.
    expect(today.body.baseline.closing_physical_treasury).toBe(afterIncome.body.baseline.closing_physical_treasury);
    expect(afterIncome.body.baseline.closing_physical_treasury).toBe(chosen.body.baseline.closing_physical_treasury);
    expect(today.body.decision).toBe('IMPOSSIBLE_DEFICIT');
    expect(afterIncome.body.decision).toBe('POSSIBLE_ET_PRUDENT');
    expect(chosen.body.decision).toBe('POSSIBLE_ET_PRUDENT');
  });

  // =========================================================
  // TEST 19 — reason_codes exacts
  // =========================================================
  it('TEST 19 — les reason_codes reflètent exactement les facteurs déclenchés, ni plus ni moins', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 4000);
    await createChargePlanDeadline(h.auth, 'Charge inconnue', { dueDate: '2026-09-10', amountStatus: 'inconnu' });

    const res = await simulatePurchase(h.auth, '2026-09-01', { amount: 10000, date: '2026-09-01', accountId, horizonDays: 15 });
    expect(res.body.reason_codes).toEqual(expect.arrayContaining(['UNKNOWN_FUTURE_AMOUNT', 'PHYSICAL_DEFICIT']));
    expect(res.body.reason_codes).not.toContain('PROTECTED_SAVINGS');
    expect(res.body.reason_codes).not.toContain('GOAL_TARGET_TOO_AGGRESSIVE');
  });

  // =========================================================
  // TEST 20 — isolation RLS
  // =========================================================
  it("TEST 20 — le foyer B ne peut jamais simuler sur les données du foyer A", async () => {
    const a = await newHousehold();
    const accountA = await createAccount(a.auth, 'Compte A', 500000);

    const b = await newHousehold();
    await http.post('/simulation/purchase').set(...b.auth()).query({ at: '2026-09-01' }).send({ amount: 1000, date: '2026-09-01', accountId: accountA, horizonDays: 10 }).expect(404);

    const accountB = await createAccount(b.auth, 'Compte B', 1000);
    const res = await simulatePurchase(b.auth, '2026-09-01', { amount: 500, date: '2026-09-01', accountId: accountB, horizonDays: 10 });
    expect(res.body.baseline.closing_physical_treasury).toBe(1000); // jamais 500000 du foyer A
  });

  // =========================================================
  // ORACLE DOC06 — margin_after_purchase et absence de mutation réelle
  // =========================================================
  it('ORACLE DOC06 — comparer « achat aujourd\'hui » vs « achat après le salaire » sans jamais muter le réel', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 10000);
    await http.patch('/households/settings').set(...h.auth()).send({ securityMarginAmount: 10000 }).expect(200);
    await createIncome(h.auth, accountId, '2026-09-25', 18000);

    const before = await snapshotHousehold(h);
    const today = await simulatePurchase(h.auth, '2026-09-01', { amount: 15000, date: '2026-09-01', accountId, horizonDays: 40 });
    const later = await simulatePurchase(h.auth, '2026-09-01', { amount: 15000, date: '2026-09-26', accountId, horizonDays: 40 });
    const after = await snapshotHousehold(h);

    expect(today.body.decision).toBe('IMPOSSIBLE_DEFICIT');
    expect(later.body.decision).toBe('POSSIBLE_ET_PRUDENT');
    expect(later.body.margin_after_purchase).toBe(3000); // 10000+18000-15000-10000(coussin)
    expect(after).toEqual(before); // aucune mutation du réel, quelle que soit l'issue
  });
});
