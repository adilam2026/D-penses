import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Lot 2 (module Budgets) : un budget peut être scopé à une Category entière
 * (categoryTypeId omis, comportement historique) ou à un CategoryType précis
 * (categoryTypeId renseigné) — réutilise la hiérarchie Category → CategoryType
 * déjà en place, sans nouveau regroupement au-dessus des catégories.
 *
 * Association automatique d'une dépense (ExpensesService.create) : priorité
 * déterministe 1) variableBudgetId explicite 2) budget actif du CategoryType
 * précis de la dépense 3) budget actif de la Category parente (categoryTypeId
 * NULL) 4) aucun budget (AdHocExpense). Chevauchement de scope : jamais
 * bloquant — `overlapWarning` (liste d'ids) sur create/update, sans exception.
 */
describe('Lot 2 — Budgets scopés Category/CategoryType, matching et chevauchements (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  const run = Date.now();
  const mailer = new FakeMailer();
  let seq = 0;

  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold() {
    seq += 1;
    const token = await signupVerified(http, mailer, `lot28+${run}+${seq}@example.com`, 'password123', 'L28', 'T');
    const household = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer Lot28 ${seq}` }).expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function createAccount(auth: () => [string, string], initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name: 'Compte', type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  async function createCategory(auth: () => [string, string], name: string) {
    const res = await http.post('/categories').set(...auth()).send({ name, kind: 'expense' }).expect(201);
    return res.body.id as string;
  }

  async function createCategoryType(auth: () => [string, string], categoryId: string, name: string) {
    const res = await http.post(`/categories/${categoryId}/types`).set(...auth()).send({ name }).expect(201);
    return res.body.id as string;
  }

  async function createBudget(
    auth: () => [string, string],
    categoryId: string,
    categoryTypeId: string | undefined,
    referenceAmount: number,
    startDate = '2020-01-01',
  ) {
    const res = await http
      .post('/variable-budgets')
      .set(...auth())
      .send({ categoryId, categoryTypeId, referenceAmount, referencePeriod: 'mois', startDate })
      .expect(201);
    return res.body as { id: string; overlapWarning: string[] | null };
  }

  // ---------- TEST 1 — auto-match sur un budget scopé au CategoryType précis ----------
  it('TEST 1 — une dépense avec categoryTypeId se rattache au budget scopé à ce CategoryType précis', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const categoryId = await createCategory(h.auth, 'Alimentation T1');
    const typeId = await createCategoryType(h.auth, categoryId, 'Courses T1');
    const budget = await createBudget(h.auth, categoryId, typeId, 2000);

    const expense = await http
      .post('/expenses')
      .set(...h.auth())
      .send({ amount: 150, accountId, categoryId, categoryTypeId: typeId })
      .expect(201);
    expect(expense.body.kind).toBe('budget_expense');
    expect(expense.body.expense.variableBudgetId).toBe(budget.id);
  });

  // ---------- TEST 2 — auto-match sur un budget scopé à la Category parente ----------
  it("TEST 2 — une dépense sans categoryTypeId se rattache au budget scopé à toute la Category", async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const categoryId = await createCategory(h.auth, 'Alimentation T2');
    const budget = await createBudget(h.auth, categoryId, undefined, 4000);

    const expense = await http
      .post('/expenses')
      .set(...h.auth())
      .send({ amount: 300, accountId, categoryId })
      .expect(201);
    expect(expense.body.kind).toBe('budget_expense');
    expect(expense.body.expense.variableBudgetId).toBe(budget.id);
  });

  // ---------- TEST 3 — priorité : type précis avant catégorie parente ----------
  it('TEST 3 — quand les deux scopes existent, le budget du type précis est préféré au budget de la catégorie parente', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const categoryId = await createCategory(h.auth, 'Alimentation T3');
    const typeId = await createCategoryType(h.auth, categoryId, 'Courses T3');
    const budgetCategory = await createBudget(h.auth, categoryId, undefined, 4000);
    const budgetType = await createBudget(h.auth, categoryId, typeId, 2000);
    expect(budgetCategory.id).not.toBe(budgetType.id);

    const expense = await http
      .post('/expenses')
      .set(...h.auth())
      .send({ amount: 150, accountId, categoryId, categoryTypeId: typeId })
      .expect(201);
    expect(expense.body.expense.variableBudgetId).toBe(budgetType.id);
  });

  // ---------- TEST 4 — repli : type précis sans budget dédié retombe sur la catégorie parente ----------
  it("TEST 4 — une dépense avec categoryTypeId retombe sur le budget de la Category parente si aucun budget ne cible ce type précis", async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const categoryId = await createCategory(h.auth, 'Alimentation T4');
    const typeId = await createCategoryType(h.auth, categoryId, 'Restaurant T4');
    const budgetCategory = await createBudget(h.auth, categoryId, undefined, 4000);

    const expense = await http
      .post('/expenses')
      .set(...h.auth())
      .send({ amount: 150, accountId, categoryId, categoryTypeId: typeId })
      .expect(201);
    expect(expense.body.expense.variableBudgetId).toBe(budgetCategory.id);
  });

  // ---------- TEST 5 — chevauchement non bloquant à la création ----------
  it("TEST 5 — un second budget actif sur le même scope exact renvoie un overlapWarning mais n'empêche pas la création", async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation T5');
    const first = await createBudget(h.auth, categoryId, undefined, 4000);
    expect(first.overlapWarning).toBeNull();

    const second = await createBudget(h.auth, categoryId, undefined, 3500);
    expect(second.overlapWarning).toEqual([first.id]);
  });

  // ---------- TEST 6 — chevauchement non bloquant à la modification ----------
  it("TEST 6 — modifier un budget vers un scope déjà couvert par un autre budget actif renvoie un overlapWarning sans erreur", async () => {
    const h = await newHousehold();
    const categoryA = await createCategory(h.auth, 'Alimentation T6a');
    const categoryB = await createCategory(h.auth, 'Alimentation T6b');
    const budgetA = await createBudget(h.auth, categoryA, undefined, 2000);
    const budgetB = await createBudget(h.auth, categoryB, undefined, 1000);

    const updated = await http
      .patch(`/variable-budgets/${budgetB.id}`)
      .set(...h.auth())
      .send({ categoryId: categoryA })
      .expect(200);
    expect(updated.body.overlapWarning).toEqual([budgetA.id]);
  });

  // ---------- TEST 7 — un CategoryType d'une autre catégorie est rejeté ----------
  it("TEST 7 — un categoryTypeId n'appartenant pas à categoryId est rejeté (404) à la création du budget", async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation T7');
    const otherCategoryId = await createCategory(h.auth, 'Loisirs T7');
    const foreignTypeId = await createCategoryType(h.auth, otherCategoryId, 'Cinéma T7');

    await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, categoryTypeId: foreignTypeId, referenceAmount: 1000, referencePeriod: 'mois', startDate: '2020-01-01' })
      .expect(404);
  });

  // ---------- TEST 8 — non-régression : budget catégorie-seule (pré-Lot 2) continue de fonctionner ----------
  it('TEST 8 — non-régression : un budget scopé catégorie (sans categoryTypeId) continue de matcher exactement comme avant le Lot 2', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const categoryId = await createCategory(h.auth, 'Alimentation T8');
    const budget = await createBudget(h.auth, categoryId, undefined, 2500);

    const expense = await http
      .post('/expenses')
      .set(...h.auth())
      .send({ amount: 200, accountId, categoryId })
      .expect(201);
    expect(expense.body.expense.variableBudgetId).toBe(budget.id);

    const detail = await http.get(`/variable-budgets/${budget.id}`).set(...h.auth()).expect(200);
    expect(detail.body.status.consommeADate).toBe(200);
  });

  // ---------- TEST 9 — PATCH categoryTypeId: null repasse le budget au scope catégorie entière ----------
  it("TEST 9 — un budget scopé type peut être repassé au scope catégorie entière via PATCH categoryTypeId:null (symétrie du passage catégorie→type)", async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation T9');
    const typeId = await createCategoryType(h.auth, categoryId, 'Courses T9');
    const budget = await createBudget(h.auth, categoryId, typeId, 2000);

    const updated = await http
      .patch(`/variable-budgets/${budget.id}`)
      .set(...h.auth())
      .send({ categoryTypeId: null })
      .expect(200);
    expect(updated.body.categoryTypeId).toBeNull();
    expect(updated.body.overlapWarning).toBeNull();

    // Persisté : une relecture confirme que categoryTypeId reste bien effacé (pas un artefact de la réponse).
    const detail = await http.get(`/variable-budgets/${budget.id}`).set(...h.auth()).expect(200);
    expect(detail.body.categoryTypeId).toBeNull();
  });

  // ---------- TEST 10 — après le retrait du type, une dépense retombe sur le fallback catégorie ----------
  it("TEST 10 — après PATCH categoryTypeId:null, une dépense avec ce categoryTypeId matche de nouveau le budget désormais scopé catégorie", async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const categoryId = await createCategory(h.auth, 'Alimentation T10');
    const typeId = await createCategoryType(h.auth, categoryId, 'Courses T10');
    const budget = await createBudget(h.auth, categoryId, typeId, 2000);

    // Avant retrait : le budget est scopé au type précis, donc invisible pour une dépense sans categoryTypeId.
    const beforeExpense = await http
      .post('/expenses')
      .set(...h.auth())
      .send({ amount: 100, accountId, categoryId })
      .expect(201);
    expect(beforeExpense.body.kind).toBe('adhoc_expense');

    await http
      .patch(`/variable-budgets/${budget.id}`)
      .set(...h.auth())
      .send({ categoryTypeId: null })
      .expect(200);

    // Après retrait : le budget (désormais scopé catégorie entière) redevient le fallback pour une
    // dépense portant ce même categoryTypeId (plus aucun budget dédié à ce type précis).
    const afterExpense = await http
      .post('/expenses')
      .set(...h.auth())
      .send({ amount: 150, accountId, categoryId, categoryTypeId: typeId })
      .expect(201);
    expect(afterExpense.body.kind).toBe('budget_expense');
    expect(afterExpense.body.expense.variableBudgetId).toBe(budget.id);
  });
});
