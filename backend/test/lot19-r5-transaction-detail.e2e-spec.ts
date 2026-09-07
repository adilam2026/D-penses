import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * R5 §5 — GET /transactions/:kind/:id : détail enrichi d'une ligne de
 * transaction. Jamais un second calcul : lit l'entité réelle derrière la
 * ligne LedgerEntry (kind+id l'identifient sans ambiguïté).
 */
describe('R5 §5 — GET /transactions/:kind/:id (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot19+${run}+${seq}@example.com`, 'password123', 'L19', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer R5-5 ${seq}` })
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

  it('payment : renvoie label du plan, montant négatif, échéance liée et plan financier', async () => {
    const { auth } = await newHousehold();
    const account = await createAccount(auth, 'Compte paiement', 10000);
    const cat = await createCategory(auth, 'École paiement détail');
    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'École détail', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
      .expect(201);
    const cp = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Frais scolarité détail', categoryId: cat, generationMode: 'calendrier_manuel', financialPlanId: plan.body.id, startDate: '2026-09-01' })
      .expect(201);
    const d = await http
      .post(`/charge-plans/${cp.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-09-30', amountCurrent: 1500, amountStatus: 'confirme' })
      .expect(201);
    const payment = await http
      .post(`/deadlines/${d.body.id}/payments`)
      .set(...auth())
      .send({ amount: 1500, accountId: account, notes: 'Paiement de test détail' })
      .expect(201);

    const res = await http.get(`/transactions/payment/${payment.body.payment.id}`).set(...auth()).expect(200);
    expect(res.body.label).toBe('Frais scolarité détail');
    expect(res.body.amount).toBe(-1500);
    expect(res.body.accountId).toBe(account);
    expect(res.body.note).toBe('Paiement de test détail');
    expect(res.body.deadline.id).toBe(d.body.id);
    expect(res.body.deadline.chargePlanLabel).toBe('Frais scolarité détail');
    expect(res.body.financialPlan.id).toBe(plan.body.id);
    expect(res.body.financialPlan.label).toBe('École détail');
    expect(res.body.origin).toBe("Paiement d'une échéance");
  });

  it('income : renvoie le libellé de la source, le montant positif et le compte crédité', async () => {
    const { auth } = await newHousehold();
    const account = await createAccount(auth, 'Compte revenu', 0);
    const source = await http
      .post('/income-sources')
      .set(...auth())
      .send({ label: 'Salaire détail', usualAmount: 12000, defaultAccountId: account })
      .expect(201);
    const occ = await http
      .post(`/income-sources/${source.body.id}/occurrences`)
      .set(...auth())
      .send({ usualDate: '2026-09-30' })
      .expect(201);
    const confirmed = await http
      .post(`/income-occurrences/${occ.body.id}/confirm`)
      .set(...auth())
      .send({ actualAmount: 12000, accountId: account })
      .expect(201);

    const res = await http.get(`/transactions/income/${confirmed.body.id}`).set(...auth()).expect(200);
    expect(res.body.label).toBe('Salaire détail');
    expect(res.body.amount).toBe(12000);
    expect(res.body.accountId).toBe(account);
    expect(res.body.origin).toBe('Revenu confirmé');
  });

  it('adhoc_expense : dépense ponctuelle sans budget variable actif, montant négatif, libellé Type · Sous-type', async () => {
    const { auth } = await newHousehold();
    const account = await createAccount(auth, 'Compte dépense', 5000);
    const cat = await createCategory(auth, 'Alimentation détail');
    const type = await http.post(`/categories/${cat}/types`).set(...auth()).send({ name: 'Courses détail' }).expect(201);
    const expense = await http
      .post('/expenses')
      .set(...auth())
      .send({ amount: 250, accountId: account, categoryId: cat, categoryTypeId: type.body.id, notes: 'Note dépense' })
      .expect(201);

    const res = await http.get(`/transactions/adhoc_expense/${expense.body.expense.id}`).set(...auth()).expect(200);
    expect(res.body.label).toBe('Courses détail');
    expect(res.body.amount).toBe(-250);
    expect(res.body.accountId).toBe(account);
    expect(res.body.note).toBe('Note dépense');
    expect(res.body.origin).toBe('Dépense ponctuelle');
  });

  it('budget_expense : dépense rattachée à un budget variable actif', async () => {
    const { auth } = await newHousehold();
    const account = await createAccount(auth, 'Compte budget détail', 5000);
    const cat = await createCategory(auth, 'Loisirs détail');
    const budget = await http
      .post('/variable-budgets')
      .set(...auth())
      .send({ categoryId: cat, referenceAmount: 1000, referencePeriod: 'mois', startDate: '2026-09-01' })
      .expect(201);
    const expense = await http
      .post('/expenses')
      .set(...auth())
      .send({ amount: 80, accountId: account, categoryId: cat, variableBudgetId: budget.body.id })
      .expect(201);

    const res = await http.get(`/transactions/budget_expense/${expense.body.expense.id}`).set(...auth()).expect(200);
    expect(res.body.amount).toBe(-80);
    expect(res.body.accountId).toBe(account);
    expect(res.body.origin).toBe('Dépense sur budget variable');
  });

  it('transfer_in / transfer_out : montants opposés, contrepartie renseignée des deux côtés', async () => {
    const { auth } = await newHousehold();
    const source = await createAccount(auth, 'Source transfert détail', 3000);
    const dest = await createAccount(auth, 'Destination transfert détail', 1000);
    const transfer = await http
      .post('/accounts/transfers')
      .set(...auth())
      .send({ fromAccountId: source, toAccountId: dest, amount: 500 })
      .expect(201);
    expect(transfer.body.status).toBe('confirme');

    const out = await http.get(`/transactions/transfer_out/${transfer.body.id}`).set(...auth()).expect(200);
    expect(out.body.amount).toBe(-500);
    expect(out.body.accountId).toBe(source);
    expect(out.body.transferCounterpart.accountId).toBe(dest);

    const inRes = await http.get(`/transactions/transfer_in/${transfer.body.id}`).set(...auth()).expect(200);
    expect(inRes.body.amount).toBe(500);
    expect(inRes.body.accountId).toBe(dest);
    expect(inRes.body.transferCounterpart.accountId).toBe(source);
  });

  it('adjustment : écart de rapprochement, montant signé égal au discrepancy', async () => {
    const { auth } = await newHousehold();
    const account = await createAccount(auth, 'Compte rapprochement détail', 1000);
    const reconciliation = await http
      .post(`/accounts/${account}/reconciliations`)
      .set(...auth())
      .send({ declaredBalance: 950 })
      .expect(201);
    const adjust = await http
      .post(`/accounts/${account}/reconciliations/${reconciliation.body.id}/adjust`)
      .set(...auth())
      .send({ reason: 'Écart test détail' })
      .expect(201);

    const res = await http.get(`/transactions/adjustment/${adjust.body.adjustment.id}`).set(...auth()).expect(200);
    expect(res.body.amount).toBe(-50);
    expect(res.body.accountId).toBe(account);
    expect(res.body.label).toBe('Écart test détail');
    expect(res.body.origin).toBe('Ajustement de rapprochement');
  });

  it('kind inconnu → 400, id inexistant → 404', async () => {
    const { auth } = await newHousehold();
    await http.get('/transactions/unknown_kind/whatever').set(...auth()).expect(400);
    await http.get('/transactions/payment/00000000-0000-0000-0000-000000000000').set(...auth()).expect(404);
  });

  it("isolation foyer (RLS) : le détail d'une transaction d'un autre foyer est introuvable (404), jamais exposé", async () => {
    const { auth: authA } = await newHousehold();
    const { auth: authB } = await newHousehold();
    const account = await createAccount(authA, 'Compte foyer A', 5000);
    const cat = await createCategory(authA, 'Cat foyer A');
    const expense = await http
      .post('/expenses')
      .set(...authA())
      .send({ amount: 100, accountId: account, categoryId: cat })
      .expect(201);

    await http.get(`/transactions/adhoc_expense/${expense.body.expense.id}`).set(...authB()).expect(404);
  });
});
