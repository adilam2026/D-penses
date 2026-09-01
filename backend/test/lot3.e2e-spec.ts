import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Tests Lot 3 (docs/05-roadmap-et-risques.md "Tests obligatoires" Lot 3 + TEST 1-14
 * de la demande). Les formules de calcul pures (prorata semaine/mois, G.8,
 * RG-024bis — TEST 3 à 10) sont couvertes en tests unitaires déterministes dans
 * src/common/ledger/variable-budget.util.spec.ts, ancrés sur l'exemple exact du
 * document 02 (§13 : semaine du 31 août au 6 septembre 2026). Ce fichier couvre
 * le câblage API (rattachement §8, AdHocExpense §7, LedgerEntry §15, isolation,
 * non-régression saisie rapide §2/§14).
 */
describe('Lot 3 — Budgets variables & dépenses ponctuelles (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let prisma: PrismaService;
  const run = Date.now();

  let accessToken: string;
  let coursesCategoryId: string;
  let reparationsCategoryId: string;

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    const signup = await http
      .post('/auth/signup')
      .send({ email: `lot3+${run}@example.com`, password: 'password123', firstName: 'L3', lastName: 'T' })
      .expect(201);
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signup.body.accessToken}`)
      .send({ name: 'Foyer Lot3' })
      .expect(201);
    accessToken = household.body.accessToken;

    const courses = await http.post('/categories').set(...auth()).send({ name: 'Courses', kind: 'expense' }).expect(201);
    coursesCategoryId = courses.body.id;
    const reparations = await http.post('/categories').set(...auth()).send({ name: 'Réparations', kind: 'expense' }).expect(201);
    reparationsCategoryId = reparations.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  function auth() {
    return ['Authorization', `Bearer ${accessToken}`] as [string, string];
  }

  async function createAccount(name: string, initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  async function createWeeklyBudget(categoryId: string, referenceAmount: number) {
    const res = await http
      .post('/variable-budgets')
      .set(...auth())
      .send({ categoryId, referenceAmount, referencePeriod: 'semaine', startDate: '2020-01-01' })
      .expect(201);
    return res.body.id as string;
  }

  // ---------- TEST 1 ----------
  it('TEST 1 — dépense rattachée à un budget actif devient une BudgetExpense, aucune Deadline/ChargePlan créée', async () => {
    const accountId = await createAccount('Compte Courses', 5000);
    const budgetId = await createWeeklyBudget(coursesCategoryId, 1500);

    const before = await http.get('/charge-plans').set(...auth()).expect(200);

    const res = await http
      .post('/expenses')
      .set(...auth())
      .send({ amount: 100, accountId, categoryId: coursesCategoryId })
      .expect(201);

    expect(res.body.kind).toBe('budget_expense');
    expect(res.body.soldeCourant).toBe(4900); // compte -100

    const budget = await http.get(`/variable-budgets/${budgetId}`).set(...auth()).expect(200);
    expect(budget.body.status.consommeADate).toBe(100);

    const after = await http.get('/charge-plans').set(...auth()).expect(200);
    expect(after.body).toHaveLength(before.body.length); // aucun ChargePlan créé
  });

  // ---------- TEST 2 ----------
  it("TEST 2 — dépense ponctuelle sans budget correspondant devient une AdHocExpense", async () => {
    const accountId = await createAccount('Compte Réparation', 2000);

    const res = await http
      .post('/expenses')
      .set(...auth())
      .send({ amount: 700, accountId, categoryId: reparationsCategoryId })
      .expect(201);

    expect(res.body.kind).toBe('adhoc_expense');
    expect(res.body.soldeCourant).toBe(1300);
    expect(res.body.budgetStatus).toBeUndefined();

    const account = await http.get(`/accounts/${accountId}`).set(...auth()).expect(200);
    expect(account.body.soldeCourant).toBe(1300);

    const transactions = await http.get('/transactions').set(...auth()).expect(200);
    const entry = transactions.body.find((t: { accountId: string; kind: string }) => t.accountId === accountId && t.kind === 'adhoc_expense');
    expect(entry.amount).toBe(-700);
  });

  // ---------- Rattachement §8 : sans catégorie → AdHocExpense sans catégorie ----------
  it('une dépense sans catégorie devient une AdHocExpense sans catégorie (aucun rattachement deviné)', async () => {
    const accountId = await createAccount('Compte Sans Catégorie', 1000);
    const res = await http.post('/expenses').set(...auth()).send({ amount: 50, accountId }).expect(201);
    expect(res.body.kind).toBe('adhoc_expense');
    expect(res.body.expense.categoryId).toBeNull();
  });

  // ---------- §8 : plusieurs budgets actifs sur la même catégorie → jamais deviné ----------
  it('plusieurs budgets actifs sur la même catégorie renvoient une désambiguïsation explicite (409), jamais un choix silencieux', async () => {
    const ambiguousCategory = await http.post('/categories').set(...auth()).send({ name: 'Loisirs test', kind: 'expense' }).expect(201);
    const categoryId = ambiguousCategory.body.id;
    const accountId = await createAccount('Compte Ambigu', 1000);

    // Deux VariableBudget actifs simultanément sur la même catégorie (semaine + mois, tous deux valides aujourd'hui).
    const budgetA = await createWeeklyBudget(categoryId, 300);
    const budgetB = await http
      .post('/variable-budgets')
      .set(...auth())
      .send({ categoryId, referenceAmount: 1000, referencePeriod: 'mois', startDate: '2020-01-01' })
      .expect(201);

    const ambiguous = await http.post('/expenses').set(...auth()).send({ amount: 20, accountId, categoryId }).expect(409);
    expect(ambiguous.body.candidates ?? ambiguous.body.message).toBeDefined();

    // La désambiguïsation explicite (variableBudgetId fourni) fonctionne.
    const resolved = await http
      .post('/expenses')
      .set(...auth())
      .send({ amount: 20, accountId, categoryId, variableBudgetId: budgetA })
      .expect(201);
    expect(resolved.body.kind).toBe('budget_expense');
    void budgetB;
  });

  // ---------- TEST 11 — modification du budget en cours de période ----------
  it("TEST 11 — modifier reference_amount en cours de semaine ne réécrit jamais l'historique des BudgetExpense", async () => {
    const accountId = await createAccount('Compte Révision Budget', 5000);
    const category = await http.post('/categories').set(...auth()).send({ name: 'Révision test', kind: 'expense' }).expect(201);
    const budgetId = await createWeeklyBudget(category.body.id, 1500);

    await http.post('/expenses').set(...auth()).send({ amount: 200, accountId, categoryId: category.body.id }).expect(201);
    const before = await http.get(`/variable-budgets/${budgetId}`).set(...auth()).expect(200);
    expect(before.body.status.consommeADate).toBe(200);
    expect(before.body.status.budgetPeriode).toBe(1500);
    const expenseCountBefore = before.body.history.length;

    const updated = await http.patch(`/variable-budgets/${budgetId}`).set(...auth()).send({ referenceAmount: 1800 }).expect(200);
    expect(updated.body.status.budgetPeriode).toBe(1800);
    expect(updated.body.status.consommeADate).toBe(200); // dépenses déjà réalisées inchangées
    expect(updated.body.status.budgetContractuelRestant).toBe(1600); // 1800 - 200, recalculé sur la nouvelle référence
    expect(updated.body.history).toHaveLength(expenseCountBefore); // aucune BudgetExpense supprimée ni dupliquée
  });

  // ---------- TEST 12 — LedgerEntry : suite complète, impact net exact ----------
  it('TEST 12 — +revenu / -paiement / -BudgetExpense / -AdHocExpense donnent un impact net exact', async () => {
    const accountId = await createAccount('Compte Ledger Lot3', 0);
    const category = await http.post('/categories').set(...auth()).send({ name: 'Ledger test', kind: 'expense' }).expect(201);
    await createWeeklyBudget(category.body.id, 5000);

    const source = await http
      .post('/income-sources')
      .set(...auth())
      .send({ label: 'Salaire Ledger3', usualAmount: 18000, defaultAccountId: accountId })
      .expect(201);
    const occurrence = await http
      .post(`/income-sources/${source.body.id}/occurrences`)
      .set(...auth())
      .send({ usualDate: '2026-09-01' })
      .expect(201);
    await http.post(`/income-occurrences/${occurrence.body.id}/confirm`).set(...auth()).send({ actualAmount: 18000, accountId }).expect(201);

    const plan = await http.post('/charge-plans').set(...auth()).send({ label: 'Facture Ledger3', startDate: '2026-09-01' }).expect(201);
    const deadline = await http
      .post(`/charge-plans/${plan.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-09-01', amountCurrent: 1000 })
      .expect(201);
    await http.post(`/deadlines/${deadline.body.id}/payments`).set(...auth()).send({ amount: 1000, accountId }).expect(201);

    await http.post('/expenses').set(...auth()).send({ amount: 600, accountId, categoryId: category.body.id }).expect(201);
    await http.post('/expenses').set(...auth()).send({ amount: 700, accountId, categoryId: reparationsCategoryId }).expect(201);

    const account = await http.get(`/accounts/${accountId}`).set(...auth()).expect(200);
    expect(account.body.soldeCourant).toBe(15700); // 18000 - 1000 - 600 - 700
  });

  // ---------- TEST 14 (+ §2) — la saisie rapide dépense ne crée plus de ChargePlan silencieux ----------
  it('TEST 14 — la saisie rapide dépense ne crée jamais de ChargePlan/Deadline silencieux', async () => {
    const accountId = await createAccount('Compte NonRegression', 3000);
    const chargePlansBefore = await http.get('/charge-plans').set(...auth()).expect(200);

    await http.post('/expenses').set(...auth()).send({ amount: 100, accountId, categoryId: coursesCategoryId }).expect(201);
    await http.post('/expenses').set(...auth()).send({ amount: 500, accountId, categoryId: reparationsCategoryId }).expect(201);

    const chargePlansAfter = await http.get('/charge-plans').set(...auth()).expect(200);
    expect(chargePlansAfter.body).toHaveLength(chargePlansBefore.body.length);
  });

  // ---------- TEST 13 — isolation stricte par foyer ----------
  it('TEST 13 — un utilisateur extérieur ne peut ni lire ni modifier VariableBudget/BudgetExpense/AdHocExpense', async () => {
    const accountId = await createAccount('Compte Isolation Lot3', 1000);
    const isolationCategory = await http.post('/categories').set(...auth()).send({ name: 'Isolation test', kind: 'expense' }).expect(201);
    const budgetId = await createWeeklyBudget(isolationCategory.body.id, 1500);
    const expenseRes = await http.post('/expenses').set(...auth()).send({ amount: 100, accountId, categoryId: isolationCategory.body.id }).expect(201);
    const adhocRes = await http.post('/expenses').set(...auth()).send({ amount: 50, accountId, categoryId: reparationsCategoryId }).expect(201);

    const stranger = await http
      .post('/auth/signup')
      .send({ email: `strangerL3+${run}@example.com`, password: 'password123', firstName: 'S', lastName: 'T' })
      .expect(201);
    const strangerHousehold = await http
      .post('/households')
      .set('Authorization', `Bearer ${stranger.body.accessToken}`)
      .send({ name: 'Foyer étranger L3' })
      .expect(201);
    const strangerAuth = ['Authorization', `Bearer ${strangerHousehold.body.accessToken}`] as [string, string];

    await http.get(`/variable-budgets/${budgetId}`).set(...strangerAuth).expect(404);
    await http.patch(`/variable-budgets/${budgetId}`).set(...strangerAuth).send({ referenceAmount: 1 }).expect(404);
    const list = await http.get('/variable-budgets').set(...strangerAuth).expect(200);
    expect(list.body).toEqual([]);

    // Preuve RLS indépendante du filtre applicatif, sur les trois tables Lot 3.
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_household_id', ${strangerHousehold.body.household.id}, true)`;
      const vb = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "variable_budget" WHERE id = ${budgetId}`;
      const be = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "budget_expense" WHERE id = ${expenseRes.body.expense.id}`;
      const ae = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "adhoc_expense" WHERE id = ${adhocRes.body.expense.id}`;
      return { vb, be, ae };
    });
    expect(rows.vb).toHaveLength(0);
    expect(rows.be).toHaveLength(0);
    expect(rows.ae).toHaveLength(0);
  });

  // ---------- Non-régression contraintes ----------
  it('rejette un montant de dépense négatif ou nul', async () => {
    const accountId = await createAccount('Compte Contrainte Lot3', 1000);
    await http.post('/expenses').set(...auth()).send({ amount: -10, accountId, categoryId: coursesCategoryId }).expect(400);
    await http.post('/expenses').set(...auth()).send({ amount: 0, accountId, categoryId: coursesCategoryId }).expect(400);
  });
});
