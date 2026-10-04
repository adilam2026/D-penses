import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Détail de transaction — "Modifier"/"Annuler" (§4 Finance Maison v1) : une
 * opération réalisée n'est JAMAIS supprimée physiquement. POST .../cancel crée
 * un renversement (reversalOfOperationId). POST .../correct renverse
 * l'originale ET crée une nouvelle opération corrigée liée par
 * correctionOfOperationId — historique intégralement traçable, jamais de
 * double-annulation possible.
 */
describe('Finance Maison — correction/annulation de transaction (cancel/correct)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let mailer: FakeMailer;
  let counter = 0;

  beforeAll(async () => {
    mailer = new FakeMailer();
    app = await createTestApp((builder) => builder.overrideProvider(MailerService).useValue(mailer));
    http = request.agent(app.getHttpServer());
    app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function freshHousehold(): Promise<string> {
    counter += 1;
    const email = `op-correction-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Test', `User${counter}`);
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    return res.body.accessToken as string;
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

  it('annule une DÉPENSE réalisée — solde restauré, statut visible, historique conserve les deux lignes', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP', 25000);

    const expense = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', date: '2026-09-20', amount: '1000', sourceAccountId: bp.id })
      .expect(201);
    expect((await getAccount(token, bp.id)).balance).toBe(24000);

    const reversal = await http.post(`/financial-operations/${expense.body.id}/cancel`).set('Authorization', `Bearer ${token}`).send({ reason: 'Doublon' }).expect(201);
    expect(reversal.body.reversalOfOperationId).toBe(expense.body.id);
    expect(reversal.body.reversalReason).toBe('Doublon');
    expect((await getAccount(token, bp.id)).balance).toBe(25000);

    // Conservées en base pour l'audit (jamais supprimées) : toujours accessibles par id.
    const detail = await http.get(`/financial-operations/${expense.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(detail.body.reversals).toHaveLength(1);
    expect(detail.body.reversals[0].id).toBe(reversal.body.id);
    await http.get(`/financial-operations/${reversal.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);

    // Historique utilisateur : ni l'originale ni le renversement n'y figurent.
    const history = await http.get(`/financial-operations?accountId=${bp.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(history.body.some((o: any) => o.id === expense.body.id)).toBe(false);
    expect(history.body.some((o: any) => o.id === reversal.body.id)).toBe(false);
  });

  it('annule un REVENU réalisé — solde restauré', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP', 10000);

    const income = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'INCOME', label: 'Salaire', date: '2026-09-01', amount: '5000', destinationAccountId: bp.id })
      .expect(201);
    expect((await getAccount(token, bp.id)).balance).toBe(15000);

    const reversal = await http.post(`/financial-operations/${income.body.id}/cancel`).set('Authorization', `Bearer ${token}`).send({}).expect(201);
    expect((await getAccount(token, bp.id)).balance).toBe(10000);

    const history = await http.get(`/financial-operations?accountId=${bp.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(history.body.some((o: any) => o.id === income.body.id)).toBe(false);
    expect(history.body.some((o: any) => o.id === reversal.body.id)).toBe(false);
  });

  it('annule un TRANSFERT réalisé — les deux comptes retrouvent leur solde initial', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP', 20000);
    const cih = await createAccount(token, 'CIH', 5000);

    const transfer = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'TRANSFER', label: 'Virement', date: '2026-09-10', amount: '3000', sourceAccountId: bp.id, destinationAccountId: cih.id })
      .expect(201);
    expect((await getAccount(token, bp.id)).balance).toBe(17000);
    expect((await getAccount(token, cih.id)).balance).toBe(8000);

    const reversal = await http.post(`/financial-operations/${transfer.body.id}/cancel`).set('Authorization', `Bearer ${token}`).send({}).expect(201);
    expect((await getAccount(token, bp.id)).balance).toBe(20000);
    expect((await getAccount(token, cih.id)).balance).toBe(5000);

    // Les deux côtés du transfert annulé sont masqués de l'historique des DEUX comptes.
    const bpHistory = await http.get(`/financial-operations?accountId=${bp.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(bpHistory.body.some((o: any) => o.id === transfer.body.id || o.id === reversal.body.id)).toBe(false);
    const cihHistory = await http.get(`/financial-operations?accountId=${cih.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(cihHistory.body.some((o: any) => o.id === transfer.body.id || o.id === reversal.body.id)).toBe(false);
  });

  it('annule un VERSEMENT d\'épargne réalisé — compte source et sous-compte restaurés', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const voiture = await createSubaccount(token, cih.id, 'CIH-Voiture', 0);

    const contribution = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'SAVINGS_CONTRIBUTION',
        label: 'Épargne voiture',
        date: '2026-09-12',
        amount: '2000',
        sourceAccountId: cih.id,
        destinationAccountId: cih.id,
        destinationSubaccountId: voiture.id,
      })
      .expect(201);
    expect((await getAccount(token, cih.id)).nonAffecte).toBe(18000);

    const reversal = await http.post(`/financial-operations/${contribution.body.id}/cancel`).set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const after = await getAccount(token, cih.id);
    expect(after.nonAffecte).toBe(20000);
    expect(after.subaccounts.find((s: { id: string }) => s.id === voiture.id).balance).toBe(0);

    const history = await http.get(`/financial-operations?accountId=${cih.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(history.body.some((o: any) => o.id === contribution.body.id || o.id === reversal.body.id)).toBe(false);
    const subHistory = await http.get(`/financial-operations?subaccountId=${voiture.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(subHistory.body.some((o: any) => o.id === contribution.body.id || o.id === reversal.body.id)).toBe(false);
  });

  it('double-annulation impossible — annuler deux fois la MÊME opération est refusé', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP', 10000);

    const expense = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', date: '2026-09-20', amount: '500', sourceAccountId: bp.id })
      .expect(201);
    await http.post(`/financial-operations/${expense.body.id}/cancel`).set('Authorization', `Bearer ${token}`).send({}).expect(201);
    expect((await getAccount(token, bp.id)).balance).toBe(10000); // solde restauré (10000 - 500 + 500)

    // Un second appel /cancel sur la MÊME opération doit être refusé — sinon le solde serait
    // faussé de +500 supplémentaires (double restauration = incohérence comptable).
    await http.post(`/financial-operations/${expense.body.id}/cancel`).set('Authorization', `Bearer ${token}`).send({}).expect(400);
    expect((await getAccount(token, bp.id)).balance).toBe(10000); // inchangé par la tentative refusée
  });

  it('double-annulation impossible — annuler un renversement est refusé (guard ledger.util préservé)', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP', 10000);

    const expense = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', date: '2026-09-20', amount: '500', sourceAccountId: bp.id })
      .expect(201);
    const reversal = await http.post(`/financial-operations/${expense.body.id}/cancel`).set('Authorization', `Bearer ${token}`).send({}).expect(201);

    // Tenter d'annuler le RENVERSEMENT lui-même doit échouer (jamais un double-cancel de la dépense).
    await http.post(`/financial-operations/${reversal.body.id}/cancel`).set('Authorization', `Bearer ${token}`).send({}).expect(400);

    expect((await getAccount(token, bp.id)).balance).toBe(10000); // solde inchangé par la tentative refusée
  });

  it('modifie une transaction (Modifier) — renverse l\'originale et crée une opération corrigée liée', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP', 25000);
    const categories = await http.get('/categories').set('Authorization', `Bearer ${token}`).expect(200);
    const categoryId = categories.body[0]?.id as string | undefined;

    const original = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', date: '2026-09-20', amount: '800', sourceAccountId: bp.id, categoryId })
      .expect(201);
    expect((await getAccount(token, bp.id)).balance).toBe(24200);

    const corrected = await http
      .post(`/financial-operations/${original.body.id}/correct`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Courses (montant corrigé)', date: '2026-09-20', amount: '650', categoryId, reason: 'Erreur de saisie' })
      .expect(201);

    expect(corrected.body.correctionOfOperationId).toBe(original.body.id);
    expect(corrected.body.label).toBe('Courses (montant corrigé)');
    expect(corrected.body.amount).toBe(650);

    // Solde final = 25000 - 650 (l'originale a été renversée puis remplacée par le montant corrigé).
    expect((await getAccount(token, bp.id)).balance).toBe(24350);

    const originalDetail = await http.get(`/financial-operations/${original.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(originalDetail.body.reversals).toHaveLength(1); // l'originale a bien été renversée
    expect(originalDetail.body.correctedByOperations).toHaveLength(1);
    expect(originalDetail.body.correctedByOperations[0].id).toBe(corrected.body.id);

    const correctedDetail = await http.get(`/financial-operations/${corrected.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(correctedDetail.body.correctionOfOperation.id).toBe(original.body.id);

    // Historique utilisateur (lot correctif annulation) : l'originale et son
    // renversement technique (créés par /correct) restent masqués — seules
    // OPENING_BALANCE et la version corrigée apparaissent. Les 4 lignes
    // existent toujours en base (jamais de suppression) : déjà vérifié
    // ci-dessus via l'accès direct par id (originalDetail/correctedDetail).
    const ops = await http.get('/financial-operations').set('Authorization', `Bearer ${token}`).expect(200);
    expect(ops.body).toHaveLength(2);
    expect(ops.body.some((o: any) => o.kind === 'OPENING_BALANCE')).toBe(true);
    expect(ops.body.some((o: any) => o.id === corrected.body.id)).toBe(true);
    expect(ops.body.some((o: any) => o.id === original.body.id)).toBe(false);
  });

  it('refuse de corriger une opération déjà corrigée (jamais deux corrections empilées sans le vouloir)', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP', 10000);

    const original = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', date: '2026-09-20', amount: '300', sourceAccountId: bp.id })
      .expect(201);
    await http
      .post(`/financial-operations/${original.body.id}/correct`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Courses corrigées', date: '2026-09-20', amount: '250' })
      .expect(201);

    await http
      .post(`/financial-operations/${original.body.id}/correct`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Courses re-corrigées', date: '2026-09-20', amount: '200' })
      .expect(400);
  });

  it('refuse d\'annuler une opération déjà annulée (jamais deux renversements pour la même opération)', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP', 10000);

    const expense = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', date: '2026-09-20', amount: '400', sourceAccountId: bp.id })
      .expect(201);
    await http.post(`/financial-operations/${expense.body.id}/cancel`).set('Authorization', `Bearer ${token}`).send({}).expect(201);

    // Tenter de corriger une opération déjà annulée doit aussi être refusé : sa reversal existe déjà,
    // la re-renverser violerait le même garde-fou que le double-cancel direct.
    await http
      .post(`/financial-operations/${expense.body.id}/correct`)
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Courses', date: '2026-09-20', amount: '400' })
      .expect(400);
  });

  it("annule une dépense NON planifiée (REAL_UNPLANNED) -> n'apparaît plus dans le Planning ni dans ses totaux", async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP', 25000);
    const todayIso = new Date().toISOString().slice(0, 10);

    const expense = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Aspirateur', date: todayIso, amount: '2500', sourceAccountId: bp.id })
      .expect(201);

    let planning = await http.get('/planning?months=3').set('Authorization', `Bearer ${token}`).expect(200);
    let depenseRow = planning.body.depenses.find((r: any) => r.label === 'Aspirateur');
    expect(depenseRow).toBeDefined();
    const month = planning.body.months[0];
    expect(depenseRow.cells[month].displayAmount).toBe(2500);
    const balanceBefore = planning.body.synthese[month].balanceMensuelle;

    await http.post(`/financial-operations/${expense.body.id}/cancel`).set('Authorization', `Bearer ${token}`).send({}).expect(201);

    planning = await http.get('/planning?months=3').set('Authorization', `Bearer ${token}`).expect(200);
    depenseRow = planning.body.depenses.find((r: any) => r.label === 'Aspirateur');
    expect(depenseRow).toBeUndefined(); // la ligne entière disparaît, plus aucune opération active à afficher
    expect(planning.body.synthese[month].balanceMensuelle).toBe(balanceBefore + 2500); // l'annulation ne doit plus peser dans le total
  });

  it('les opérations NON annulées continuent à apparaître normalement, y compris à côté d\'une opération annulée', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP', 25000);

    const kept = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', date: '2026-09-20', amount: '300', sourceAccountId: bp.id })
      .expect(201);
    const cancelled = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Aide Scolarité Adil', date: '2026-09-21', amount: '1400', sourceAccountId: bp.id })
      .expect(201);
    const reversal = await http.post(`/financial-operations/${cancelled.body.id}/cancel`).set('Authorization', `Bearer ${token}`).send({}).expect(201);

    const history = await http.get(`/financial-operations?accountId=${bp.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    const ids = history.body.map((o: any) => o.id);
    expect(ids).toContain(kept.body.id);
    expect(ids).not.toContain(cancelled.body.id);
    expect(ids).not.toContain(reversal.body.id);
  });
});
