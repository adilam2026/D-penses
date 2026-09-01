import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Tests Lot 2 (docs/05-roadmap-et-risques.md "Tests obligatoires" Lot 2 + TEST 1-11
 * de la demande). Référence normative : docs/02-modele-metier.md §C.3/C.4, E.2/E.3,
 * F.2 (RG-014 à RG-016) ; docs/04-architecture-technique-et-donnees.md §P.2 (LedgerEntry).
 */
describe('Lot 2 — Revenus & charges de base (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let prisma: PrismaService;
  const run = Date.now();

  let accessToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    const signup = await http
      .post('/auth/signup')
      .send({ email: `lot2+${run}@example.com`, password: 'password123', firstName: 'L2', lastName: 'T' })
      .expect(201);
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signup.body.accessToken}`)
      .send({ name: 'Foyer Lot2' })
      .expect(201);
    accessToken = household.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];

  async function createAccount(name: string, initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  async function createChargePlanAndDeadline(opts: { dueDate: string; amountCurrent: number; label?: string }) {
    const plan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: opts.label ?? 'Charge test', startDate: opts.dueDate })
      .expect(201);
    const deadline = await http
      .post(`/charge-plans/${plan.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: opts.dueDate, amountCurrent: opts.amountCurrent })
      .expect(201);
    return { chargePlanId: plan.body.id as string, deadlineId: deadline.body.id as string };
  }

  // ---------- TEST 1 & TEST 2 — revenu prévu puis reçu ----------
  it('TEST 1 — un revenu prévu ne modifie jamais un solde réel', async () => {
    const accountId = await createAccount('Compte Salaire', 10000);
    const source = await http
      .post('/income-sources')
      .set(...auth())
      .send({ label: 'Salaire', usualAmount: 18000, defaultAccountId: accountId })
      .expect(201);
    const occurrence = await http
      .post(`/income-sources/${source.body.id}/occurrences`)
      .set(...auth())
      .send({ usualDate: '2026-09-30' })
      .expect(201);
    expect(occurrence.body.status).toBe('prevu');

    const account = await http.get(`/accounts/${accountId}`).set(...auth()).expect(200);
    expect(account.body.soldeCourant).toBe(10000); // aucun impact tant que non confirmé

    // TEST 2 — confirmation « Salaire reçu »
    const confirmed = await http
      .post(`/income-occurrences/${occurrence.body.id}/confirm`)
      .set(...auth())
      .send({ actualAmount: 18000, accountId })
      .expect(201);
    expect(confirmed.body.status).toBe('recu');
    expect(confirmed.body.soldeCourant).toBe(28000);

    const accountAfter = await http.get(`/accounts/${accountId}`).set(...auth()).expect(200);
    expect(accountAfter.body.soldeCourant).toBe(28000);
  });

  // ---------- TEST 3 — signe du paiement sur le solde (régression IF-20 / doc04 §P.2) ----------
  it('TEST 3 — un paiement de 1000 DH sur un compte de 10000 DH donne 9000, jamais 11000', async () => {
    const accountId = await createAccount('Compte Paiement', 10000);
    const { deadlineId } = await createChargePlanAndDeadline({ dueDate: '2026-10-05', amountCurrent: 1000 });

    const payment = await http
      .post(`/deadlines/${deadlineId}/payments`)
      .set(...auth())
      .send({ amount: 1000, accountId })
      .expect(201);
    expect(payment.body.soldeCourant).toBe(9000);

    const account = await http.get(`/accounts/${accountId}`).set(...auth()).expect(200);
    expect(account.body.soldeCourant).toBe(9000);
  });

  // ---------- TEST 4 — paiement anticipé ----------
  it('TEST 4 — un paiement avant due_date est accepté et impacte le solde immédiatement', async () => {
    const accountId = await createAccount('Compte Anticipé', 5000);
    const { deadlineId } = await createChargePlanAndDeadline({ dueDate: '2026-11-18', amountCurrent: 800 });

    const payment = await http
      .post(`/deadlines/${deadlineId}/payments`)
      .set(...auth())
      .send({ amount: 800, accountId, paidDate: '2026-11-08' })
      .expect(201);
    expect(payment.body.soldeCourant).toBe(4200);

    const deadline = await http.get(`/deadlines/${deadlineId}`).set(...auth()).expect(200);
    expect(deadline.body.dueDate).toContain('2026-11-18'); // due_date reste la date contractuelle
    expect(Number(deadline.body.resteAPayer)).toBe(0);
  });

  // ---------- TEST 5 & TEST 6 — paiement partiel puis second paiement ----------
  it('TEST 5/6 — paiement partiel puis complémentaire : reste_a_payer décroît, clôture jamais automatique', async () => {
    const accountId = await createAccount('Compte Facture', 50000);
    const { deadlineId } = await createChargePlanAndDeadline({ dueDate: '2026-12-01', amountCurrent: 20000 });

    const p1 = await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 15000, accountId }).expect(201);
    expect(Number(p1.body.deadline.resteAPayer)).toBe(5000);
    expect(p1.body.deadline.financialStatus).toBe('partiellement_payee');

    const p2 = await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 5000, accountId }).expect(201);
    expect(Number(p2.body.deadline.resteAPayer)).toBe(0);
    // RG-014 : le simple atteinte du cumul ne suffit pas — jamais soldée automatiquement.
    expect(p2.body.deadline.financialStatus).toBe('partiellement_payee');

    const closed = await http.post(`/deadlines/${deadlineId}/close`).set(...auth()).expect(201);
    expect(closed.body.financialStatus).toBe('soldee');

    // Variante : second paiement de 4000 (au lieu de 5000) → reste = 1000, pas soldable.
    const { deadlineId: deadline2 } = await createChargePlanAndDeadline({ dueDate: '2026-12-05', amountCurrent: 20000 });
    await http.post(`/deadlines/${deadline2}/payments`).set(...auth()).send({ amount: 15000, accountId }).expect(201);
    const p2bis = await http.post(`/deadlines/${deadline2}/payments`).set(...auth()).send({ amount: 4000, accountId }).expect(201);
    expect(Number(p2bis.body.deadline.resteAPayer)).toBe(1000);
    await http.post(`/deadlines/${deadline2}/close`).set(...auth()).send({}).expect(400); // reste_a_payer > 0
  });

  // ---------- TEST 7 — remboursement ----------
  it('TEST 7 — un remboursement augmente le compte et fait remonter reste_a_payer', async () => {
    const accountId = await createAccount('Compte Remboursement', 0);
    const { deadlineId } = await createChargePlanAndDeadline({ dueDate: '2026-09-20', amountCurrent: 10000 });

    await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 10000, accountId }).expect(201);
    await http.post(`/deadlines/${deadlineId}/close`).set(...auth()).expect(201);
    const afterPayment = await http.get(`/accounts/${accountId}`).set(...auth()).expect(200);
    expect(afterPayment.body.soldeCourant).toBe(-10000); // mouvement de trésorerie, indépendant de la dette

    const refund = await http
      .post(`/deadlines/${deadlineId}/payments`)
      .set(...auth())
      .send({ amount: 1000, accountId, type: 'remboursement' })
      .expect(201);
    expect(refund.body.soldeCourant).toBe(-9000); // +1000 sur le compte (trésorerie)
    expect(Number(refund.body.deadline.resteAPayer)).toBe(1000); // reste_a_payer remonte (état de la dette)
    expect(refund.body.deadline.financialStatus).toBe('partiellement_payee'); // ne reste jamais affiché "soldée" avec une dette réelle
  });

  // ---------- TEST 8 — révision du montant d'une échéance déjà partiellement payée ----------
  it('TEST 8 — révision du montant recalcule reste_a_payer sur le nouveau montant, jamais l\'ancien', async () => {
    const accountId = await createAccount('Compte Révision', 30000);
    const { deadlineId } = await createChargePlanAndDeadline({ dueDate: '2026-10-15', amountCurrent: 20000 });

    await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 15000, accountId }).expect(201);
    const revised = await http
      .patch(`/deadlines/${deadlineId}`)
      .set(...auth())
      .send({ amountCurrent: 21300, amountStatus: 'confirme' })
      .expect(200);
    expect(Number(revised.body.resteAPayer)).toBe(6300); // jamais 5000
  });

  // ---------- TEST 9 — annulation ----------
  it('TEST 9 — une échéance annulée sort des besoins futurs, son historique reste intact', async () => {
    const accountId = await createAccount('Compte Annulation', 5000);
    const { deadlineId } = await createChargePlanAndDeadline({ dueDate: '2027-01-10', amountCurrent: 2000 });

    const cancelled = await http.post(`/deadlines/${deadlineId}/cancel`).set(...auth()).expect(201);
    expect(cancelled.body.financialStatus).toBe('annulee');

    // Plus payable une fois annulée.
    await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 100, accountId }).expect(400);

    // Un paiement déjà enregistré avant annulation reste historisé (pas de suppression physique).
    const { deadlineId: deadline2 } = await createChargePlanAndDeadline({ dueDate: '2027-01-12', amountCurrent: 2000 });
    await http.post(`/deadlines/${deadline2}/payments`).set(...auth()).send({ amount: 500, accountId }).expect(201);
    await http.post(`/deadlines/${deadline2}/cancel`).set(...auth()).expect(201);
    const payments = await http.get(`/deadlines/${deadline2}/payments`).set(...auth()).expect(200);
    expect(payments.body).toHaveLength(1);
  });

  // ---------- TEST 11 — LedgerEntry : une suite +revenu / -paiement ----------
  it('TEST 11 — LedgerEntry produit exactement les montants signés attendus', async () => {
    const accountId = await createAccount('Compte Ledger', 0);
    const source = await http
      .post('/income-sources')
      .set(...auth())
      .send({ label: 'Revenu Ledger', usualAmount: 18000, defaultAccountId: accountId })
      .expect(201);
    const occurrence = await http
      .post(`/income-sources/${source.body.id}/occurrences`)
      .set(...auth())
      .send({ usualDate: '2026-09-01' })
      .expect(201);
    await http.post(`/income-occurrences/${occurrence.body.id}/confirm`).set(...auth()).send({ actualAmount: 18000, accountId }).expect(201);

    const { deadlineId } = await createChargePlanAndDeadline({ dueDate: '2026-09-02', amountCurrent: 1000 });
    await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 1000, accountId }).expect(201);

    const account = await http.get(`/accounts/${accountId}`).set(...auth()).expect(200);
    expect(account.body.soldeCourant).toBe(17000);

    const transactions = await http.get('/transactions').set(...auth()).expect(200);
    const entries = transactions.body.filter((t: { accountId: string }) => t.accountId === accountId);
    const income = entries.find((t: { kind: string }) => t.kind === 'income');
    const payment = entries.find((t: { kind: string }) => t.kind === 'payment');
    expect(income.amount).toBe(18000);
    expect(income.displayKind).toBe('revenu');
    expect(payment.amount).toBe(-1000);
    expect(payment.displayKind).toBe('paiement');
  });

  // ---------- TEST 10 — isolation stricte par foyer ----------
  it('TEST 10 — un utilisateur extérieur ne peut ni lire, ni créer, ni modifier, ni payer une Deadline d\'un autre foyer', async () => {
    const accountId = await createAccount('Compte Isolation', 10000);
    const { chargePlanId, deadlineId } = await createChargePlanAndDeadline({ dueDate: '2026-09-25', amountCurrent: 3000 });

    const stranger = await http
      .post('/auth/signup')
      .send({ email: `strangerL2+${run}@example.com`, password: 'password123', firstName: 'S', lastName: 'T' })
      .expect(201);
    const strangerHousehold = await http
      .post('/households')
      .set('Authorization', `Bearer ${stranger.body.accessToken}`)
      .send({ name: 'Foyer étranger L2' })
      .expect(201);
    const strangerToken = strangerHousehold.body.accessToken;
    const strangerAuth = ['Authorization', `Bearer ${strangerToken}`] as [string, string];

    await http.get(`/deadlines/${deadlineId}`).set(...strangerAuth).expect(404);
    await http
      .post(`/deadlines/${deadlineId}/payments`)
      .set(...strangerAuth)
      .send({ amount: 100, accountId })
      .expect(404);
    await http.patch(`/deadlines/${deadlineId}`).set(...strangerAuth).send({ amountCurrent: 1 }).expect(404);
    await http.get(`/charge-plans/${chargePlanId}/deadlines`).set(...strangerAuth).expect(404);

    const list = await http.get('/charge-plans').set(...strangerAuth).expect(200);
    expect(list.body).toEqual([]);

    // Preuve RLS indépendante du filtre applicatif.
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_household_id', ${strangerHousehold.body.household.id}, true)`;
      return tx.$queryRaw<{ id: string }[]>`SELECT id FROM "deadline" WHERE id = ${deadlineId}`;
    });
    expect(rows).toHaveLength(0);
  });

  // ---------- Non-régression Lot 0/1 : mêmes contraintes d'intégrité, aucune écriture directe sur LedgerEntry ----------
  it('rejette un Payment.amount négatif ou nul (RG-015)', async () => {
    const accountId = await createAccount('Compte Contrainte', 1000);
    const { deadlineId } = await createChargePlanAndDeadline({ dueDate: '2026-09-10', amountCurrent: 500 });
    await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: -10, accountId }).expect(400);
    await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 0, accountId }).expect(400);
  });
});
