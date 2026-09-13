import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';

/**
 * Lot T1 (module Transactions) — filtres serveur additifs sur GET /transactions
 * (période, kind, compte, catégorie, budget, plan financier, initiateur) et
 * 4 colonnes ajoutées à ledger_entry (createdByUserId/createdByName/budgetId/
 * financialPlanId). Aucun changement des règles de trésorerie, aucune
 * reconstruction du registre — cf. migration 20260913180000.
 */
describe('Lot T1 — filtres GET /transactions + colonnes ledger_entry (e2e)', () => {
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

  function userIdFromToken(accessToken: string): string {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString('utf8'));
    return payload.sub as string;
  }

  async function signup(label: string) {
    seq += 1;
    const email = `lot34+${run}+${seq}@example.com`;
    await http.post('/auth/signup').send({ email, password: 'password123', firstName: label, lastName: 'T' }).expect(201);
    const code = mailer.lastCodeFor(email);
    const verified = await http.post('/auth/verify-email-otp').send({ email, code }).expect(200);
    const accessToken = verified.body.accessToken as string;
    return { userId: userIdFromToken(accessToken), accessToken };
  }

  async function newHousehold(name = 'Foyer T1') {
    const owner = await signup('Adulte1');
    const household = await http.post('/households').set('Authorization', `Bearer ${owner.accessToken}`).send({ name: `${name} ${seq}` }).expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { householdId: household.body.household.id as string, userId: owner.userId, auth };
  }

  async function inviteSecondAdult(h: { auth: () => [string, string] }) {
    const invite = await http.post('/households/invites').set(...h.auth()).send({ role: 'admin' }).expect(201);
    const second = await signup('Adulte2');
    const joined = await http.post('/households/join').set('Authorization', `Bearer ${second.accessToken}`).send({ code: invite.body.code }).expect(201);
    const accessToken = joined.body.accessToken as string;
    return { userId: second.userId, auth: () => ['Authorization', `Bearer ${accessToken}`] as [string, string] };
  }

  async function createAccount(auth: () => [string, string], name: string, initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  async function createCategory(auth: () => [string, string], name: string) {
    const res = await http.post('/categories').set(...auth()).send({ name, kind: 'expense' }).expect(201);
    return res.body.id as string;
  }

  /** Accès direct DB (bypass RLS via SET LOCAL, même pattern que lot32.e2e-spec.ts)
   *  — uniquement pour simuler une colonne initiateur source réellement NULL
   *  (TEST 6), situation que l'API normale ne produit jamais. */
  async function withHouseholdContext<T>(householdId: string, fn: (tx: any) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_household_id', ${householdId}, true)`;
      return fn(tx);
    });
  }

  it('TEST 1 — budgetId/financialPlanId toujours null pour income/transfer_in/transfer_out/adjustment ; createdByName correct', async () => {
    const h = await newHousehold();
    const account = await createAccount(h.auth, 'Compte T1-1a', 5000);
    const account2 = await createAccount(h.auth, 'Compte T1-1b', 1000);
    const source = await http.post('/income-sources').set(...h.auth()).send({ label: 'Salaire T1', usualAmount: 3000, defaultAccountId: account }).expect(201);
    const occ = await http.post(`/income-sources/${source.body.id}/occurrences`).set(...h.auth()).send({ usualDate: '2026-01-10' }).expect(201);
    await http.post(`/income-occurrences/${occ.body.id}/confirm`).set(...h.auth()).send({ actualAmount: 3000, accountId: account, actualDate: '2026-01-10' }).expect(201);
    await http.post('/accounts/transfers').set(...h.auth()).send({ fromAccountId: account, toAccountId: account2, amount: 200 }).expect(201);
    const reconciliation = await http.post(`/accounts/${account}/reconciliations`).set(...h.auth()).send({ declaredBalance: 2750 }).expect(201);
    await http.post(`/accounts/${account}/reconciliations/${reconciliation.body.id}/adjust`).set(...h.auth()).send({ reason: 'Écart T1' }).expect(201);

    const res = await http.get('/transactions').set(...h.auth()).expect(200);
    const byKind = (k: string) => res.body.find((t: any) => t.kind === k);
    for (const kind of ['income', 'transfer_in', 'transfer_out', 'adjustment']) {
      const row = byKind(kind);
      expect(row).toBeTruthy();
      expect(row.budgetId).toBeNull();
      expect(row.financialPlanId).toBeNull();
    }
    // Le revenu a été confirmé par le propriétaire du foyer — nom affichable robuste (concat_ws).
    expect(byKind('income').createdByUserId).toBe(h.userId);
    expect(byKind('income').createdByName).toBe('Adulte1 T');
  });

  it("TEST 2 — payment rattaché à un ChargePlan SANS FinancialPlan : financialPlanId=null (jamais inventé)", async () => {
    const h = await newHousehold();
    const account = await createAccount(h.auth, 'Compte T1-2', 10000);
    const cat = await createCategory(h.auth, 'Cat T1-2');
    const cp = await http.post('/charge-plans').set(...h.auth()).send({ label: 'Charge autonome T1', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-01-01' }).expect(201);
    const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...h.auth()).send({ dueDate: '2026-01-15', amountCurrent: 300, amountStatus: 'confirme' }).expect(201);
    await http.post(`/deadlines/${d.body.id}/payments`).set(...h.auth()).send({ amount: 300, accountId: account }).expect(201);

    const res = await http.get('/transactions?kind=payment').set(...h.auth()).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].financialPlanId).toBeNull();
    expect(res.body[0].budgetId).toBeNull();
  });

  it('TEST 3 — budget_expense : budgetId = variableBudgetId réel ; filtrer par ce budgetId isole exactement cette ligne', async () => {
    const h = await newHousehold();
    const account = await createAccount(h.auth, 'Compte T1-3', 5000);
    const cat = await createCategory(h.auth, 'Cat T1-3');
    const budget = await http.post('/variable-budgets').set(...h.auth()).send({ categoryId: cat, referenceAmount: 500, referencePeriod: 'mois', startDate: '2026-01-01' }).expect(201);
    await http.post('/expenses').set(...h.auth()).send({ amount: 40, accountId: account, categoryId: cat, variableBudgetId: budget.body.id, spentDate: '2026-01-05' }).expect(201);
    // Bruit : une dépense ponctuelle sur une AUTRE catégorie (sans budget actif),
    // ne doit jamais apparaître dans le filtre budgetId.
    const catNoise = await createCategory(h.auth, 'Cat T1-3-bruit');
    await http.post('/expenses').set(...h.auth()).send({ amount: 20, accountId: account, categoryId: catNoise, spentDate: '2026-01-06' }).expect(201);

    const res = await http.get(`/transactions?budgetId=${budget.body.id}`).set(...h.auth()).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].kind).toBe('budget_expense');
    expect(res.body[0].budgetId).toBe(budget.body.id);
  });

  it('TEST 4 — kind=transfer_in exclut transfer_out ; kind=payment,budget_expense exclut les transferts', async () => {
    const h = await newHousehold();
    const account = await createAccount(h.auth, 'Compte T1-4a', 3000);
    const account2 = await createAccount(h.auth, 'Compte T1-4b', 100);
    const cat = await createCategory(h.auth, 'Cat T1-4');
    await http.post('/accounts/transfers').set(...h.auth()).send({ fromAccountId: account, toAccountId: account2, amount: 150 }).expect(201);
    const budget = await http.post('/variable-budgets').set(...h.auth()).send({ categoryId: cat, referenceAmount: 500, referencePeriod: 'mois', startDate: '2026-01-01' }).expect(201);
    await http.post('/expenses').set(...h.auth()).send({ amount: 30, accountId: account, categoryId: cat, variableBudgetId: budget.body.id, spentDate: '2026-01-05' }).expect(201);

    const transferIn = await http.get('/transactions?kind=transfer_in').set(...h.auth()).expect(200);
    expect(transferIn.body).toHaveLength(1);
    expect(transferIn.body[0].kind).toBe('transfer_in');

    const expenseKinds = await http.get('/transactions?kind=payment,budget_expense').set(...h.auth()).expect(200);
    expect(expenseKinds.body.every((t: any) => t.kind !== 'transfer_in' && t.kind !== 'transfer_out')).toBe(true);
    expect(expenseKinds.body).toHaveLength(1);
    expect(expenseKinds.body[0].kind).toBe('budget_expense');
  });

  it("TEST 5 — createdByUserId filtre toutes les branches confondues pour un seul membre du foyer", async () => {
    const h = await newHousehold();
    const second = await inviteSecondAdult(h);
    const account = await createAccount(h.auth, 'Compte T1-5', 5000);
    const cat = await createCategory(h.auth, 'Cat T1-5');
    // Propriétaire : une dépense ponctuelle.
    await http.post('/expenses').set(...h.auth()).send({ amount: 25, accountId: account, categoryId: cat, spentDate: '2026-01-05' }).expect(201);
    // Second adulte : une autre dépense ponctuelle, même foyer.
    await http.post('/expenses').set(...second.auth()).send({ amount: 60, accountId: account, categoryId: cat, spentDate: '2026-01-06' }).expect(201);

    const res = await http.get(`/transactions?createdByUserId=${second.userId}`).set(...h.auth()).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].amount).toBe(-60);
    expect(res.body[0].createdByUserId).toBe(second.userId);
  });

  it('TEST 6 — colonne initiateur source réellement NULL : createdByUserId/createdByName=null, aucun crash', async () => {
    const h = await newHousehold();
    const account = await createAccount(h.auth, 'Compte T1-6a', 3000);
    const account2 = await createAccount(h.auth, 'Compte T1-6b', 0);
    const transfer = await http.post('/accounts/transfers').set(...h.auth()).send({ fromAccountId: account, toAccountId: account2, amount: 100 }).expect(201);

    // Situation que l'API ne produit jamais (confirmedById toujours renseigné à la confirmation) —
    // simulée pour vérifier que le LEFT JOIN sur "user" ne casse rien quand la source est NULL.
    await withHouseholdContext(h.householdId, (tx) => tx.accountTransfer.update({ where: { id: transfer.body.id }, data: { confirmedById: null } }));

    const res = await http.get('/transactions?kind=transfer_out').set(...h.auth()).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].createdByUserId).toBeNull();
    expect(res.body[0].createdByName).toBeNull();
  });

  it('TEST 7 — combinaison from+to+kind+accountId en AND strict ; résultat vide => []', async () => {
    const h = await newHousehold();
    const account = await createAccount(h.auth, 'Compte T1-7a', 5000);
    const account2 = await createAccount(h.auth, 'Compte T1-7b', 5000);
    const cat = await createCategory(h.auth, 'Cat T1-7');
    await http.post('/expenses').set(...h.auth()).send({ amount: 15, accountId: account, categoryId: cat, spentDate: '2026-01-10' }).expect(201);
    await http.post('/expenses').set(...h.auth()).send({ amount: 15, accountId: account2, categoryId: cat, spentDate: '2026-01-20' }).expect(201);

    const res = await http
      .get('/transactions?from=2026-01-15T00:00:00.000Z&to=2026-01-25T00:00:00.000Z&kind=adhoc_expense&' + `accountId=${account2}`)
      .set(...h.auth())
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].accountId).toBe(account2);

    const empty = await http
      .get('/transactions?from=2026-01-15T00:00:00.000Z&to=2026-01-25T00:00:00.000Z&kind=adhoc_expense&' + `accountId=${account}`)
      .set(...h.auth())
      .expect(200);
    expect(empty.body).toEqual([]);
  });

  it("TEST 8 — borne `to` exclusive : une ligne exactement à `to` est exclue", async () => {
    const h = await newHousehold();
    const account = await createAccount(h.auth, 'Compte T1-8', 5000);
    const cat = await createCategory(h.auth, 'Cat T1-8');
    await http.post('/expenses').set(...h.auth()).send({ amount: 15, accountId: account, categoryId: cat, spentDate: '2026-02-01' }).expect(201);

    const res = await http
      .get('/transactions?from=2026-01-31T00:00:00.000Z&to=2026-02-01T00:00:00.000Z')
      .set(...h.auth())
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it("TEST 9 — RLS : un createdByUserId valide dans un AUTRE foyer ne fait fuiter aucune ligne", async () => {
    const hA = await newHousehold();
    const hB = await newHousehold();
    const accountB = await createAccount(hB.auth, 'Compte T1-9', 5000);
    const catB = await createCategory(hB.auth, 'Cat T1-9');
    await http.post('/expenses').set(...hB.auth()).send({ amount: 40, accountId: accountB, categoryId: catB, spentDate: '2026-01-05' }).expect(201);

    const res = await http.get(`/transactions?createdByUserId=${hB.userId}`).set(...hA.auth()).expect(200);
    expect(res.body).toEqual([]);
  });

  it('TEST 10 — non-régression account_current_balance après extension de ledger_entry', async () => {
    const h = await newHousehold();
    const account = await createAccount(h.auth, 'Compte T1-10', 1000);
    const cat = await createCategory(h.auth, 'Cat T1-10');
    // Date sciemment postérieure à la création du compte (donc au snapshot de solde
    // déclaré) — movements_since ne compte que les mouvements après ce snapshot.
    await http.post('/expenses').set(...h.auth()).send({ amount: 100, accountId: account, categoryId: cat, spentDate: '2026-10-05' }).expect(201);

    const res = await http.get('/accounts').set(...h.auth()).expect(200);
    const acc = res.body.find((a: any) => a.id === account);
    expect(acc.soldeCourant).toBe(900);
  });
});
