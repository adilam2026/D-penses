import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Correction recette "Planning allégé" — garde-fous explicites (§22) contre
 * la régression constatée : TOTAL DÉPENSES/VERSEMENTS du tableau NE
 * DOIVENT JAMAIS diverger du prévu affiché ailleurs, et le réalisé n'est
 * JAMAIS ajouté une deuxième fois au prévu (cause exacte de l'incohérence
 * "68 050 / 111 650 DH" vs "TOTAL DÉPENSES 71 650 DH" constatée en recette :
 * l'ancien depensesPrevues sommait expectedAmount SANS jamais filtrer
 * budgetImpact, alors que totalDepenses — budgetAmount — exclut
 * ALREADY_FUNDED/EXCLUDED pour l'anti double-compte enveloppe).
 */
describe('Finance Maison — cohérence des totaux (TOTAL DÉPENSES/VERSEMENTS, jamais un double comptage)', () => {
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
    const email = `totaux-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, '482913', 'Test', `User${counter}`);
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

  it('dépense prévue 800, payée partiellement 300 : TOTAL DÉPENSES = 800, jamais 1 100 (prévu + payé)', async () => {
    const token = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 10000);
    const transport = await createCategory(token, 'Transport');
    const today = todayIso();

    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Carburant', expectedDate: today, expectedAmount: '800', categoryId: transport.id, sourceAccountId: compte.id })
      .expect(201);
    await http.post(`/planned-operations/${planned.body.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '300' }).expect(201);

    const planning = await getPlanning(token, 3);
    const synth = planning.synthese[planning.months[0]];
    expect(synth.totalDepenses).toBe(800);
    expect(synth.totalDepenses).not.toBe(1100);
    expect(synth.resteDepenses).toBe(500);
  });

  it('versement prévu 7000, déjà versé 3000 : TOTAL VERSEMENTS = 7000, jamais 10000 (prévu + versé)', async () => {
    const token = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 10000);
    const epargne = await createAccount(token, 'Épargne', 500);
    const today = todayIso();

    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'SAVINGS_CONTRIBUTION', label: 'Versement Voyage', expectedDate: today, expectedAmount: '7000', sourceAccountId: compte.id, destinationAccountId: epargne.id })
      .expect(201);
    await http.post(`/planned-operations/${planned.body.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '3000' }).expect(201);

    const planning = await getPlanning(token, 3);
    const synth = planning.synthese[planning.months[0]];
    expect(synth.totalEpargne).toBe(7000);
    expect(synth.totalEpargne).not.toBe(10000);
    expect(synth.resteVersements).toBe(4000);
  });

  it('dépense intégralement financée par une enveloppe déjà alimentée : TOTAL DÉPENSES reste cohérent avec le reste à exécuter (jamais la divergence "111 650 vs 71 650" constatée en recette)', async () => {
    const token = await freshHousehold();
    const compteCourant = await createAccount(token, 'Compte Courant', 50000);
    const compteEpargne = await createAccount(token, 'Compte Épargne', 50000);
    const enveloppePret = await createSubaccount(token, compteEpargne.id, 'Prêt', 20000); // déjà alimentée par un versement antérieur
    const pret = await createCategory(token, 'Prêt');
    const divers = await createCategory(token, 'Divers');
    const today = todayIso();

    // Dépense classique (compte direct, non-enveloppe) — contribue normalement au budget.
    await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Facture', expectedDate: today, expectedAmount: '1650', categoryId: divers.id, sourceAccountId: compteCourant.id })
      .expect(201);

    // Dépense payée directement depuis l'enveloppe "Prêt" déjà alimentée —
    // ALREADY_FUNDED, exclue du budget (anti double-compte), mais son reste
    // compte malgré tout dans "reste à exécuter" tant qu'elle n'est pas réglée.
    await http
      .post('/financial-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Mensualité prêt', date: today, amount: '15000', categoryId: pret.id, sourceAccountId: compteEpargne.id, sourceSubaccountId: enveloppePret.id })
      .expect(201);

    const planning = await getPlanning(token, 3);
    const synth = planning.synthese[planning.months[0]];
    // TOTAL DÉPENSES n'inclut JAMAIS la mensualité ALREADY_FUNDED (déjà comptée au moment du versement qui a alimenté l'enveloppe) — jamais 16 650.
    expect(synth.totalDepenses).toBe(1650);
    // Invariante garantie par construction : le reste à exécuter n'est jamais supérieur au total affiché.
    expect(synth.resteDepenses).toBeLessThanOrEqual(synth.totalDepenses);
  });
});
