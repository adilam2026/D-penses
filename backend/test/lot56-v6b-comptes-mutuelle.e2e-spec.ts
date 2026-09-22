import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Refonte maquette V6B — PHASE 1/2/8 : compte dédié (affichage, jamais un
 * nouveau moteur de solde), enveloppes non additives sur un compte, dépense
 * Santé remboursable → dossier MedicalClaim automatique (jamais un revenu
 * projeté), clôture partielle du dossier (reste à charge, jamais de double
 * comptage). Scénarios 1/5/6 du cahier des charges.
 */
describe('V6B — comptes dédiés + enveloppes non additives + mutuelle (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot56+${run}+${seq}@example.com`, 'password123', 'L56', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer V6B ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function newAccount(auth: () => [string, string], body: Record<string, unknown>) {
    const res = await http.post('/accounts').set(...auth()).send({ type: 'courant', initialBalance: 0, ...body }).expect(201);
    return res.body;
  }

  async function newCategory(auth: () => [string, string], name: string) {
    const res = await http.post('/categories').set(...auth()).send({ name, kind: 'expense' }).expect(201);
    return res.body.id as string;
  }

  // ============================================================
  // Scénario 1 — enveloppes non additives sur un compte
  // ============================================================
  it('A. un compte avec 3 enveloppes virtuelles affiche solde=8000 (jamais 16000) et la liste des 3 enveloppes', async () => {
    const { auth } = await newHousehold();
    const account = await newAccount(auth, { name: 'CIH Lamiaa 1', bankName: 'CIH', initialBalance: 8000 });

    for (const [name, target] of [
      ['Scolarité', 5000],
      ['Voiture', 1500],
      ['Voyage', 1500],
    ] as const) {
      const pocket = await http
        .post('/pockets')
        .set(...auth())
        .send({ name, allocationMode: 'virtual_allocation', linkedAccountId: account.id, targetAmount: target })
        .expect(201);
      await http
        .post(`/pockets/${pocket.body.id}/contribute`)
        .set(...auth())
        .send({ amount: target, confirmed: true })
        .expect(201);
    }

    const detail = await http.get(`/accounts/${account.id}`).set(...auth()).expect(200);
    expect(detail.body.soldeCourant).toBe(8000);
    expect(detail.body.reservedByEnvelopes).toBe(8000);
    expect(detail.body.envelopes).toHaveLength(3);
    const byName = Object.fromEntries(detail.body.envelopes.map((e: any) => [e.name, e.amount]));
    expect(byName['Scolarité']).toBe(5000);
    expect(byName['Voiture']).toBe(1500);
    expect(byName['Voyage']).toBe(1500);
  });

  // ============================================================
  // Compte dédié — affichage "Alimenté depuis X • Y DH/mois"
  // ============================================================
  it('B. un compte dédié affiche dedicatedFeed lu depuis le RecurringTransfer entrant actif, sans nouveau champ de solde', async () => {
    const { auth } = await newHousehold();
    const source = await newAccount(auth, { name: 'BP Lamiaa 2', initialBalance: 20000 });
    const cat = await newCategory(auth, 'Courses');
    const dedicated = await newAccount(auth, { name: 'Compte courses', isDedicated: true, dedicatedCategoryId: cat, initialBalance: 0 });

    await http
      .post('/recurring-transfers')
      .set(...auth())
      .send({
        label: 'Alimentation compte courses',
        fromAccountId: source.id,
        toAccountId: dedicated.id,
        amount: 6000,
        recurrenceRule: 'mensuel',
        recurrenceAnchorDate: '2026-09-01',
      })
      .expect(201);

    const detail = await http.get(`/accounts/${dedicated.id}`).set(...auth()).expect(200);
    expect(detail.body.isDedicated).toBe(true);
    expect(detail.body.dedicatedFeed).toEqual({ fromAccountName: 'BP Lamiaa 2', amount: 6000, recurrenceRule: 'mensuel' });
  });

  // ============================================================
  // Scénario 5/6 — dépense Santé remboursable → dossier mutuelle automatique
  // ============================================================
  it('C. une dépense Santé remboursableMutuelle=true crée une AdHocExpense (jamais une BudgetExpense) + 1 MedicalClaim lié, amountReimbursed=0/status=en_attente', async () => {
    const { auth } = await newHousehold();
    const account = await newAccount(auth, { name: 'BP Lamiaa 2', initialBalance: 5000 });
    const cat = await newCategory(auth, 'Santé');

    // Un budget variable actif existe pour cette même catégorie — la dépense
    // mutuelle ne doit JAMAIS y être rattachée (sinon elle échapperait au
    // suivi 1:1 du dossier).
    await http
      .post('/variable-budgets')
      .set(...auth())
      .send({ categoryId: cat, referenceAmount: 1000, referencePeriod: 'mois', startDate: '2026-09-01' })
      .expect(201);

    const expense = await http
      .post('/expenses')
      .set(...auth())
      .send({ amount: 500, accountId: account.id, categoryId: cat, label: 'Consultation pédiatre', spentDate: '2026-09-25', remboursableMutuelle: true })
      .expect(201);

    expect(expense.body.kind).toBe('adhoc_expense');
    expect(expense.body.expense.remboursableMutuelle).toBe(true);
    expect(expense.body.expense.label).toBe('Consultation pédiatre');
    expect(expense.body.soldeCourant).toBe(4500);
    expect(expense.body.medicalClaim).not.toBeNull();
    expect(expense.body.medicalClaim.amountEngaged).toBe(500);
    expect(expense.body.medicalClaim.amountReimbursed).toBe(0);
    expect(expense.body.medicalClaim.status).toBe('en_attente');

    const list = await http.get('/medical-claims').set(...auth()).expect(200);
    expect(list.body.summary.pendingCount).toBe(1);
    expect(list.body.summary.totalEngaged).toBe(500);
    expect(list.body.summary.totalReimbursed).toBe(0);
    expect(list.body.claims).toHaveLength(1);
    expect(list.body.claims[0].resteACharge).toBe(500);
  });

  it('D. clôturer un dossier avec un remboursement partiel crédite réellement le compte, calcule le reste à charge, jamais un revenu projeté', async () => {
    const { auth } = await newHousehold();
    const account = await newAccount(auth, { name: 'BP Lamiaa 2', initialBalance: 5000 });
    const cih = await newAccount(auth, { name: 'CIH Lamiaa 1', initialBalance: 1000 });
    const cat = await newCategory(auth, 'Santé');

    const expense = await http
      .post('/expenses')
      .set(...auth())
      .send({ amount: 500, accountId: account.id, categoryId: cat, label: 'Consultation pédiatre', spentDate: '2026-09-25', remboursableMutuelle: true })
      .expect(201);
    expect(expense.body.soldeCourant).toBe(4500);
    const claimId = expense.body.medicalClaim.id as string;

    const closed = await http
      .post(`/medical-claims/${claimId}/close`)
      .set(...auth())
      .send({ amountReceived: 420, reimbursementDate: '2026-10-12', reimbursementAccountId: cih.id })
      .expect(201);

    expect(closed.body.claim.amountReimbursed).toBe(420);
    expect(closed.body.claim.resteACharge).toBe(80);
    expect(closed.body.claim.status).toBe('partiellement_rembourse');
    expect(closed.body.soldeCourant).toBe(1420);

    const cihDetail = await http.get(`/accounts/${cih.id}`).set(...auth()).expect(200);
    expect(cihDetail.body.soldeCourant).toBe(1420);

    // Jamais un revenu : aucune IncomeSource/IncomeOccurrence créée par la clôture.
    const incomes = await http.get('/income-sources').set(...auth()).expect(200);
    expect(incomes.body).toEqual([]);

    // Un second appel de clôture sur un dossier déjà clôturé/partiel doit être refusé.
    await http
      .post(`/medical-claims/${claimId}/close`)
      .set(...auth())
      .send({ amountReceived: 80, reimbursementDate: '2026-10-13', reimbursementAccountId: cih.id })
      .expect(400);
  });

  it('E. clôturer avec le montant intégral passe le statut à cloture (jamais partiellement_rembourse)', async () => {
    const { auth } = await newHousehold();
    const account = await newAccount(auth, { name: 'BP Lamiaa 2', initialBalance: 5000 });
    const cih = await newAccount(auth, { name: 'CIH Lamiaa 1', initialBalance: 0 });
    const cat = await newCategory(auth, 'Santé');

    const expense = await http
      .post('/expenses')
      .set(...auth())
      .send({ amount: 320, accountId: account.id, categoryId: cat, label: 'Pharmacie', spentDate: '2026-09-25', remboursableMutuelle: true })
      .expect(201);
    const claimId = expense.body.medicalClaim.id as string;

    const closed = await http
      .post(`/medical-claims/${claimId}/close`)
      .set(...auth())
      .send({ amountReceived: 320, reimbursementDate: '2026-10-01', reimbursementAccountId: cih.id })
      .expect(201);

    expect(closed.body.claim.status).toBe('cloture');
    expect(closed.body.claim.resteACharge).toBe(0);
  });
});
