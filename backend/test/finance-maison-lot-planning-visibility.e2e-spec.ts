import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Lot "Afficher dans le Planning" (dépense ponctuelle réalisée) — tests
 * obligatoires 1-5 (spécification verbatim) :
 *  1. ponctuelle + case cochée  -> ledger OK, solde débité, historique OK, Planning OUI.
 *  2. ponctuelle + case décochée -> ledger OK, solde débité, historique OK, Planning NON.
 *  3. décocher la case ne change jamais les totaux/soldes réels.
 *  4. dépense récurrente -> toujours présente dans le Planning.
 *  5. dépense future (échéance planifiée) -> toujours présente dans le Planning.
 */
describe('Finance Maison — "Afficher dans le Planning" (dépense ponctuelle)', () => {
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
    const email = `planning-visibility-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Test', `User${counter}`);
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    return res.body.accessToken as string;
  }

  async function createAccount(token: string, name: string, openingBalance?: number) {
    const res = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name, openingBalance: openingBalance?.toString() }).expect(201);
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

  // -----------------------------------------------------------------
  // 1. Ponctuelle + case cochée (comportement par défaut, inchangé).
  // -----------------------------------------------------------------
  it('1. dépense ponctuelle avec "Afficher dans le Planning" coché : ledger, solde, historique ET Planning', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const courses = await createCategory(token, 'Courses');

    const op = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses du mois', date: todayIso(), amount: '450', categoryId: courses.id, sourceAccountId: cih.id, includeInPlanning: true })
      .expect(201);
    expect(op.body.includeInPlanning).toBe(true);

    // Ledger + solde.
    expect((await getAccount(token, cih.id)).balance).toBe(19550);

    // Historique.
    const history = await http.get(`/financial-operations?accountId=${cih.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(history.body.find((o: any) => o.id === op.body.id)).toBeDefined();

    // Planning : visible.
    const planning = await getPlanning(token, 3);
    const cell = findCell(planning, 'depenses', courses.id);
    expect(cell).toBeDefined();
    expect(cell.status).toBe('REALIZED');
    expect(cell.displayAmount).toBe(450);
    expect(planning.synthese[planning.months[0]].totalDepenses).toBe(450);
  });

  // -----------------------------------------------------------------
  // 2. Ponctuelle + case décochée.
  // -----------------------------------------------------------------
  it('2. dépense ponctuelle avec "Afficher dans le Planning" décoché : ledger, solde, historique OK, mais ABSENTE du Planning', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const courses = await createCategory(token, 'Courses');

    const op = await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Cadeau discret', date: todayIso(), amount: '300', categoryId: courses.id, sourceAccountId: cih.id, includeInPlanning: false })
      .expect(201);
    expect(op.body.includeInPlanning).toBe(false);

    // Ledger + solde : identiques à une dépense normale.
    expect((await getAccount(token, cih.id)).balance).toBe(19700);

    // Historique de compte : toujours présente (jamais exclue du ledger/historique).
    const history = await http.get(`/financial-operations?accountId=${cih.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(history.body.find((o: any) => o.id === op.body.id)).toBeDefined();

    // Planning : absente (aucune ligne "Courses" créée pour cette seule dépense).
    const planning = await getPlanning(token, 3);
    const cell = findCell(planning, 'depenses', courses.id);
    expect(cell).toBeUndefined();
    expect(planning.synthese[planning.months[0]].totalDepenses).toBe(0);
  });

  // -----------------------------------------------------------------
  // 3. Décocher ne change jamais les totaux/soldes RÉELS.
  // -----------------------------------------------------------------
  it("3. décocher \"Afficher dans le Planning\" ne modifie jamais le solde réel ni le total du ledger — seule la visibilité Planning change", async () => {
    const token = await freshHousehold();
    const cihA = await createAccount(token, 'CIH A', 20000);
    const cihB = await createAccount(token, 'CIH B', 20000);
    const courses = await createCategory(token, 'Courses');

    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', date: todayIso(), amount: '600', categoryId: courses.id, sourceAccountId: cihA.id, includeInPlanning: true })
      .expect(201);
    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', date: todayIso(), amount: '600', categoryId: courses.id, sourceAccountId: cihB.id, includeInPlanning: false })
      .expect(201);

    // Même montant débité sur chaque compte, peu importe includeInPlanning.
    expect((await getAccount(token, cihA.id)).balance).toBe(19400);
    expect((await getAccount(token, cihB.id)).balance).toBe(19400);

    // Seul le total AFFICHÉ dans le Planning diffère (600, pas 1200) — la
    // dépense décochée reste réelle mais n'alimente jamais ce total.
    const planning = await getPlanning(token, 3);
    expect(planning.synthese[planning.months[0]].totalDepenses).toBe(600);
  });

  // -----------------------------------------------------------------
  // 4. Dépense RÉCURRENTE : toujours dans le Planning (option non applicable).
  // -----------------------------------------------------------------
  it('4. une charge récurrente reste toujours intégrée au Planning (option "Afficher dans le Planning" non applicable)', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);

    await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), label: 'Internet', kind: 'EXPENSE', expectedAmount: '350', sourceAccountId: cih.id })
      .expect(201);

    const planning = await getPlanning(token, 6);
    const row = planning.depenses.find((r: any) => r.label === 'Internet');
    expect(row).toBeDefined();
    expect(row.cells[planning.months[0]].status).toBe('PENDING');
    expect(row.cells[planning.months[0]].displayAmount).toBe(350);
  });

  // -----------------------------------------------------------------
  // 5. Dépense FUTURE (échéance planifiée, non récurrente) : toujours dans le Planning.
  // -----------------------------------------------------------------
  it('5. une dépense future (échéance planifiée) reste toujours intégrée au Planning (option "Afficher dans le Planning" non applicable)', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);
    const maison = await createCategory(token, 'Maison');

    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 10);
    const futureDate = future.toISOString().slice(0, 10);

    await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Assurance habitation', expectedDate: futureDate, expectedAmount: '900', categoryId: maison.id, sourceAccountId: cih.id })
      .expect(201);

    const planning = await getPlanning(token, 3);
    const cell = findCell(planning, 'depenses', maison.id);
    expect(cell).toBeDefined();
    expect(cell.status).toBe('PENDING');
    expect(cell.displayAmount).toBe(900);
  });

  // -----------------------------------------------------------------
  // Garde-fou : l'option est réservée aux dépenses (EXPENSE).
  // -----------------------------------------------------------------
  it("refuse includeInPlanning=false sur une opération qui n'est pas une dépense (ex. revenu)", async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);

    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'INCOME', label: 'Salaire', date: todayIso(), amount: '5000', destinationAccountId: cih.id, includeInPlanning: false })
      .expect(400);
  });
});
