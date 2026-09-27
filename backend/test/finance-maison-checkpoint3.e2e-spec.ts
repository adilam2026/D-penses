import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Checkpoint 3 — Planning multi-mois + automates de récurrence + plans
 * financiers (prochaine échéance/recommandation). Tests obligatoires A-M
 * (spécification verbatim) — chacun ci-dessous porte son lettrage en commentaire.
 */
describe('Finance Maison — Checkpoint 3 — Planning + automates', () => {
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
    const email = `checkpoint3-${counter}-${Date.now()}@test.local`;
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

  async function createCategory(token: string, name: string) {
    const res = await http.post('/categories').set('Authorization', `Bearer ${token}`).send({ name }).expect(201);
    return res.body;
  }

  async function getPlanning(token: string, months = 6) {
    const res = await http.get(`/planning?months=${months}`).set('Authorization', `Bearer ${token}`).expect(200);
    return res.body;
  }

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function findCell(planning: any, block: 'depenses' | 'revenus' | 'epargne', rowKey: string, monthIndex = 0) {
    const row = planning[block].find((r: any) => r.key === rowKey);
    if (!row) return undefined;
    const month = planning.months[monthIndex];
    return row.cells[month];
  }

  it('A. une règle mensuelle génère les occurrences futures correctes (12 mois glissants)', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const internet = await createCategory(token, 'Internet/Télécom');

    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), label: 'Internet', kind: 'EXPENSE', expectedAmount: '350', categoryId: internet.id, sourceAccountId: cih.id })
      .expect(201);

    await getPlanning(token, 6); // déclenche ensurePlannedOccurrences

    const list = await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200);
    const occurrences = list.body.filter((p: any) => p.recurrenceRuleId === rule.body.id);
    expect(occurrences).toHaveLength(12); // horizon glissant §21

    const amounts = occurrences.map((o: any) => o.expectedAmount);
    expect(amounts.every((a: number) => a === 350)).toBe(true);
  });

  it('B. relancer la génération ne crée jamais de doublons (idempotence §20)', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);

    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), label: 'Loyer', kind: 'EXPENSE', expectedAmount: '3000', sourceAccountId: cih.id })
      .expect(201);

    await getPlanning(token, 12);
    const firstCount = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body.filter(
      (p: any) => p.recurrenceRuleId === rule.body.id,
    ).length;

    await getPlanning(token, 12);
    await getPlanning(token, 12);
    const secondCount = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body.filter(
      (p: any) => p.recurrenceRuleId === rule.body.id,
    ).length;

    expect(secondCount).toBe(firstCount);
  });

  it("C. modifier UNE occurrence ne change jamais les autres (§modification d'une occurrence)", async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);

    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), label: 'Internet', kind: 'EXPENSE', expectedAmount: '350', sourceAccountId: cih.id })
      .expect(201);
    await getPlanning(token, 6);

    const list = await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200);
    const occurrences = list.body.filter((p: any) => p.recurrenceRuleId === rule.body.id).sort((a: any, b: any) => a.expectedDate.localeCompare(b.expectedDate));
    const target = occurrences[1]; // le mois suivant

    await http.patch(`/planned-operations/${target.id}`).set('Authorization', `Bearer ${token}`).send({ expectedAmount: '420' }).expect(200);

    const after = await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200);
    const afterOccurrences = after.body.filter((p: any) => p.recurrenceRuleId === rule.body.id);
    const changed = afterOccurrences.find((o: any) => o.id === target.id);
    const untouched = afterOccurrences.filter((o: any) => o.id !== target.id);

    expect(changed.expectedAmount).toBe(420);
    expect(untouched.every((o: any) => o.expectedAmount === 350)).toBe(true);
  });

  it('D. prévu 700 -> réel 820 : la case affiche 820 (réalisation avec montant ajusté)', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const voiture = await createCategory(token, 'Voiture');

    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Assurance voiture', expectedDate: todayIso(), expectedAmount: '700', categoryId: voiture.id, sourceAccountId: cih.id })
      .expect(201);

    let planning = await getPlanning(token, 3);
    let cell = findCell(planning, 'depenses', voiture.id, 0);
    expect(cell.status).toBe('PENDING');
    expect(cell.singleOccurrence.plannedOperationId).toBe(planned.body.id);
    expect(cell.displayAmount).toBe(700);

    await http.post(`/planned-operations/${planned.body.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '820' }).expect(201);

    planning = await getPlanning(token, 3);
    cell = findCell(planning, 'depenses', voiture.id, 0);
    expect(cell.status).toBe('REALIZED');
    expect(cell.displayAmount).toBe(820);
    expect(cell.singleOccurrence.realizedAmount).toBe(820);
  });

  it('E. une dépense non prévue augmente la ligne de sa catégorie ("Autres" obligatoire)', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP Lamiaa', 25000);

    const categories = await http.get('/categories').set('Authorization', `Bearer ${token}`).expect(200);
    const autres = categories.body.find((c: any) => c.isDefaultFallback);
    expect(autres).toBeTruthy();

    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Aspirateur', date: todayIso(), amount: '2500', sourceAccountId: bp.id })
      .expect(201);

    const planning = await getPlanning(token, 3);
    const cell = findCell(planning, 'depenses', autres.id, 0);
    expect(cell.status).toBe('REALIZED');
    expect(cell.displayAmount).toBe(2500);
    expect(cell.items[0].label).toBe('Aspirateur');
  });

  it('F. annuler un paiement réalisé -> la case redevient prévue (jamais de suppression de la transaction d\'origine)', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const voiture = await createCategory(token, 'Voiture');

    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Assurance voiture', expectedDate: todayIso(), expectedAmount: '700', categoryId: voiture.id, sourceAccountId: cih.id })
      .expect(201);

    const realized = await http.post(`/planned-operations/${planned.body.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '820' }).expect(201);

    await http.post(`/planned-operations/${planned.body.id}/unrealize`).set('Authorization', `Bearer ${token}`).expect(201);

    const planning = await getPlanning(token, 3);
    const cell = findCell(planning, 'depenses', voiture.id, 0);
    expect(cell.status).toBe('PENDING');
    expect(cell.displayAmount).toBe(700);
    expect(cell.singleOccurrence.plannedOperationId).toBe(planned.body.id);

    // La transaction d'origine n'a JAMAIS été supprimée — seule une contre-écriture a été créée.
    const original = await http.get(`/financial-operations/${realized.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(original.body.id).toBe(realized.body.id);
  });

  it('G. un versement prévu se réalise correctement (bloc Épargne)', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP Lamiaa', 25000);
    const cih = await createAccount(token, 'CIH', 20000);
    const pocheVoiture = await createSubaccount(token, cih.id, 'CIH-Voiture');

    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'SAVINGS_CONTRIBUTION',
        label: 'Versement Voiture',
        expectedDate: todayIso(),
        expectedAmount: '500',
        sourceAccountId: bp.id,
        destinationAccountId: cih.id,
        destinationSubaccountId: pocheVoiture.id,
      })
      .expect(201);

    await http.post(`/planned-operations/${planned.body.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '500' }).expect(201);

    const planning = await getPlanning(token, 3);
    const cell = findCell(planning, 'epargne', pocheVoiture.id, 0);
    expect(cell.status).toBe('REALIZED');
    expect(cell.displayAmount).toBe(500);
  });

  it('H. dépense financée depuis un sous-compte : visible (DISPLAY) mais jamais re-déduite en Balance (BUDGET)', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const pocheVoiture = await createSubaccount(token, cih.id, 'CIH-Voiture', 1000);
    const voiture = await createCategory(token, 'Voiture');

    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Vidange', date: todayIso(), amount: '400', sourceAccountId: cih.id, sourceSubaccountId: pocheVoiture.id, categoryId: voiture.id })
      .expect(201);

    const planning = await getPlanning(token, 3);
    const cell = findCell(planning, 'depenses', voiture.id, 0);
    expect(cell.displayAmount).toBe(400); // visible
    expect(cell.budgetAmount).toBe(0); // déjà financé -> jamais recompté dans le budget

    const synthese = planning.synthese[planning.months[0]];
    expect(synthese.totalDepenses).toBe(0); // aucune double-déduction dans Balance
  });

  it('I. balance mensuelle correcte (revenus - dépenses - épargne, sur les montants BUDGET)', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP Lamiaa', 25000);
    const cih = await createAccount(token, 'CIH', 20000);

    await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'INCOME', label: 'Salaire Adil', expectedDate: todayIso(), expectedAmount: '12000', destinationAccountId: bp.id })
      .expect(201);
    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', date: todayIso(), amount: '2000', sourceAccountId: bp.id })
      .expect(201);
    await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'SAVINGS_CONTRIBUTION', label: 'Épargne', expectedDate: todayIso(), expectedAmount: '1000', sourceAccountId: bp.id, destinationAccountId: cih.id })
      .expect(201);

    const planning = await getPlanning(token, 3);
    const synthese = planning.synthese[planning.months[0]];
    expect(synthese.totalRevenus).toBe(12000);
    expect(synthese.totalDepenses).toBe(2000);
    expect(synthese.totalEpargne).toBe(1000);
    expect(synthese.balanceMensuelle).toBe(12000 - 2000 - 1000);
  });

  it('J. balance cumulée = somme progressive des balances mensuelles', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP Lamiaa', 25000);

    const planning = await getPlanning(token, 3);
    const [m0, m1] = planning.months;

    await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'INCOME', label: 'Salaire', expectedDate: todayIso(), expectedAmount: '1000', destinationAccountId: bp.id })
      .expect(201);

    const nextMonthDate = new Date();
    nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
    await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'INCOME', label: 'Salaire', expectedDate: nextMonthDate.toISOString().slice(0, 10), expectedAmount: '2000', destinationAccountId: bp.id })
      .expect(201);

    const after = await getPlanning(token, 3);
    expect(after.synthese[m0].balanceCumulee).toBe(1000);
    expect(after.synthese[m1].balanceCumulee).toBe(1000 + 2000);
  });

  it('K. Plan Scolarité — les postes/échéances sont groupés correctement et jamais dupliqués dans les catégories', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP Lamiaa', 25000);

    const dueDate = new Date();
    dueDate.setUTCMonth(dueDate.getUTCMonth() + 2);

    const plan = await http
      .post('/financial-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: 'Scolarité',
        items: [{ label: 'Frais école' }, { label: 'Fournitures' }],
        deadlines: [{ label: 'Janvier', dueDate: dueDate.toISOString().slice(0, 10) }],
      })
      .expect(201);

    const deadlineId = plan.body.deadlines[0].id;
    const itemId = plan.body.items[0].id;

    await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'EXPENSE',
        label: 'Frais école',
        expectedDate: todayIso(),
        expectedAmount: '15000',
        sourceAccountId: bp.id,
        financialPlanDeadlineId: deadlineId,
        financialPlanItemId: itemId,
      })
      .expect(201);

    const plans = await http.get('/financial-plans').set('Authorization', `Bearer ${token}`).expect(200);
    const scolarite = plans.body.find((p: any) => p.id === plan.body.id);
    expect(scolarite.deadlines[0].totalPrevu).toBe(15000);

    // Jamais dupliqué dans les lignes catégorie classiques du Planning.
    const planning = await getPlanning(token, 3);
    const totalDepensesRows = planning.depenses.reduce((sum: number, row: any) => sum + (row.cells[planning.months[0]]?.displayAmount ?? 0), 0);
    expect(totalDepensesRows).toBe(0);
  });

  it('L. prochaine échéance : la plus proche à venir est correctement sélectionnée', async () => {
    const token = await freshHousehold();

    const near = new Date();
    near.setUTCMonth(near.getUTCMonth() + 1);
    const far = new Date();
    far.setUTCMonth(far.getUTCMonth() + 6);

    const plan = await http
      .post('/financial-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Voyage', deadlines: [{ label: 'Été', dueDate: far.toISOString().slice(0, 10) }, { label: 'Acompte', dueDate: near.toISOString().slice(0, 10) }] })
      .expect(201);

    const plans = await http.get('/financial-plans').set('Authorization', `Bearer ${token}`).expect(200);
    const voyage = plans.body.find((p: any) => p.id === plan.body.id);
    expect(voyage.nextDeadline.label).toBe('Acompte');
  });

  it('M. recommandation recalculée à partir du disponible réellement réalisé', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP Lamiaa', 25000);

    const dueDate = new Date();
    dueDate.setUTCMonth(dueDate.getUTCMonth() + 3);

    const plan = await http
      .post('/financial-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Scolarité', deadlines: [{ label: 'Janvier', dueDate: dueDate.toISOString().slice(0, 10) }] })
      .expect(201);
    const deadlineId = plan.body.deadlines[0].id;

    const contribution = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Frais école', expectedDate: todayIso(), expectedAmount: '30000', sourceAccountId: bp.id, financialPlanDeadlineId: deadlineId })
      .expect(201);

    let plans = await http.get('/financial-plans').set('Authorization', `Bearer ${token}`).expect(200);
    let scolarite = plans.body.find((p: any) => p.id === plan.body.id);
    expect(scolarite.deadlines[0].totalPrevu).toBe(30000);
    expect(scolarite.deadlines[0].disponible).toBe(0); // rien de réalisé -> aucune recommandation basée sur du "juste prévu"
    expect(scolarite.deadlines[0].reste).toBe(30000);

    // Réalisation d'un montant réel différent (12000 au lieu de 30000 prévu) -> recalcul automatique.
    await http.post(`/planned-operations/${contribution.body.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '12000' }).expect(201);

    plans = await http.get('/financial-plans').set('Authorization', `Bearer ${token}`).expect(200);
    scolarite = plans.body.find((p: any) => p.id === plan.body.id);
    expect(scolarite.deadlines[0].disponible).toBe(12000);
    expect(scolarite.deadlines[0].reste).toBe(18000);
    expect(scolarite.deadlines[0].monthsRemaining).toBe(3);
    expect(scolarite.deadlines[0].recommendedMonthly).toBe(6000);
  });
});
