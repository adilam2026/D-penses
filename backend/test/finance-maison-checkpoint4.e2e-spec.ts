import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Checkpoint 4 — Santé/Mutuelle complet, détail Plan financier, échéances,
 * objectifs simples, "À faire" (mobile). Tests obligatoires A-L (M est côté
 * mobile — AccueilScreen.test.tsx).
 */
describe('Finance Maison — Checkpoint 4 — Santé, Plans financiers, Objectifs', () => {
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
    const email = `checkpoint4-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Test', `User${counter}`);
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    return res.body.accessToken as string;
  }

  async function createAccount(token: string, name: string, openingBalance?: number) {
    const res = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name, openingBalance: openingBalance?.toString() }).expect(201);
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

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // A. dépense Santé remboursable → claim créé.
  it('A. une dépense santé marquée remboursable crée un dossier (claim)', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const sante = await createSubaccount(token, cih.id, 'CIH-Santé', 3000);

    const expense = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Consultation', date: todayIso(), amount: '700', sourceAccountId: cih.id, sourceSubaccountId: sante.id, createMedicalClaim: true })
      .expect(201);

    const claims = await http.get(`/medical-claims?subaccountId=${sante.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(claims.body).toHaveLength(1);
    expect(claims.body[0].sourceOperationId).toBe(expense.body.id);
    expect(claims.body[0].amountEngaged).toBe(700);
    expect(claims.body[0].status).toBe('PENDING');
  });

  // B. remboursement 500 sur engagé 700 → reste 200.
  it('B. un remboursement partiel de 500 sur un engagé de 700 laisse un reste de 200', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const sante = await createSubaccount(token, cih.id, 'CIH-Santé', 3000);
    const bp = await createAccount(token, 'BP Lamiaa', 25000);

    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Consultation', date: todayIso(), amount: '700', sourceAccountId: cih.id, sourceSubaccountId: sante.id, createMedicalClaim: true })
      .expect(201);
    const claimId = (await http.get(`/medical-claims?subaccountId=${sante.id}`).set('Authorization', `Bearer ${token}`).expect(200)).body[0].id;

    const afterPartial = await http
      .post(`/medical-claims/${claimId}/reimbursements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: '500', date: todayIso(), destinationAccountId: bp.id })
      .expect(201);

    expect(afterPartial.body.amountReimbursed).toBe(500);
    expect(afterPartial.body.reste).toBe(200);
    expect(afterPartial.body.status).toBe('PENDING');
  });

  // C. deux remboursements 300+200 → total 500, historique conservé.
  it('C. deux remboursements successifs (300 puis 200) donnent un total de 500 sans écraser le précédent', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const sante = await createSubaccount(token, cih.id, 'CIH-Santé', 3000);
    const bp = await createAccount(token, 'BP Lamiaa', 25000);

    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Consultation', date: todayIso(), amount: '700', sourceAccountId: cih.id, sourceSubaccountId: sante.id, createMedicalClaim: true })
      .expect(201);
    const claimId = (await http.get(`/medical-claims?subaccountId=${sante.id}`).set('Authorization', `Bearer ${token}`).expect(200)).body[0].id;

    await http.post(`/medical-claims/${claimId}/reimbursements`).set('Authorization', `Bearer ${token}`).send({ amount: '300', date: todayIso(), destinationAccountId: bp.id }).expect(201);
    const afterSecond = await http
      .post(`/medical-claims/${claimId}/reimbursements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: '200', date: todayIso(), destinationAccountId: bp.id })
      .expect(201);

    expect(afterSecond.body.amountReimbursed).toBe(500);
    expect(afterSecond.body.reimbursements).toHaveLength(2);
    expect(afterSecond.body.reimbursements.map((r: any) => r.amount).sort()).toEqual([200, 300]);
  });

  // D. clôture manuelle avec reste non nul.
  it('D. la clôture manuelle fonctionne même avec un reste non nul, sans modifier les montants', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const sante = await createSubaccount(token, cih.id, 'CIH-Santé', 3000);
    const bp = await createAccount(token, 'BP Lamiaa', 25000);

    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Consultation', date: todayIso(), amount: '700', sourceAccountId: cih.id, sourceSubaccountId: sante.id, createMedicalClaim: true })
      .expect(201);
    const claimId = (await http.get(`/medical-claims?subaccountId=${sante.id}`).set('Authorization', `Bearer ${token}`).expect(200)).body[0].id;
    await http.post(`/medical-claims/${claimId}/reimbursements`).set('Authorization', `Bearer ${token}`).send({ amount: '500', date: todayIso(), destinationAccountId: bp.id }).expect(201);

    const closed = await http.post(`/medical-claims/${claimId}/close`).set('Authorization', `Bearer ${token}`).expect(201);
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.amountEngaged).toBe(700);
    expect(closed.body.amountReimbursed).toBe(500);
    expect(closed.body.reste).toBe(200);
  });

  // E. remboursement attendu absent du revenu prévu.
  it("E. un remboursement mutuelle n'apparaît jamais comme un revenu prévu dans le Planning", async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const sante = await createSubaccount(token, cih.id, 'CIH-Santé', 3000);
    const bp = await createAccount(token, 'BP Lamiaa', 25000);

    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Consultation', date: todayIso(), amount: '700', sourceAccountId: cih.id, sourceSubaccountId: sante.id, createMedicalClaim: true })
      .expect(201);
    const claimId = (await http.get(`/medical-claims?subaccountId=${sante.id}`).set('Authorization', `Bearer ${token}`).expect(200)).body[0].id;
    await http.post(`/medical-claims/${claimId}/reimbursements`).set('Authorization', `Bearer ${token}`).send({ amount: '500', date: todayIso(), destinationAccountId: bp.id }).expect(201);

    const planning = await http.get('/planning?months=3').set('Authorization', `Bearer ${token}`).expect(200);
    expect(planning.body.revenus).toHaveLength(0);
    const plannedOps = await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200);
    expect(plannedOps.body.filter((p: any) => p.kind === 'INCOME')).toHaveLength(0);
  });

  // F. plan financier prochaine échéance correcte.
  it('F. le plan financier calcule correctement la prochaine échéance parmi plusieurs', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP Épargne-Scolarité', 45000);

    const near = new Date();
    near.setUTCMonth(near.getUTCMonth() + 1);
    const far = new Date();
    far.setUTCMonth(far.getUTCMonth() + 6);

    const plan = await http
      .post('/financial-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Scolarité',
        accountId: bp.id,
        deadlines: [
          { label: 'Juin', dueDate: far.toISOString().slice(0, 10) },
          { label: 'Janvier', dueDate: near.toISOString().slice(0, 10) },
        ],
      })
      .expect(201);

    const plans = await http.get('/financial-plans').set('Authorization', `Bearer ${token}`).expect(200);
    const scolarite = plans.body.find((p: any) => p.id === plan.body.id);
    expect(scolarite.nextDeadline.label).toBe('Janvier');
    expect(scolarite.disponibleActuel).toBe(45000);
  });

  // G. recommandation basée sur disponible réel.
  it('G. la recommandation mensuelle se base uniquement sur les versements réellement disponibles', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP Épargne-Scolarité', 0);

    const dueDate = new Date();
    dueDate.setUTCMonth(dueDate.getUTCMonth() + 3);

    const plan = await http
      .post('/financial-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Scolarité', accountId: bp.id, deadlines: [{ label: 'Janvier', dueDate: dueDate.toISOString().slice(0, 10) }] })
      .expect(201);
    const deadlineId = plan.body.deadlines[0].id;
    const item = await http.post(`/financial-plans/${plan.body.id}/items`).set('Authorization', `Bearer ${token}`).send({ label: 'Frais école' }).expect(201);
    await http.post(`/financial-plans/deadlines/${deadlineId}/items`).set('Authorization', `Bearer ${token}`).send({ itemId: item.body.id, amount: '30000' }).expect(201);

    const plans = await http.get('/financial-plans').set('Authorization', `Bearer ${token}`).expect(200);
    const scolarite = plans.body.find((p: any) => p.id === plan.body.id);
    expect(scolarite.deadlines[0].totalPrevu).toBe(30000);
    expect(scolarite.deadlines[0].disponible).toBe(0); // rien de réellement versé -> pas de recommandation basée sur du "juste prévu"
    expect(scolarite.deadlines[0].recommendedMonthly).toBe(10000); // 30000 / 3 mois
  });

  // H. versement réel → recommandation recalculée.
  it('H. un versement réel (marquer payée) recalcule immédiatement la recommandation', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP Épargne-Scolarité', 35000);

    const dueDate = new Date();
    dueDate.setUTCMonth(dueDate.getUTCMonth() + 3);

    const plan = await http
      .post('/financial-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Scolarité', accountId: bp.id, deadlines: [{ label: 'Janvier', dueDate: dueDate.toISOString().slice(0, 10) }] })
      .expect(201);
    const deadlineId = plan.body.deadlines[0].id;
    const item = await http.post(`/financial-plans/${plan.body.id}/items`).set('Authorization', `Bearer ${token}`).send({ label: 'Frais école' }).expect(201);
    await http.post(`/financial-plans/deadlines/${deadlineId}/items`).set('Authorization', `Bearer ${token}`).send({ itemId: item.body.id, amount: '30000' }).expect(201);

    await http.post(`/financial-plans/deadlines/${deadlineId}/mark-paid`).set('Authorization', `Bearer ${token}`).expect(201);

    const plans = await http.get('/financial-plans').set('Authorization', `Bearer ${token}`).expect(200);
    const scolarite = plans.body.find((p: any) => p.id === plan.body.id);
    expect(scolarite.deadlines[0].disponible).toBe(30000);
    expect(scolarite.deadlines[0].reste).toBe(0);
    expect(scolarite.deadlines[0].recommendedMonthly).toBe(0);
    expect(scolarite.deadlines[0].paid).toBe(true);
  });

  // I. objectif sur compte réel.
  it('I. un objectif peut être créé sur un compte bancaire réel, progression dérivée du solde', async () => {
    const token = await freshHousehold();
    const account = await createAccount(token, 'Épargne Enfants', 42000);

    const goal = await http
      .post('/goals')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId: account.id, targetAmount: '100000', targetDate: '2027-12-31', label: 'Épargne Enfants' })
      .expect(201);
    expect(goal.body.accountId).toBe(account.id);

    const goals = await http.get('/goals').set('Authorization', `Bearer ${token}`).expect(200);
    const created = goals.body.find((g: any) => g.id === goal.body.id);
    expect(created.current).toBe(42000);
    expect(created.targetAmount).toBe(100000);
    expect(created.percent).toBe(42);
  });

  // J. objectif sur sous-compte.
  it('J. un objectif peut être créé sur un sous-compte, progression dérivée du solde du sous-compte', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const voiture = await createSubaccount(token, cih.id, 'CIH-Voiture', 7500);

    const goal = await http.post('/goals').set('Authorization', `Bearer ${token}`).send({ subaccountId: voiture.id, targetAmount: '15000' }).expect(201);
    expect(goal.body.subaccountId).toBe(voiture.id);

    const goals = await http.get('/goals').set('Authorization', `Bearer ${token}`).expect(200);
    const created = goals.body.find((g: any) => g.id === goal.body.id);
    expect(created.current).toBe(7500);
    expect(created.percent).toBe(50);
  });

  // K. historique compte correct.
  it('K. l\'historique du compte réel ne montre que les opérations qui le concernent', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP Lamiaa', 25000);
    const cih = await createAccount(token, 'CIH', 20000);

    await http.post('/financial-operations').set('Authorization', `Bearer ${token}`).send({ kind: 'EXPENSE', label: 'Courses', date: todayIso(), amount: '200', sourceAccountId: bp.id }).expect(201);
    await http.post('/financial-operations').set('Authorization', `Bearer ${token}`).send({ kind: 'EXPENSE', label: 'Essence', date: todayIso(), amount: '300', sourceAccountId: cih.id }).expect(201);

    const bpHistory = await http.get(`/financial-operations?accountId=${bp.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(bpHistory.body.every((op: any) => op.label !== 'Essence')).toBe(true);
    expect(bpHistory.body.some((op: any) => op.label === 'Courses')).toBe(true);
  });

  // L. historique sous-compte correct.
  it("L. l'historique du sous-compte ne montre que les opérations qui l'affectent", async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const voiture = await createSubaccount(token, cih.id, 'CIH-Voiture', 5000);

    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Réparation', date: todayIso(), amount: '300', sourceAccountId: cih.id, sourceSubaccountId: voiture.id })
      .expect(201);
    await http.post('/financial-operations').set('Authorization', `Bearer ${token}`).send({ kind: 'EXPENSE', label: 'Autre dépense', date: todayIso(), amount: '150', sourceAccountId: cih.id }).expect(201);

    const history = await http.get(`/financial-operations?subaccountId=${voiture.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(history.body.every((op: any) => op.label !== 'Autre dépense')).toBe(true);
    expect(history.body.some((op: any) => op.label === 'Réparation')).toBe(true);
  });
});
