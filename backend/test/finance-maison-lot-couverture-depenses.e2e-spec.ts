import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Lot "couverture des dépenses restantes" — calcul PAR SOURCE prévue des
 * échéances encore à payer (jamais un total patrimoine) : disponible =
 * non-affecté du compte (source directe) ou solde de l'enveloppe (source
 * sous-compte) ; un surplus sur une source ne compense JAMAIS le déficit
 * d'une autre (§3). Fiable uniquement pour le mois COURANT (§8) — les mois
 * futurs ne reçoivent QUE Prévu/Payé/Reste (depensesCouvertes/
 * AProvisionner = null), faute de projection de solde par mois/source dans
 * le modèle actuel.
 */
describe('Finance Maison — couverture des dépenses restantes (par source, mois courant)', () => {
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
    const email = `couverture-${counter}-${Date.now()}@test.local`;
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

  async function getPlanning(token: string, months = 3) {
    const res = await http.get(`/planning?months=${months}`).set('Authorization', `Bearer ${token}`).expect(200);
    return res.body;
  }

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // -----------------------------------------------------------------
  // 1-2-3. Exemple de référence (verbatim spec) : compte 2000/reste 1500
  // (couvert 1500) + enveloppe Courses 3000/reste 4000 (couvert 3000) ->
  // total reste 5500, couvert 4500, à provisionner 1000. Le surplus +500 du
  // compte ne masque JAMAIS le déficit -1000 de l'enveloppe.
  // -----------------------------------------------------------------
  it('1-2-3. deux sources (compte + enveloppe) : le surplus de l\'une ne compense jamais le déficit de l\'autre', async () => {
    const token = await freshHousehold();
    const compte = await createAccount(token, 'Compte Principal', 2000);
    const epargne = await createAccount(token, 'Compte Épargne', 10000);
    const courses = await createSubaccount(token, epargne.id, 'Courses', 3000);
    const divers = await createCategory(token, 'Divers');
    const today = todayIso();

    // Source A (compte principal, non-affecté 2000) : reste 1500 -> couvert
    // intégralement, marge +500 (jamais utilisée pour combler l'enveloppe).
    await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Loyer', expectedDate: today, expectedAmount: '1500', categoryId: divers.id, sourceAccountId: compte.id })
      .expect(201);

    // Source B (enveloppe Courses, solde 3000) : reste 4000 -> déficit -1000.
    await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses du mois', expectedDate: today, expectedAmount: '4000', categoryId: divers.id, sourceAccountId: epargne.id, sourceSubaccountId: courses.id })
      .expect(201);

    const planning = await getPlanning(token, 3);
    const synth = planning.synthese[planning.months[0]];

    expect(synth.depensesPrevues).toBe(5500);
    expect(synth.depensesPayees).toBe(0);
    expect(synth.depensesReste).toBe(5500);
    // Couvert = min(2000,1500) + min(3000,4000) = 1500 + 3000 = 4500 — JAMAIS
    // 2000+3000=5000 (qui masquerait artificiellement le déficit de Courses).
    expect(synth.depensesCouvertes).toBe(4500);
    expect(synth.depensesAProvisionner).toBe(1000);

    // Les mois futurs n'ont PAS cet indicateur (pas de projection fiable).
    const futureSynth = planning.synthese[planning.months[1]];
    expect(futureSynth.depensesCouvertes).toBeNull();
    expect(futureSynth.depensesAProvisionner).toBeNull();
  });

  it('4-5. paiement partiel : la couverture ne réserve/teste jamais le prévu complet, seulement le RESTE — recalculée à chaque nouveau paiement', async () => {
    const token = await freshHousehold();
    const compte = await createAccount(token, 'Compte Principal', 1000); // non-affecté 1000
    const transport = await createCategory(token, 'Transport');
    const today = todayIso();

    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Carburant', expectedDate: today, expectedAmount: '800', categoryId: transport.id, sourceAccountId: compte.id })
      .expect(201);

    // Avant tout paiement : reste 800 > non-affecté 1000 ? Non, 800 < 1000 -> entièrement couvert.
    let planning = await getPlanning(token, 3);
    let synth = planning.synthese[planning.months[0]];
    expect(synth.depensesReste).toBe(800);
    expect(synth.depensesCouvertes).toBe(800);
    expect(synth.depensesAProvisionner).toBe(0);

    // Paiement partiel de 300 (débite le compte -> non-affecté devient 700) :
    // reste 500, couverture calculée sur CES 500, jamais sur les 800 d'origine.
    await http.post(`/planned-operations/${planned.body.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '300' }).expect(201);
    planning = await getPlanning(token, 3);
    synth = planning.synthese[planning.months[0]];
    expect(synth.depensesReste).toBe(500);
    expect(synth.depensesCouvertes).toBe(500); // non-affecté 700 >= 500 -> entièrement couvert
    expect(synth.depensesAProvisionner).toBe(0);

    // Nouveau paiement de 200 (non-affecté devient 500) : reste 300, couverture recalculée sur 300.
    await http.post(`/planned-operations/${planned.body.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '200' }).expect(201);
    planning = await getPlanning(token, 3);
    synth = planning.synthese[planning.months[0]];
    expect(synth.depensesReste).toBe(300);
    expect(synth.depensesCouvertes).toBe(300);
    expect(synth.depensesAProvisionner).toBe(0);
  });

  it('6. un versement/épargne prévu ou versé n\'a AUCUN impact sur le reste à payer / couverture des dépenses', async () => {
    const token = await freshHousehold();
    const compte = await createAccount(token, 'Compte Principal', 500); // non-affecté 500, volontairement insuffisant
    const maison = await createCategory(token, 'Maison');
    const today = todayIso();

    // Dépense dont la couverture est volontairement déficitaire (500 dispo / 800 reste -> -300).
    await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Travaux', expectedDate: today, expectedAmount: '800', categoryId: maison.id, sourceAccountId: compte.id })
      .expect(201);

    // Versement prévu volumineux (10 000) vers une épargne — ne doit RIEN changer à la couverture des dépenses.
    await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'SAVINGS_CONTRIBUTION', label: 'Épargne retraite', expectedDate: today, expectedAmount: '10000', sourceAccountId: compte.id, destinationAccountId: compte.id })
      .expect(201);

    const planning = await getPlanning(token, 3);
    const synth = planning.synthese[planning.months[0]];
    expect(synth.depensesReste).toBe(800);
    expect(synth.depensesCouvertes).toBe(500);
    expect(synth.depensesAProvisionner).toBe(300);
    // L'épargne a son propre reste, jamais mêlé à "à provisionner" des dépenses.
    expect(synth.epargnePrevue).toBe(10000);
    expect(synth.epargneReste).toBe(10000);
  });

  it('7. includeInPlanning=false n\'a aucun impact sur cette synthèse (ni prévu, ni couverture)', async () => {
    const token = await freshHousehold();
    const compte = await createAccount(token, 'Compte Principal', 10000);
    const divers = await createCategory(token, 'Divers');
    const today = todayIso();

    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Cadeau discret', date: today, amount: '2000', categoryId: divers.id, sourceAccountId: compte.id, includeInPlanning: false })
      .expect(201);

    const planning = await getPlanning(token, 3);
    const synth = planning.synthese[planning.months[0]];
    expect(synth.depensesPrevues).toBe(0);
    expect(synth.depensesReste).toBe(0);
    expect(synth.depensesCouvertes).toBe(0);
    expect(synth.depensesAProvisionner).toBe(0);
  });

  it("8. échéance sans source valide/identifiable : toujours considérée NON couverte, jamais une source supposée", async () => {
    const token = await freshHousehold();
    const compte = await createAccount(token, 'Compte Principal', 100000); // non-affecté très large, ne doit JAMAIS être utilisé par erreur
    const divers = await createCategory(token, 'Divers');
    const today = todayIso();

    // Échéance créée SANS sourceAccountId (autorisé à la création — seule la réalisation l'exige).
    await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Dépense sans source', expectedDate: today, expectedAmount: '500', categoryId: divers.id })
      .expect(201);

    const planning = await getPlanning(token, 3);
    const synth = planning.synthese[planning.months[0]];
    expect(synth.depensesReste).toBe(500);
    // Jamais couverte par le compte 100 000 DH existant — aucune source n'est supposée.
    expect(synth.depensesCouvertes).toBe(0);
    expect(synth.depensesAProvisionner).toBe(500);
  });

  it("Tout est couvert : reste entièrement couvert sur chaque source -> à provisionner = 0", async () => {
    const token = await freshHousehold();
    const compte = await createAccount(token, 'Compte Principal', 5000);
    const divers = await createCategory(token, 'Divers');
    const today = todayIso();

    await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Facture', expectedDate: today, expectedAmount: '1200', categoryId: divers.id, sourceAccountId: compte.id })
      .expect(201);

    const planning = await getPlanning(token, 3);
    const synth = planning.synthese[planning.months[0]];
    expect(synth.depensesReste).toBe(1200);
    expect(synth.depensesCouvertes).toBe(1200);
    expect(synth.depensesAProvisionner).toBe(0);
  });
});
