import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Scénarios métier critiques A-J (rapport de reset §12) — validés contre le
 * schéma V3.1 et le moteur ledger.util.ts. Chaque scénario crée son propre
 * foyer/comptes pour rester indépendant des autres. Les montants Decimal se
 * sérialisent en JSON comme des `number` (cf. prisma.service.ts — comportement
 * existant conservé de l'ancien socle, pas une régression de ce reset).
 */
describe('Finance Maison — Phase 1 — scénarios métier A-J', () => {
  let app: INestApplication;
  let http: request.Agent;
  let prisma: PrismaService;
  let mailer: FakeMailer;
  let counter = 0;

  beforeAll(async () => {
    mailer = new FakeMailer();
    app = await createTestApp((builder) => builder.overrideProvider(MailerService).useValue(mailer));
    http = request.agent(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Crée un utilisateur + foyer frais, authentifié, retourne le token d'accès. */
  async function freshHousehold(): Promise<string> {
    const { token } = await freshHouseholdWithId();
    return token;
  }

  async function freshHouseholdWithId(): Promise<{ token: string; householdId: string }> {
    counter += 1;
    const email = `phase1-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Test', `User${counter}`);
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    return { token: res.body.accessToken as string, householdId: res.body.household.id as string };
  }

  /**
   * Requête Prisma directe avec contexte RLS fixé — utile pour medical_claim/
   * medical_reimbursement, pas encore exposées par un contrôleur à ce stade
   * (Phase 1 ne couvre que les services fondamentaux Accounts/FinancialOperations/
   * PlannedOperations). Même patron que RlsContextService.run().
   */
  async function withHouseholdContext<T>(householdId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_household_id', ${householdId}, true)`;
      return fn(tx);
    });
  }

  async function createAccount(token: string, name: string, openingBalance?: number) {
    const res = await http
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, openingBalance: openingBalance?.toString() })
      .expect(201);
    return res.body;
  }

  async function createSubaccount(token: string, accountId: string, name: string, initialAllocation?: number) {
    const res = await http
      .post('/accounts/subaccounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId, name, initialAllocation: initialAllocation?.toString() })
      .expect(201);
    return res.body;
  }

  async function getAccount(token: string, id: string) {
    const res = await http.get(`/accounts/${id}`).set('Authorization', `Bearer ${token}`).expect(200);
    return res.body;
  }

  // ---------------------------------------------------------------
  // F — Ouverture de compte
  // ---------------------------------------------------------------
  it('F — ouverture CIH=20000 crée un OPENING_BALANCE correct', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    expect(cih.balance).toBe(20000);
    expect(cih.nonAffecte).toBe(20000);

    const ops = await http.get('/financial-operations').set('Authorization', `Bearer ${token}`).expect(200);
    expect(ops.body).toHaveLength(1);
    expect(ops.body[0].kind).toBe('OPENING_BALANCE');
    expect(ops.body[0].budgetImpact).toBe('EXCLUDED');
  });

  // ---------------------------------------------------------------
  // G — Création de sous-compte
  // ---------------------------------------------------------------
  it('G — création CIH-Voiture=5000 laisse CIH à 20000, Voiture=5000, non affecté=15000', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const voiture = await createSubaccount(token, cih.id, 'CIH-Voiture', 5000);

    expect(voiture.balance).toBe(5000);
    const refreshed = await getAccount(token, cih.id);
    expect(refreshed.balance).toBe(20000);
    expect(refreshed.nonAffecte).toBe(15000);
  });

  // ---------------------------------------------------------------
  // H — Versement interne non-affecté -> sous-compte
  // ---------------------------------------------------------------
  it('H — versement CIH->CIH-Voiture 2000 laisse CIH inchangé, Voiture+2000, non affecté-2000', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const voiture = await createSubaccount(token, cih.id, 'CIH-Voiture', 5000);

    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'SAVINGS_CONTRIBUTION',
        label: 'Versement interne',
        date: '2026-09-20',
        amount: '2000',
        sourceAccountId: cih.id,
        destinationAccountId: cih.id,
        destinationSubaccountId: voiture.id,
      })
      .expect(201);

    const refreshedAccount = await getAccount(token, cih.id);
    expect(refreshedAccount.balance).toBe(20000);
    expect(refreshedAccount.nonAffecte).toBe(13000);
    const refreshedSub = refreshedAccount.subaccounts.find((s: { id: string }) => s.id === voiture.id);
    expect(refreshedSub.balance).toBe(7000);
  });

  // ---------------------------------------------------------------
  // I — Versement cross-compte vers un sous-compte (atomique)
  // ---------------------------------------------------------------
  it('I — versement BP Lamiaa->CIH-Voiture 2000 : BP-2000, CIH+2000, Voiture+2000', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP Lamiaa', 25000);
    const cih = await createAccount(token, 'CIH', 20000);
    const voiture = await createSubaccount(token, cih.id, 'CIH-Voiture', 5000);

    const res = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'SAVINGS_CONTRIBUTION',
        label: 'Versement cross-compte',
        date: '2026-09-20',
        amount: '2000',
        sourceAccountId: bp.id,
        destinationAccountId: cih.id,
        destinationSubaccountId: voiture.id,
      })
      .expect(201);

    // Atomique : 3 écritures ledger pour cette seule opération (cf. exemple validé).
    const opDetail = await http.get(`/financial-operations/${res.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(opDetail.body.ledgerEntries).toHaveLength(3);

    expect((await getAccount(token, bp.id)).balance).toBe(23000);
    const refreshedCih = await getAccount(token, cih.id);
    expect(refreshedCih.balance).toBe(22000);
    expect(refreshedCih.subaccounts.find((s: { id: string }) => s.id === voiture.id).balance).toBe(7000);
  });

  // ---------------------------------------------------------------
  // C — Incohérence sous-compte / compte refusée
  // ---------------------------------------------------------------
  it("C — source_subaccount n'appartenant pas au source_account est refusé", async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP Lamiaa', 25000);
    const cih = await createAccount(token, 'CIH', 20000);
    const voiture = await createSubaccount(token, cih.id, 'CIH-Voiture', 5000);

    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'EXPENSE',
        label: 'Incohérent',
        date: '2026-09-20',
        amount: '100',
        sourceAccountId: bp.id,
        sourceSubaccountId: voiture.id, // appartient à CIH, pas à BP
      })
      .expect(400);
  });

  // ---------------------------------------------------------------
  // D — Non affecté ne peut jamais devenir négatif
  // ---------------------------------------------------------------
  it('D — allocation dépassant le non affecté disponible est refusée', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    await createSubaccount(token, cih.id, 'CIH-Voiture', 15000); // non affecté = 5000

    await http
      .post('/accounts/subaccounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId: cih.id, name: 'CIH-Voyage', initialAllocation: '10000' }) // dépasse les 5000 restants
      .expect(400);
  });

  // ---------------------------------------------------------------
  // B — Renversement (reversal) : solde restauré, net=0, historique conserve les deux
  // ---------------------------------------------------------------
  it('B — dépense 1000 + renversement : solde restauré, effective_amount net=0', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP Lamiaa', 25000);

    const expense = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Erreur de saisie', date: '2026-09-20', amount: '1000', sourceAccountId: bp.id })
      .expect(201);

    expect((await getAccount(token, bp.id)).balance).toBe(24000);

    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'EXPENSE',
        label: 'Erreur de saisie',
        date: '2026-09-21',
        amount: '1000',
        sourceAccountId: bp.id,
        reversalOfOperationId: expense.body.id,
        reversalReason: 'Erreur de saisie',
      })
      .expect(201);

    expect((await getAccount(token, bp.id)).balance).toBe(25000); // solde restauré

    // Historique utilisateur (lot correctif annulation) : ni l'originale ni son
    // renversement ne doivent y figurer — seule OPENING_BALANCE reste visible.
    // Les deux lignes techniques restent néanmoins en base (jamais supprimées) :
    // vérifié ci-dessous via leur accès direct par id, toujours 200.
    const ops = await http.get('/financial-operations').set('Authorization', `Bearer ${token}`).expect(200);
    expect(ops.body).toHaveLength(1);
    expect(ops.body[0].kind).toBe('OPENING_BALANCE');

    await http.get(`/financial-operations/${expense.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
  });

  // ---------------------------------------------------------------
  // A / J — Planning prévu 700, réel 820 : cellule affiche 820, prévu conservé en info annexe
  // ---------------------------------------------------------------
  it('A/J — réalisation à un montant différent : display=820, prévu=700 conservé', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const voiture = await createSubaccount(token, cih.id, 'CIH-Voiture', 5000);

    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'EXPENSE',
        label: 'Voiture',
        expectedDate: '2026-09-30',
        expectedAmount: '700',
        sourceAccountId: cih.id,
        sourceSubaccountId: voiture.id,
      })
      .expect(201);

    const realized = await http
      .post(`/planned-operations/${planned.body.id}/realize`)
      .set('Authorization', `Bearer ${token}`)
      .send({ actualAmount: '820' })
      .expect(201);

    expect(realized.body.amount).toBe(820);
    expect(realized.body.budgetImpact).toBe('ALREADY_FUNDED');

    const plannedList = await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200);
    const updated = plannedList.body.find((p: { id: string }) => p.id === planned.body.id);
    expect(updated.status).toBe('REALIZED');
    expect(updated.expectedAmount).toBe(700); // conservé comme info annexe, jamais écrasé
    expect(updated.realizedOperationId).toBe(realized.body.id);

    const refreshedCih = await getAccount(token, cih.id);
    expect(refreshedCih.subaccounts.find((s: { id: string }) => s.id === voiture.id).balance).toBe(4180); // 5000-820
  });

  // ---------------------------------------------------------------
  // E — Mutuelle : pas de revenu prévu tant qu'aucun remboursement, puis remboursement partiel
  // ---------------------------------------------------------------
  it('E — mutuelle engagée 700 sans remboursement puis remboursement partiel 500', async () => {
    const { token, householdId } = await freshHouseholdWithId();
    const cih = await createAccount(token, 'CIH', 20000);
    const sante = await createSubaccount(token, cih.id, 'CIH-Santé', 3000);
    const bp = await createAccount(token, 'BP Lamiaa', 25000);

    const consultation = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'EXPENSE',
        label: 'Consultation',
        date: '2026-09-15',
        amount: '700',
        sourceAccountId: cih.id,
        sourceSubaccountId: sante.id,
      })
      .expect(201);

    const claim = await withHouseholdContext(householdId, (tx) =>
      tx.medicalClaim.create({
        data: { householdId, sourceOperationId: consultation.body.id, subaccountId: sante.id, label: 'Consultation', amountEngaged: '700' },
      }),
    );

    // Tant qu'aucun remboursement n'est reçu : aucune ligne medical_reimbursement, solde inchangé.
    let reimbursed = await withHouseholdContext(householdId, (tx) => tx.medicalReimbursement.aggregate({ where: { claimId: claim.id }, _sum: { amount: true } }));
    expect(reimbursed._sum.amount).toBeNull();
    expect((await getAccount(token, bp.id)).balance).toBe(25000);

    // Remboursement partiel de 500 reçu sur BP Lamiaa.
    const reimbursementOp = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'MEDICAL_REIMBURSEMENT', label: 'Remboursement mutuelle', date: '2026-09-25', amount: '500', destinationAccountId: bp.id })
      .expect(201);
    expect(reimbursementOp.body.budgetImpact).toBe('EXCLUDED');

    await withHouseholdContext(householdId, (tx) =>
      tx.medicalReimbursement.create({ data: { claimId: claim.id, amount: '500', date: new Date('2026-09-25'), operationId: reimbursementOp.body.id } }),
    );

    expect((await getAccount(token, bp.id)).balance).toBe(25500); // compte +500
    reimbursed = await withHouseholdContext(householdId, (tx) => tx.medicalReimbursement.aggregate({ where: { claimId: claim.id }, _sum: { amount: true } }));
    expect(reimbursed._sum.amount?.toString()).toBe('500'); // remboursé=500
    const reste = Number(claim.amountEngaged) - Number(reimbursed._sum.amount);
    expect(reste).toBe(200); // reste=200
  });
});
