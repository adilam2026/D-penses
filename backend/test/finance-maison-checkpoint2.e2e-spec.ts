import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Checkpoint 2 (Détail compte/sous-compte, Santé, Ajouter) — nouveaux
 * endpoints ajoutés à Phase 1, sans toucher au moteur ledger déjà validé.
 */
describe('Finance Maison — Checkpoint 2 — nouveaux endpoints', () => {
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
    const email = `checkpoint2-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Test', `User${counter}`);
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    return res.body.accessToken as string; // le token ré-émis porte le householdId (cf. HouseholdRequiredGuard)
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

  it('renomme un compte puis un sous-compte (Modifier — §8/§9)', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const voiture = await createSubaccount(token, cih.id, 'CIH-Voiture', 5000);

    const renamedAccount = await http.patch(`/accounts/${cih.id}`).set('Authorization', `Bearer ${token}`).send({ name: 'CIH Bank' }).expect(200);
    expect(renamedAccount.body.name).toBe('CIH Bank');
    expect(renamedAccount.body.balance).toBe(20000); // renommer ne touche jamais au solde

    const renamedSub = await http
      .patch(`/accounts/subaccounts/${voiture.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'CIH-Auto' })
      .expect(200);
    expect(renamedSub.body.name).toBe('CIH-Auto');
    expect(renamedSub.body.balance).toBe(5000);
  });

  it('historique filtré par accountId puis par subaccountId (Détail compte/sous-compte — §8/§9)', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP Lamiaa', 25000);
    const cih = await createAccount(token, 'CIH', 20000);
    const voiture = await createSubaccount(token, cih.id, 'CIH-Voiture', 5000);

    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', date: '2026-09-05', amount: '200', sourceAccountId: bp.id })
      .expect(201);
    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Réparation', date: '2026-09-06', amount: '300', sourceAccountId: cih.id, sourceSubaccountId: voiture.id })
      .expect(201);

    const cihHistory = await http.get(`/financial-operations?accountId=${cih.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    // OPENING_BALANCE(compte) + OPENING_BALANCE(sous-compte) + Réparation = 3, jamais la dépense BP.
    expect(cihHistory.body).toHaveLength(3);
    expect(cihHistory.body.every((op: { label: string }) => op.label !== 'Courses')).toBe(true);

    const voitureHistory = await http.get(`/financial-operations?subaccountId=${voiture.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(voitureHistory.body).toHaveLength(2); // OPENING_BALANCE + Réparation
  });

  it("crée une dépense Santé remboursable -> dossier créé automatiquement, puis remboursement partiel puis total (§10)", async () => {
    const token = await freshHousehold();
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
        createMedicalClaim: true,
      })
      .expect(201);

    let claims = await http.get(`/medical-claims?subaccountId=${sante.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(claims.body).toHaveLength(1);
    expect(claims.body[0].sourceOperationId).toBe(consultation.body.id);
    expect(claims.body[0].amountEngaged).toBe(700);
    expect(claims.body[0].reste).toBe(700);
    expect(claims.body[0].status).toBe('PENDING');

    const claimId = claims.body[0].id;

    // Remboursement partiel 500 -> reste 200, toujours PENDING.
    const afterPartial = await http
      .post(`/medical-claims/${claimId}/reimbursements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: '500', date: '2026-09-20', destinationAccountId: bp.id })
      .expect(201);
    expect(afterPartial.body.amountReimbursed).toBe(500);
    expect(afterPartial.body.reste).toBe(200);
    expect(afterPartial.body.status).toBe('PENDING');
    expect((await http.get(`/accounts/${bp.id}`).set('Authorization', `Bearer ${token}`).expect(200)).body.balance).toBe(25500);

    // Remboursement complémentaire 200 -> reste 0, dossier CLOSED.
    const afterFull = await http
      .post(`/medical-claims/${claimId}/reimbursements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: '200', date: '2026-09-22', destinationAccountId: bp.id })
      .expect(201);
    expect(afterFull.body.reste).toBe(0);
    expect(afterFull.body.status).toBe('CLOSED');
  });

  it('règle de récurrence : création puis liaison à une échéance prévue (Ajouter > Récurrente — §11)', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);

    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: '2026-10-01', label: 'Loyer' })
      .expect(201);
    expect(rule.body.frequency).toBe('MONTHLY');

    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'EXPENSE',
        label: 'Loyer',
        expectedDate: '2026-10-01',
        expectedAmount: '3000',
        sourceAccountId: cih.id,
        recurrenceRuleId: rule.body.id,
      })
      .expect(201);
    expect(planned.body.recurrenceRuleId).toBe(rule.body.id);

    const list = await http.get('/recurrence-rules').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body).toHaveLength(1);
  });
});
