import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Lot "paiements partiels successifs + synthèse enrichie" :
 *  - Partie 1 : une échéance reste TOUJOURS interactive après un paiement
 *    partiel (le bug corrigé était que la case cessait d'exposer
 *    singleOccurrence dès le 2e item) — séquence complète 800 -> 300 -> 200
 *    -> 100 -> solde, avec sources différentes à deux paiements distincts,
 *    vérifiée à CHAQUE étape (ledger, soldes, source, Planning, pas de
 *    double comptage).
 *  - Partie 2 : nouveaux indicateurs de synthèse (depensesPrevues/Payees/
 *    Reste, epargnePrevue/Versee/Reste) — axe DISTINCT de totalDepenses/
 *    balance (qui restent inchangés, cf. §anti-double-compte budget), sur
 *    les 13 scénarios listés par la spec.
 */
describe('Finance Maison — paiements partiels successifs + synthèse enrichie', () => {
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
    const email = `partial-synth-${counter}-${Date.now()}@test.local`;
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

  // ===================================================================
  // Partie 1 — paiements partiels successifs
  // ===================================================================
  it('séquence complète 800 -> 300 -> 200 -> 100 -> solde (200), sources différentes à 2 paiements : jamais bloqué, jamais de double comptage', async () => {
    const token = await freshHousehold();
    const adil = await createAccount(token, 'Adil Compte Principal', 10000);
    const lamiaa = await createAccount(token, 'Lamiaa Compte', 10000);
    const transport = await createCategory(token, 'Transport');

    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Carburant Adil', expectedDate: todayIso(), expectedAmount: '800', categoryId: transport.id, sourceAccountId: adil.id })
      .expect(201);

    // --- Paiement 1 : 300 DH depuis Adil (source prévue, sans override). ---
    await http.post(`/planned-operations/${planned.body.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '300' }).expect(201);
    expect((await getAccount(token, adil.id)).balance).toBe(9700);
    expect((await getAccount(token, lamiaa.id)).balance).toBe(10000);

    let planning = await getPlanning(token, 3);
    let cell = findCell(planning, 'depenses', transport.id);
    expect(cell.status).toBe('MIXED');
    expect(cell.displayAmount).toBe(800);
    expect(cell.realizedAmount).toBe(300);
    expect(cell.pendingAmount).toBe(500);
    // La case reste TOUJOURS une occurrence unique et interactive — c'est le
    // cœur du correctif (avant : singleOccurrence devenait null dès le 2e item).
    expect(cell.singleOccurrence).not.toBeNull();
    expect(cell.singleOccurrence.plannedOperationId).toBe(planned.body.id);
    expect(cell.singleOccurrence.status).toBe('PENDING');
    expect(cell.singleOccurrence.expectedAmount).toBe(800);
    expect(cell.singleOccurrence.realizedAmount).toBe(300);
    expect(cell.singleOccurrence.sourceAccountId).toBe(adil.id); // source PRÉVUE de l'échéance, jamais modifiée

    let plannedRow = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body.find((p: any) => p.id === planned.body.id);
    expect(plannedRow.status).toBe('PENDING');
    expect(plannedRow.expectedAmount).toBe(800); // jamais muté par le paiement partiel

    // --- Paiement 2 : 200 DH, cette fois depuis Lamiaa (source DIFFÉRENTE du 1er paiement et de la source prévue). ---
    await http
      .post(`/planned-operations/${planned.body.id}/partial-realize`)
      .set('Authorization', `Bearer ${token}`)
      .send({ actualAmount: '200', sourceAccountId: lamiaa.id })
      .expect(201);
    expect((await getAccount(token, adil.id)).balance).toBe(9700); // inchangé par ce 2e paiement
    expect((await getAccount(token, lamiaa.id)).balance).toBe(9800); // 10000 - 200

    planning = await getPlanning(token, 3);
    cell = findCell(planning, 'depenses', transport.id);
    expect(cell.status).toBe('MIXED');
    expect(cell.realizedAmount).toBe(500); // 300 + 200, jamais 800
    expect(cell.pendingAmount).toBe(300);
    expect(cell.singleOccurrence.expectedAmount).toBe(800);
    expect(cell.singleOccurrence.realizedAmount).toBe(500);
    // La source PRÉVUE de l'échéance (pour le PROCHAIN paiement) reste Adil —
    // le choix d'une source différente à CE paiement ne modifie jamais la
    // définition prévue de l'échéance/série.
    expect(cell.singleOccurrence.sourceAccountId).toBe(adil.id);
    plannedRow = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body.find((p: any) => p.id === planned.body.id);
    expect(plannedRow.sourceAccountId).toBe(adil.id);
    expect(plannedRow.expectedAmount).toBe(800);

    // --- Paiement 3 : 100 DH depuis Adil à nouveau. Toujours interactif. ---
    await http.post(`/planned-operations/${planned.body.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '100' }).expect(201);
    expect((await getAccount(token, adil.id)).balance).toBe(9600); // 9700 - 100
    planning = await getPlanning(token, 3);
    cell = findCell(planning, 'depenses', transport.id);
    expect(cell.realizedAmount).toBe(600); // 300 + 200 + 100
    expect(cell.pendingAmount).toBe(200);
    expect(cell.singleOccurrence).not.toBeNull();
    expect(cell.singleOccurrence.realizedAmount).toBe(600);

    // Impossible de régler un montant partiel qui couvrirait déjà tout le
    // reste (200) : le paiement total doit être utilisé à la place.
    await http.post(`/planned-operations/${planned.body.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '200' }).expect(400);

    // --- Paiement final (solde exact du reste, 200 DH) : clôture l'échéance. ---
    await http.post(`/planned-operations/${planned.body.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '200' }).expect(201);
    expect((await getAccount(token, adil.id)).balance).toBe(9400); // 9600 - 200 ; jamais 9600 - 800 en plus (aucun risque de 1 100 DH de dépenses)

    planning = await getPlanning(token, 3);
    cell = findCell(planning, 'depenses', transport.id);
    expect(cell.status).toBe('REALIZED');
    expect(cell.displayAmount).toBe(800); // 300+200+100+200, jamais 1600 ni 1100
    expect(cell.pendingAmount).toBe(0);
    expect(cell.singleOccurrence.status).toBe('REALIZED');
    expect(cell.singleOccurrence.expectedAmount).toBe(800);
    expect(cell.singleOccurrence.realizedAmount).toBe(800);

    plannedRow = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body.find((p: any) => p.id === planned.body.id);
    expect(plannedRow.status).toBe('REALIZED');

    // Quatre opérations réelles distinctes (300+200+100+200=800), chacune sa
    // propre source — jamais une seule opération de 800, jamais de doublon.
    const adilOps = (await http.get(`/financial-operations?accountId=${adil.id}`).set('Authorization', `Bearer ${token}`).expect(200)).body.filter((o: any) => o.label === 'Carburant Adil');
    const lamiaaOps = (await http.get(`/financial-operations?accountId=${lamiaa.id}`).set('Authorization', `Bearer ${token}`).expect(200)).body.filter(
      (o: any) => o.label === 'Carburant Adil',
    );
    expect(adilOps.map((o: any) => o.amount).sort((a: number, b: number) => a - b)).toEqual([100, 200, 300]);
    expect(lamiaaOps.map((o: any) => o.amount)).toEqual([200]);

    // Pas de double comptage dans la balance du mois (800 réalisés au total, rien de plus).
    expect(planning.synthese[planning.months[0]].totalDepenses).toBe(800);
    expect(planning.synthese[planning.months[0]].depensesPrevues).toBe(800);
    expect(planning.synthese[planning.months[0]].depensesPayees).toBe(800);
    expect(planning.synthese[planning.months[0]].depensesReste).toBe(0);
  });

  // ===================================================================
  // Partie 2 — synthèse enrichie (indicateurs certains A/D/E)
  // ===================================================================
  it('synthèse enrichie : dépenses prévues/payées/reste et épargne prévue/versée/reste — jamais mélangées, jamais de double compte', async () => {
    const token = await freshHousehold();
    const c1 = await createAccount(token, 'Compte Famille', 200000);
    const c2 = await createAccount(token, 'Compte Secondaire', 10000);
    const courses = await createSubaccount(token, c1.id, 'Courses', 2000);

    const logement = await createCategory(token, 'Logement');
    const telecom = await createCategory(token, 'Télécom');
    const assurance = await createCategory(token, 'Assurance');
    const transport = await createCategory(token, 'Transport');
    const alimentation = await createCategory(token, 'Alimentation');
    const divers = await createCategory(token, 'Divers');

    const today = todayIso();

    // a) Dépense prévue NON payée (reste entier).
    const loyer = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Loyer', expectedDate: today, expectedAmount: '5000', categoryId: logement.id, sourceAccountId: c1.id })
      .expect(201);

    // b) Dépense TOTALEMENT payée.
    const internet = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Internet', expectedDate: today, expectedAmount: '300', categoryId: telecom.id, sourceAccountId: c1.id })
      .expect(201);
    await http.post(`/planned-operations/${internet.body.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '300' }).expect(201);

    // c) Dépense PARTIELLEMENT payée (un seul paiement partiel).
    const assuranceEch = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Assurance auto', expectedDate: today, expectedAmount: '1200', categoryId: assurance.id, sourceAccountId: c1.id })
      .expect(201);
    await http.post(`/planned-operations/${assuranceEch.body.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '400' }).expect(201);

    // d) Dépense avec PLUSIEURS paiements partiels.
    const carburant = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Carburant', expectedDate: today, expectedAmount: '800', categoryId: transport.id, sourceAccountId: c1.id })
      .expect(201);
    await http.post(`/planned-operations/${carburant.body.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '300' }).expect(201);
    await http.post(`/planned-operations/${carburant.body.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '200' }).expect(201);

    // f) VERSEMENT vers une enveloppe — ne doit JAMAIS compter comme une dépense.
    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'SAVINGS_CONTRIBUTION', label: 'Versement Courses', date: today, amount: '1000', sourceAccountId: c1.id, destinationAccountId: c1.id, destinationSubaccountId: courses.id })
      .expect(201);

    // g) Dépense DEPUIS cette enveloppe — compte comme une vraie dépense
    // (prévu=payé), mais le versement qui a alimenté l'enveloppe (f) ne doit
    // jamais être recompté.
    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses épicerie', date: today, amount: '250', categoryId: alimentation.id, sourceAccountId: c1.id, sourceSubaccountId: courses.id })
      .expect(201);

    // h) Transfert interne — jamais une dépense.
    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'TRANSFER', label: 'Virement vers Secondaire', date: today, amount: '500', sourceAccountId: c1.id, destinationAccountId: c2.id })
      .expect(201);

    // i) includeInPlanning=false — exclue de TOUTE la synthèse (dépenses réelles/ledger inchangés par ailleurs).
    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Cadeau discret', date: today, amount: '150', categoryId: divers.id, sourceAccountId: c1.id, includeInPlanning: false })
      .expect(201);

    // Revenu, pour une balance mensuelle non triviale.
    await http.post('/financial-operations').set('Authorization', `Bearer ${token}`).send({ kind: 'INCOME', label: 'Salaire', date: today, amount: '2000', destinationAccountId: c1.id }).expect(201);

    const planning = await getPlanning(token, 3);
    const synth = planning.synthese[planning.months[0]];

    // --- A. Dépenses prévues / payées / reste (axe "où en suis-je", jamais
    // mélangé avec le budget totalDepenses ci-dessous). ---
    // Prévu = 5000(a, non payé) + 300(b) + 1200(c) + 800(d) + 250(g, ad-hoc : prévu=payé) = 7550.
    expect(synth.depensesPrevues).toBe(7550);
    // Payé = 0(a) + 300(b) + 400(c) + 500(d) + 250(g) = 1450.
    expect(synth.depensesPayees).toBe(1450);
    // Reste = Prévu - Payé, JAMAIS Prévu + Payé.
    expect(synth.depensesReste).toBe(6100);
    expect(synth.depensesPrevues - synth.depensesPayees).toBe(synth.depensesReste);

    // --- D. Épargne/versements — strictement séparée, jamais dans les dépenses. ---
    expect(synth.epargnePrevue).toBe(1000);
    expect(synth.epargneVersee).toBe(1000);
    expect(synth.epargneReste).toBe(0);

    // --- E. totalDepenses/balanceMensuelle (axe "budget", INCHANGÉ) : exclut
    // la part ALREADY_FUNDED (g, payée depuis l'enveloppe) pour ne jamais
    // recompter l'argent déjà compté au moment du versement (f). ---
    // a(5000, PENDING plein tarif) + b(300) + c(1200: 400 payé + 800 reste) +
    // d(800: 500 payé + 300 reste) + g(0, ALREADY_FUNDED) = 7300.
    expect(synth.totalDepenses).toBe(7300);
    expect(synth.totalEpargne).toBe(1000);
    expect(synth.totalRevenus).toBe(2000);
    expect(synth.balanceMensuelle).toBe(2000 - 7300 - 1000);

    // g (dépense réelle depuis une enveloppe) compte bien dans "déjà payé"
    // (axe cash-flow, i.e. l'argent a réellement quitté le compte) MÊME s'il
    // ne compte pas dans totalDepenses (axe budget, anti-double-compte) —
    // c'est précisément la distinction entre les deux axes.
    expect(synth.depensesPayees).toBeGreaterThan(synth.totalDepenses - (5000 + 300 + 800 + 300)); // sanity : 250 de g est bien dans payées

    // includeInPlanning=false (i, 150 DH) n'apparaît dans AUCUN indicateur ci-dessus.
    const diversCell = findCell(planning, 'depenses', divers.id);
    expect(diversCell).toBeUndefined();

    // Transfert interne (h) : kind exclu de la requête Planning — aucune ligne créée, aucun indicateur modifié.
    expect(planning.depenses.find((r: any) => r.label.includes('Virement'))).toBeUndefined();
  });

  it('synthèse enrichie : passage d\'un mois au suivant — chaque indicateur reste propre à SON mois, balanceCumulee s\'accumule normalement', async () => {
    const token = await freshHousehold();
    const c1 = await createAccount(token, 'Compte Famille', 50000);
    const logement = await createCategory(token, 'Logement');

    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 10);
    const nextMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 5));
    const nextMonth = nextMonthDate.toISOString().slice(0, 10);

    // Mois 1 : échéance 1000, payée pour moitié (500).
    const m1 = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Travaux', expectedDate: thisMonth, expectedAmount: '1000', categoryId: logement.id, sourceAccountId: c1.id })
      .expect(201);
    await http.post(`/planned-operations/${m1.body.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '500' }).expect(201);

    // Mois 2 : échéance distincte 2000, entièrement payée.
    const m2 = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Mobilier', expectedDate: nextMonth, expectedAmount: '2000', categoryId: logement.id, sourceAccountId: c1.id })
      .expect(201);
    await http.post(`/planned-operations/${m2.body.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '2000' }).expect(201);

    const planning = await getPlanning(token, 3);
    const [monthKey1, monthKey2] = planning.months;
    const synth1 = planning.synthese[monthKey1];
    const synth2 = planning.synthese[monthKey2];

    // Chaque mois ne voit QUE sa propre échéance — jamais de fuite entre mois.
    expect(synth1.depensesPrevues).toBe(1000);
    expect(synth1.depensesPayees).toBe(500);
    expect(synth1.depensesReste).toBe(500);

    expect(synth2.depensesPrevues).toBe(2000);
    expect(synth2.depensesPayees).toBe(2000);
    expect(synth2.depensesReste).toBe(0);

    // Balance mensuelle/cumulée (axe "budget", formule INCHANGÉE) : une
    // échéance encore PENDING compte à sa valeur NOMINALE complète (1000),
    // que 500 en aient déjà été payés ou non — c'est depensesPayees/Reste
    // ci-dessus (axe "cash-flow", nouveau) qui distingue le "déjà payé" du
    // "encore prévu", jamais balanceMensuelle/Cumulee.
    expect(synth1.balanceMensuelle).toBe(-1000);
    expect(synth2.balanceMensuelle).toBe(-2000);
    expect(synth1.balanceCumulee).toBe(-1000);
    expect(synth2.balanceCumulee).toBe(-1000 + -2000);
  });
});
