import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Recette v1 (avant APK) — parcours métier ciblés sur les derniers lots
 * (source au paiement + modification/annulation d'échéance). Chaque test
 * vérifie l'ÉTAT RÉEL après chaque opération (soldes, Planning, historique),
 * pas seulement le code HTTP de la requête.
 *
 * A — échéance ponctuelle : cycle complet avec vérification Planning à
 *     chaque étape (création, affichage, montant, date, source, partiel,
 *     total, annulation).
 * D — annulation/historique : écritures techniques conservées en base,
 *     exclues de l'historique utilisateur, soldes corrects.
 */
describe('Finance Maison — Recette v1 (avant APK)', () => {
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
    const email = `recette-v1-${counter}-${Date.now()}@test.local`;
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

  async function createCategory(token: string, name: string) {
    const res = await http.post('/categories').set('Authorization', `Bearer ${token}`).send({ name }).expect(201);
    return res.body;
  }

  async function getAccount(token: string, id: string) {
    const res = await http.get(`/accounts/${id}`).set('Authorization', `Bearer ${token}`).expect(200);
    return res.body;
  }

  async function getPlanning(token: string, months = 3) {
    const res = await http.get(`/planning?months=${months}`).set('Authorization', `Bearer ${token}`).expect(200);
    return res.body;
  }

  function findCell(planning: any, block: 'depenses' | 'revenus' | 'epargne', categoryId: string, monthIndex = 0) {
    const row = planning[block].find((r: any) => r.categoryId === categoryId);
    if (!row) return undefined;
    return row.cells[planning.months[monthIndex]];
  }

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }
  function isoPlusDays(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // ===================================================================
  // A — Échéance PONCTUELLE : cycle complet, Planning vérifié à chaque étape
  // ===================================================================
  it('A. échéance ponctuelle : création -> affichage -> montant -> date -> source -> paiement partiel -> paiement total', async () => {
    const token = await freshHousehold();
    const lamiaa = await createAccount(token, 'Compte Lamiaa', 20000);
    const courses = await createSubaccount(token, lamiaa.id, 'Courses', 5000);
    const maison = await createCategory(token, 'Maison');

    // 1. Création.
    const created = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Internet', expectedDate: isoPlusDays(5), expectedAmount: '350', categoryId: maison.id, sourceAccountId: lamiaa.id })
      .expect(201);
    expect(created.body.status).toBe('PENDING');

    // 2. Affichage dans Planning : case PENDING, montant 350, singleOccurrence pointe bien dessus.
    let planning = await getPlanning(token, 3);
    let cell = findCell(planning, 'depenses', maison.id);
    expect(cell.status).toBe('PENDING');
    expect(cell.displayAmount).toBe(350);
    expect(cell.singleOccurrence.plannedOperationId).toBe(created.body.id);
    expect(cell.singleOccurrence.sourceAccountId).toBe(lamiaa.id);
    expect(cell.singleOccurrence.sourceSubaccountId).toBeNull();

    // 3. Modifier le MONTANT prévu (350 -> 400) — Planning doit refléter 400.
    await http.patch(`/planned-operations/${created.body.id}`).set('Authorization', `Bearer ${token}`).send({ expectedAmount: '400' }).expect(200);
    planning = await getPlanning(token, 3);
    cell = findCell(planning, 'depenses', maison.id);
    expect(cell.displayAmount).toBe(400);

    // 4. Modifier la DATE prévue (même mois) — Planning reste cohérent, même ligne/id.
    const movedDate = isoPlusDays(10);
    const afterDate = await http.patch(`/planned-operations/${created.body.id}`).set('Authorization', `Bearer ${token}`).send({ expectedDate: movedDate }).expect(200);
    expect(afterDate.body.id).toBe(created.body.id); // ponctuelle : jamais recréée
    expect(afterDate.body.expectedDate.slice(0, 10)).toBe(movedDate);

    // 5. Modifier la SOURCE prévue (compte principal -> enveloppe Courses).
    await http
      .patch(`/planned-operations/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceAccountId: lamiaa.id, sourceSubaccountId: courses.id })
      .expect(200);
    planning = await getPlanning(token, 3);
    cell = findCell(planning, 'depenses', maison.id);
    expect(cell.singleOccurrence.sourceSubaccountId).toBe(courses.id);

    // 6. Paiement PARTIEL (150 sur 400) depuis l'enveloppe Courses — reste 250, Planning MIXTE.
    await http.post(`/planned-operations/${created.body.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '150' }).expect(201);
    let afterPartial = await getAccount(token, lamiaa.id);
    expect(afterPartial.balance).toBe(19850); // 20000 - 150
    expect(afterPartial.subaccounts.find((s: any) => s.id === courses.id).balance).toBe(4850); // 5000 - 150
    expect(afterPartial.nonAffecte).toBe(15000); // jamais touché (paiement financé via enveloppe)

    planning = await getPlanning(token, 3);
    cell = findCell(planning, 'depenses', maison.id);
    expect(cell.status).toBe('MIXED');
    expect(cell.realizedAmount).toBe(150);
    expect(cell.pendingAmount).toBe(250);

    const plannedList = await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200);
    const stillPending = plannedList.body.find((p: any) => p.id === created.body.id);
    expect(stillPending.status).toBe('PENDING');
    expect(stillPending.expectedAmount).toBe(250);

    // 7. Paiement TOTAL du reste (250), toujours depuis Courses -> échéance REALIZED.
    await http.post(`/planned-operations/${created.body.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '250' }).expect(201);
    const afterFull = await getAccount(token, lamiaa.id);
    expect(afterFull.balance).toBe(19600); // 20000 - 150 - 250
    expect(afterFull.subaccounts.find((s: any) => s.id === courses.id).balance).toBe(4600); // 5000 - 150 - 250

    planning = await getPlanning(token, 3);
    cell = findCell(planning, 'depenses', maison.id);
    expect(cell.status).toBe('REALIZED');
    expect(cell.displayAmount).toBe(400); // 150 + 250, jamais 800 ni un double-compte

    const finalList = await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200);
    expect(finalList.body.find((p: any) => p.id === created.body.id).status).toBe('REALIZED');
  });

  it("A (suite). annulation d'une échéance ponctuelle encore prévue : disparaît du Planning, aucun mouvement de solde", async () => {
    const token = await freshHousehold();
    const lamiaa = await createAccount(token, 'Compte Lamiaa', 20000);
    const maison = await createCategory(token, 'Maison');

    const created = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Facture ponctuelle', expectedDate: isoPlusDays(3), expectedAmount: '500', categoryId: maison.id, sourceAccountId: lamiaa.id })
      .expect(201);

    let planning = await getPlanning(token, 3);
    expect(findCell(planning, 'depenses', maison.id).status).toBe('PENDING');

    await http.post(`/planned-operations/${created.body.id}/cancel`).set('Authorization', `Bearer ${token}`).expect(201);

    planning = await getPlanning(token, 3);
    const cell = findCell(planning, 'depenses', maison.id);
    expect(cell ? cell.status : 'EMPTY').toBe('EMPTY'); // retirée du Planning

    expect((await getAccount(token, lamiaa.id)).balance).toBe(20000); // jamais réalisée -> aucun mouvement

    const list = await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.find((p: any) => p.id === created.body.id).status).toBe('CANCELLED');
  });

  // ===================================================================
  // D — Annulation / historique d'une opération RÉALISÉE
  // ===================================================================
  it('D. annulation d\'une opération réalisée : écritures techniques conservées, historique utilisateur propre, soldes corrects', async () => {
    const token = await freshHousehold();
    const bp = await createAccount(token, 'BP Lamiaa', 25000);

    const expense = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', date: todayIso(), amount: '1200', sourceAccountId: bp.id })
      .expect(201);
    expect((await getAccount(token, bp.id)).balance).toBe(23800);

    const reversal = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', date: todayIso(), amount: '1200', sourceAccountId: bp.id, reversalOfOperationId: expense.body.id, reversalReason: 'Erreur de saisie' })
      .expect(201);

    // Solde restauré exactement.
    expect((await getAccount(token, bp.id)).balance).toBe(25000);

    // Historique utilisateur standard : ni l'originale ni la contre-écriture
    // n'y figurent (seule OPENING_BALANCE reste visible).
    const history = await http.get('/financial-operations').set('Authorization', `Bearer ${token}`).expect(200);
    expect(history.body.find((o: any) => o.id === expense.body.id)).toBeUndefined();
    expect(history.body.find((o: any) => o.id === reversal.body.id)).toBeUndefined();
    expect(history.body.every((o: any) => o.kind === 'OPENING_BALANCE')).toBe(true);

    // Les deux écritures techniques restent bien en base, accessibles par id
    // (audit) — jamais supprimées.
    const expenseDirect = await http.get(`/financial-operations/${expense.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(expenseDirect.body.amount).toBe(1200);
    const reversalDirect = await http.get(`/financial-operations/${reversal.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(reversalDirect.body.reversalOfOperationId).toBe(expense.body.id);
    expect(reversalDirect.body.reversalReason).toBe('Erreur de saisie');

    // N'apparaît pas non plus dans le Planning (dépense réelle non planifiée annulée).
    const planning = await getPlanning(token, 3);
    const totalDepenses = planning.synthese[planning.months[0]].totalDepenses;
    expect(totalDepenses).toBe(0);
  });

  it("D (suite). annulation du PAIEMENT d'une échéance (unrealize) : remise à PENDING, solde restauré, invisible dans l'historique", async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const maison = await createCategory(token, 'Maison');

    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Assurance', expectedDate: todayIso(), expectedAmount: '900', categoryId: maison.id, sourceAccountId: cih.id })
      .expect(201);
    await http.post(`/planned-operations/${planned.body.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '900' }).expect(201);
    expect((await getAccount(token, cih.id)).balance).toBe(19100);

    await http.post(`/planned-operations/${planned.body.id}/unrealize`).set('Authorization', `Bearer ${token}`).expect(201);

    // Solde restauré, échéance redevenue PENDING avec son montant prévu d'origine.
    expect((await getAccount(token, cih.id)).balance).toBe(20000);
    const plannedAfter = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body.find((p: any) => p.id === planned.body.id);
    expect(plannedAfter.status).toBe('PENDING');
    expect(plannedAfter.expectedAmount).toBe(900);

    // Historique utilisateur standard ne montre ni le paiement annulé ni sa contre-écriture.
    const history = await http.get('/financial-operations').set('Authorization', `Bearer ${token}`).expect(200);
    expect(history.body.every((o: any) => o.kind === 'OPENING_BALANCE')).toBe(true);

    // Planning : la case redevient PENDING à 900, jamais "réalisée" résiduelle.
    const planning = await getPlanning(token, 3);
    const cell = findCell(planning, 'depenses', maison.id);
    expect(cell.status).toBe('PENDING');
    expect(cell.displayAmount).toBe(900);
  });
});
