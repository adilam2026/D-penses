import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Tests Lot 5 (docs/05-roadmap-et-risques.md, TEST 1-15 + TEST A-E de la
 * correction finale). Chaque scénario utilise un foyer dédié pour rester
 * indépendant et déterministe — la date de référence est toujours injectée
 * via `?at=`, jamais l'horloge système (§22/TEST 14).
 *
 * Contrat d'API (correction §5) : les champs financiers du summary sont en
 * snake_case (operational_treasury, committed_amount, free_available...) —
 * committed_amount = deadline_commitments + variable_budget_commitments.
 */
describe('Lot 5 — Trésorerie, disponible libre, dashboard & calendrier (e2e)', () => {
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
      .send({ email: `lot5+${run}+${seq}@example.com`, password: 'password123', firstName: 'L5', lastName: 'T' })
      .expect(201);
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signup.body.accessToken}`)
      .send({ name: `Foyer Lot5 ${seq}` })
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
    obligationStatus?: string,
  ) {
    const cp = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label, generationMode: 'calendrier_manuel', obligationStatus, startDate: '2020-01-01' })
      .expect(201);
    const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send(deadline).expect(201);
    return { chargePlanId: cp.body.id as string, deadlineId: d.body.id as string };
  }

  async function createWeeklyBudget(auth: () => [string, string], categoryId: string, referenceAmount: number, startDate = '2020-01-01') {
    const res = await http
      .post('/variable-budgets')
      .set(...auth())
      .send({ categoryId, referenceAmount, referencePeriod: 'semaine', startDate })
      .expect(201);
    return res.body.id as string;
  }

  // ---------- TEST 1 — patrimoine vs trésorerie ----------
  it('TEST 1 — patrimoine liquide total vs trésorerie opérationnelle', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte courant', 30000, true);
    await createAccount(h.auth, 'Espèces', 2000, true);
    await createAccount(h.auth, 'Épargne enfants', 10000, false);

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).expect(200);
    expect(dashboard.body.patrimoine_liquide_total).toBe(42000);
    expect(dashboard.body.operational_treasury).toBe(32000);
  });

  // ---------- TEST 2 — disponible libre ----------
  it('TEST 2 — disponible libre = trésorerie - engagements - coussin (réserves=0)', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 50000);
    await http.patch('/households/settings').set(...h.auth()).send({ securityMarginAmount: 10000 }).expect(200);
    await createChargePlanDeadline(h.auth, 'Charge', { dueDate: '2026-09-20', amountCurrent: 20000, amountStatus: 'confirme' });

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(dashboard.body.operational_treasury).toBe(50000);
    expect(dashboard.body.reserved_amount).toBe(0);
    expect(dashboard.body.committed_amount).toBe(20000);
    expect(dashboard.body.safety_buffer).toBe(10000);
    expect(dashboard.body.free_available).toBe(20000);
  });

  // ---------- TEST 3 — disponible négatif, jamais borné à 0 ----------
  it('TEST 3 — disponible libre négatif reste négatif, jamais ramené à 0', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 15000);
    await http.patch('/households/settings').set(...h.auth()).send({ securityMarginAmount: 5000 }).expect(200);
    await createChargePlanDeadline(h.auth, 'Charge', { dueDate: '2026-09-20', amountCurrent: 12000, amountStatus: 'confirme' });

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(dashboard.body.free_available).toBe(-2000);
  });

  // ---------- TEST 4 / TEST 5 — horizon ----------
  it("TEST 4/5 — une échéance future est engagée dès aujourd'hui si elle tombe dans l'horizon, jamais avant", async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 100000);
    // Horizon (fallback technique) = referenceDate + 30 jours, aucun revenu prévu.
    await createChargePlanDeadline(h.auth, 'École (dans horizon)', { dueDate: '2026-09-30', amountCurrent: 20000, amountStatus: 'confirme' });
    await createChargePlanDeadline(h.auth, 'Hors horizon', { dueDate: '2026-12-01', amountCurrent: 9999, amountStatus: 'confirme' });

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(dashboard.body.deadline_commitments).toBe(20000); // la charge hors horizon n'est pas encore incluse
  });

  // ---------- TEST 6 — paiement partiel ----------
  it('TEST 6 — paiement partiel : engagements = reste_a_payer, jamais le montant initial', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 100000);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'Charge partielle', { dueDate: '2026-09-20', amountCurrent: 20000, amountStatus: 'confirme' });
    await http.post(`/deadlines/${deadlineId}/payments`).set(...h.auth()).send({ amount: 15000, accountId }).expect(201);

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(dashboard.body.deadline_commitments).toBe(5000);
  });

  // ---------- TEST 7 — soldée ----------
  it('TEST 7 — une échéance soldée ne contribue plus jamais aux engagements futurs', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 100000);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'Charge soldée', { dueDate: '2026-09-20', amountCurrent: 20000, amountStatus: 'confirme' });
    await http.post(`/deadlines/${deadlineId}/payments`).set(...h.auth()).send({ amount: 20000, accountId }).expect(201);
    await http.post(`/deadlines/${deadlineId}/close`).set(...h.auth()).expect(201);

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(dashboard.body.deadline_commitments).toBe(0);
  });

  // ---------- TEST 8 — estimation puis confirmation ----------
  it('TEST 8 — une échéance estimée compte pour son montant, contains_estimates, recalcul immédiat à la confirmation', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 100000);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'Charge estimée', { dueDate: '2026-09-20', amountCurrent: 20000, amountStatus: 'estime' });

    const before = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(before.body.deadline_commitments).toBe(20000);
    expect(before.body.contains_estimates).toBe(true);

    await http.patch(`/deadlines/${deadlineId}`).set(...h.auth()).send({ amountCurrent: 21300, amountStatus: 'confirme' }).expect(200);
    const after = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(after.body.deadline_commitments).toBe(21300);
  });

  // ---------- TEST 9 — montant inconnu ----------
  it('TEST 9 — un montant inconnu ne vaut jamais 0, incrémente unknown_commitments_count, marque is_complete=false', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 100000);
    await createChargePlanDeadline(h.auth, 'Connue', { dueDate: '2026-09-20', amountCurrent: 5000, amountStatus: 'confirme' });
    await createChargePlanDeadline(h.auth, 'Restauration T2', { dueDate: '2026-09-25', amountStatus: 'inconnu' });

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(dashboard.body.deadline_commitments).toBe(5000); // seule la partie connue
    expect(dashboard.body.unknown_commitments_count).toBe(1);
    expect(dashboard.body.is_complete).toBe(false);
  });

  // ---------- TEST 10 / TEST 11 — optionnelle envisagée puis souscrite ----------
  it('TEST 10/11 — une option envisagée reste hors engagements certains, y entre une fois souscrite', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 100000);
    const { chargePlanId } = await createChargePlanDeadline(
      h.auth,
      'Garderie',
      { dueDate: '2026-09-20', amountCurrent: 3000, amountStatus: 'confirme' },
      'optionnelle_envisagee',
    );

    const before = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(before.body.deadline_commitments).toBe(0);
    expect(before.body.optionsEnvisagees.total).toBe(3000);

    await http.patch(`/charge-plans/${chargePlanId}`).set(...h.auth()).send({ obligationStatus: 'optionnelle_souscrite' }).expect(200);
    const after = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(after.body.deadline_commitments).toBe(3000);
  });

  // ---------- TEST 12 — FinancialPlan anti-double-comptage ----------
  it('TEST 12 — known_plan_cost du FinancialPlan (40000) ne se mélange jamais aux engagements (10000)', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 100000);
    const plan = await http.post('/financial-plans').set(...h.auth()).send({ label: 'Plan test', periodStart: '2026-01-01', periodEnd: '2026-12-31' }).expect(201);

    const soldeeCp = await http.post('/charge-plans').set(...h.auth()).send({ label: 'Déjà payée', generationMode: 'calendrier_manuel', financialPlanId: plan.body.id, startDate: '2020-01-01' }).expect(201);
    const soldeeD = await http.post(`/charge-plans/${soldeeCp.body.id}/deadlines`).set(...h.auth()).send({ dueDate: '2026-08-01', amountCurrent: 30000, amountStatus: 'confirme' }).expect(201);
    await http.post(`/deadlines/${soldeeD.body.id}/payments`).set(...h.auth()).send({ amount: 30000, accountId }).expect(201);
    await http.post(`/deadlines/${soldeeD.body.id}/close`).set(...h.auth()).expect(201);

    const ouverteCp = await http.post('/charge-plans').set(...h.auth()).send({ label: 'Encore due', generationMode: 'calendrier_manuel', financialPlanId: plan.body.id, startDate: '2020-01-01' }).expect(201);
    await http.post(`/charge-plans/${ouverteCp.body.id}/deadlines`).set(...h.auth()).send({ dueDate: '2026-09-20', amountCurrent: 10000, amountStatus: 'confirme' }).expect(201);

    const planDetail = await http.get(`/financial-plans/${plan.body.id}`).set(...h.auth()).expect(200);
    expect(planDetail.body.knownPlanCost).toBe(40000); // 30000 + 10000

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(dashboard.body.deadline_commitments).toBe(10000); // jamais 50000 (40000 known_plan_cost + 10000)
  });

  // ---------- TEST 13 — facturation ≠ échéance ----------
  it('TEST 13 — le calendrier distingue facture attendue et échéance, une seule Deadline, aucun Payment automatique', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 100000);
    const cp = await http.post('/charge-plans').set(...h.auth()).send({ label: 'Scolarité T2', generationMode: 'calendrier_manuel', startDate: '2020-01-01' }).expect(201);
    const d = await http
      .post(`/charge-plans/${cp.body.id}/deadlines`)
      .set(...h.auth())
      .send({ dueDate: '2027-01-28', expectedBillingDate: '2027-01-12', amountCurrent: 21300, amountStatus: 'estime' })
      .expect(201);

    const calendar = await http.get('/calendar').set(...h.auth()).query({ at: '2027-01-01', to: '2027-02-01' }).expect(200);
    const kinds = calendar.body.events.filter((e: { deadlineId: string }) => e.deadlineId === d.body.id).map((e: { kind: string }) => e.kind);
    expect(kinds).toContain('facture_attendue');
    expect(kinds).toContain('echeance');
    expect(kinds).toHaveLength(2); // une seule Deadline, deux événements d'affichage

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2027-01-01' }).expect(200);
    const matching = dashboard.body.deadlineItems.filter((i: { id: string }) => i.id === d.body.id);
    expect(matching).toHaveLength(1); // jamais compté deux fois

    const payments = await http.get(`/deadlines/${d.body.id}/payments`).set(...h.auth()).expect(200);
    expect(payments.body).toEqual([]);
  });

  // ---------- TEST 14 — date de référence injectable ----------
  it('TEST 14 — la même donnée, calculée à deux referenceDate différentes, donne des horizons distincts et déterministes', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 100000);
    await createChargePlanDeadline(h.auth, 'École', { dueDate: '2026-09-30', amountCurrent: 20000, amountStatus: 'confirme' });

    const earlyRes = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-08-01' }).expect(200); // horizon fallback ~2026-08-31, hors portée
    expect(earlyRes.body.deadline_commitments).toBe(0);

    const lateRes = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-01' }).expect(200); // horizon fallback ~2026-10-01, inclus
    expect(lateRes.body.deadline_commitments).toBe(20000);
  });

  // ---------- TEST 15 — isolation stricte par foyer ----------
  it("TEST 15 — le Dashboard/Calendrier d'un foyer B ne reflète jamais les données d'un foyer A", async () => {
    const a = await newHousehold();
    await createAccount(a.auth, 'Compte A', 500000);
    await createChargePlanDeadline(a.auth, 'Charge A', { dueDate: '2026-09-20', amountCurrent: 300000, amountStatus: 'confirme' });

    const b = await newHousehold();
    const dashboardB = await http.get('/dashboard/summary').set(...b.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(dashboardB.body.operational_treasury).toBe(0);
    expect(dashboardB.body.committed_amount).toBe(0);

    const calendarB = await http.get('/calendar').set(...b.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(calendarB.body.events).toEqual([]);
  });

  // =========================================================
  // Correction finale — TEST A à E
  // =========================================================

  // ---------- TEST A — budget variable réintégré dans les engagements ----------
  it('TEST A — 50 000 trésorerie / 20 000 Deadline / 4 000 budget futur / 10 000 coussin → disponible = 16 000', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 50000);
    await http.patch('/households/settings').set(...h.auth()).send({ securityMarginAmount: 10000 }).expect(200);
    await createChargePlanDeadline(h.auth, 'Charge', { dueDate: '2026-09-05', amountCurrent: 20000, amountStatus: 'confirme' });

    const category = await http.post('/categories').set(...h.auth()).send({ name: 'Courses TestA', kind: 'expense' }).expect(201);
    // Semaine du 31 août au 6 septembre 2026 (lundi→dimanche) : aucune dépense encore enregistrée.
    await createWeeklyBudget(h.auth, category.body.id, 4000);
    // H* fixé au dernier jour de cette même semaine (6 septembre) pour isoler exactement une semaine
    // pleine dans la fenêtre [T,H*] — aucune queue de semaine suivante à additionner.
    const source = await http.post('/income-sources').set(...h.auth()).send({ label: 'Salaire', usualAmount: 8000, defaultAccountId: accountId }).expect(201);
    await http.post(`/income-sources/${source.body.id}/occurrences`).set(...h.auth()).send({ usualDate: '2026-09-06' }).expect(201);

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(dashboard.body.horizon_date).toContain('2026-09-06');
    expect(dashboard.body.deadline_commitments).toBe(20000);
    expect(dashboard.body.variable_budget_commitments).toBe(4000);
    expect(dashboard.body.committed_amount).toBe(24000);
    expect(dashboard.body.free_available).toBe(16000);
  });

  // ---------- TEST B — anti-double-comptage budget (IF-13) ----------
  it('TEST B — 1500 de budget, 600 déjà dépensés (déjà sortis du compte) → engagements = restant exact (900), jamais 1500 ni 600+900', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 20000);
    const category = await http.post('/categories').set(...h.auth()).send({ name: 'Courses TestB', kind: 'expense' }).expect(201);
    await createWeeklyBudget(h.auth, category.body.id, 1500);
    // Mercredi 2 septembre 2026 (même semaine du 31 août au 6 septembre) : 600 DH déjà dépensés.
    await http.post('/expenses').set(...h.auth()).send({ amount: 600, accountId, categoryId: category.body.id, spentDate: '2026-09-02' }).expect(201);
    // H* fixé au dernier jour de cette même semaine pour isoler exactement la période courante (aucune queue de semaine suivante).
    const source = await http.post('/income-sources').set(...h.auth()).send({ label: 'Salaire', usualAmount: 8000, defaultAccountId: accountId }).expect(201);
    await http.post(`/income-sources/${source.body.id}/occurrences`).set(...h.auth()).send({ usualDate: '2026-09-06' }).expect(201);

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-02' }).expect(200);
    // La trésorerie reflète déjà les 600 dépensés (20000-600=19400) : jamais une seconde fois dans les engagements.
    expect(dashboard.body.operational_treasury).toBe(19400);
    // Reste_contractuel = 1500-600 = 900 ; rythme_restant = (600/3×7)-600 = 800 ; prudent_max = max(900,800,0) = 900.
    expect(dashboard.body.variable_budget_commitments).toBe(900);
  });

  // ---------- TEST C — budget hebdomadaire traversant H* (RG-098) ----------
  it("TEST C — la part budget d'une fenêtre traversant plusieurs semaines respecte exactement RG-098 (aucune fenêtre glissante de 7 jours)", async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 100000);
    const category = await http.post('/categories').set(...h.auth()).send({ name: 'Courses TestC', kind: 'expense' }).expect(201);
    await createWeeklyBudget(h.auth, category.body.id, 1400); // 200 DH/jour, calcul simple

    // referenceDate = mercredi 2 septembre 2026 (semaine du 31 août au 6 septembre).
    // Revenu prévu le 21 septembre 2026 (lundi) → H* = 2026-09-21 (RG-098, pas un fallback).
    const source = await http.post('/income-sources').set(...h.auth()).send({ label: 'Salaire', usualAmount: 1000, defaultAccountId: accountId }).expect(201);
    await http.post(`/income-sources/${source.body.id}/occurrences`).set(...h.auth()).send({ usualDate: '2026-09-21' }).expect(201);

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-02' }).expect(200);
    expect(dashboard.body.horizon_is_fallback).toBe(false);
    expect(dashboard.body.horizon_date).toContain('2026-09-21');

    // Fenêtre [2 sept, 21 sept] :
    //  - période courante (31 août-6 sept), rien dépensé → restante intégrale = 1400 (G.8, période courante entière) ;
    //  - 7-13 sept (semaine pleine) = 1400 ; 14-20 sept (semaine pleine) = 1400 ;
    //  - 21-27 sept : seul le 21 est dans la fenêtre → 1 jour / 7 × 1400 = 200 (prorata RG-098, jamais arrondi à la semaine).
    // Total exact = 1400 + 1400 + 1400 + 200 = 4400 — ni 1400 (une semaine), ni 4200 (3 semaines rondes sans le bord), ni 5600 (4 semaines arrondies).
    expect(dashboard.body.variable_budget_commitments).toBe(4400);
  });

  // ---------- TEST D — aucun revenu futur ----------
  it('TEST D — sans IncomeOccurrence prévue, horizon_is_fallback=true et le fallback déterministe est signalé explicitement', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 10000);

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(dashboard.body.horizon_source).toBe('fallback');
    expect(dashboard.body.horizon_is_fallback).toBe(true);
    expect(dashboard.body.horizon_date).toContain('2026-10-01'); // 2026-09-01 + 30 jours
  });

  // ---------- TEST E — revenu futur disponible ----------
  it('TEST E — un salaire prévu le 25 septembre devient H*, aucun fallback appliqué', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 10000);
    const source = await http.post('/income-sources').set(...h.auth()).send({ label: 'Salaire', usualAmount: 8000, defaultAccountId: accountId }).expect(201);
    await http.post(`/income-sources/${source.body.id}/occurrences`).set(...h.auth()).send({ usualDate: '2026-09-25' }).expect(201);

    const dashboard = await http.get('/dashboard/summary').set(...h.auth()).query({ at: '2026-09-01' }).expect(200);
    expect(dashboard.body.horizon_source).toBe('income');
    expect(dashboard.body.horizon_is_fallback).toBe(false);
    expect(dashboard.body.horizon_date).toContain('2026-09-25');
  });
});
