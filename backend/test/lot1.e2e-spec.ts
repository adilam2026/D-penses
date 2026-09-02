import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Tests Lot 1 (docs/05-roadmap-et-risques.md, "Tests obligatoires" + TEST A/B/C
 * de la demande). Référence normative : docs/02-modele-metier.md §E.8 (RG-080 à RG-086).
 */
describe('Lot 1 — Comptes financiers (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let prisma: PrismaService;
  const run = Date.now();

  let accessToken: string;
  let accountA: string;
  let accountB: string;
  const mailer = new FakeMailer();

  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    const signupToken = await signupVerified(http, mailer, `lot1+${run}@example.com`, 'password123', 'L1', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: 'Foyer Lot1' })
      .expect(201);
    accessToken = household.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];

  it('crée deux comptes avec un solde initial (RG-080)', async () => {
    const a = await http.post('/accounts').set(...auth()).send({ name: 'Compte A', type: 'courant', initialBalance: 30000 }).expect(201);
    expect(a.body.soldeCourant).toBe(30000);
    accountA = a.body.id;

    const b = await http.post('/accounts').set(...auth()).send({ name: 'Compte B', type: 'epargne', initialBalance: 0 }).expect(201);
    expect(b.body.soldeCourant).toBe(0);
    accountB = b.body.id;
  });

  // ---------- TEST A ----------
  it('TEST A — transfert interne : A diminue, B augmente, patrimoine total inchangé', async () => {
    const before = await http.get('/accounts/summary').set(...auth()).expect(200);
    expect(before.body.patrimoineLiquideTotal).toBe(30000);

    await http
      .post('/accounts/transfers')
      .set(...auth())
      .send({ fromAccountId: accountA, toAccountId: accountB, amount: 5000 })
      .expect(201);

    const a = await http.get(`/accounts/${accountA}`).set(...auth()).expect(200);
    const b = await http.get(`/accounts/${accountB}`).set(...auth()).expect(200);
    expect(a.body.soldeCourant).toBe(25000);
    expect(b.body.soldeCourant).toBe(5000);

    const after = await http.get('/accounts/summary').set(...auth()).expect(200);
    expect(after.body.patrimoineLiquideTotal).toBe(30000); // RG-085 : impact net foyer = 0
  });

  // ---------- TEST B ----------
  it('TEST B — solde recalculé depuis les mouvements réels, sans nouvelle saisie manuelle', async () => {
    const c = await http.post('/accounts').set(...auth()).send({ name: 'Compte C', type: 'courant', initialBalance: 30000 }).expect(201);
    const accountC = c.body.id;

    // Deux dépenses réelles simulées via des « retraits espèces » (seuls mouvements
    // disponibles en Lot 1, avant les Payment/AdHocExpense du Lot 2) — même principe :
    // le solde doit refléter les mouvements sans redemander le solde à l'utilisateur.
    await http.post('/accounts/transfers').set(...auth()).send({ fromAccountId: accountC, amount: 100 }).expect(201);
    await http.post('/accounts/transfers').set(...auth()).send({ fromAccountId: accountC, amount: 600 }).expect(201);

    const after = await http.get(`/accounts/${accountC}`).set(...auth()).expect(200);
    expect(after.body.soldeCourant).toBe(29300); // 30000 - 700, sans nouveau AccountBalanceSnapshot
  });

  // ---------- TEST C ----------
  it('TEST C — rapprochement détecte un écart sans jamais corriger automatiquement', async () => {
    const d = await http.post('/accounts').set(...auth()).send({ name: 'Compte D', type: 'courant', initialBalance: 29300 }).expect(201);
    const accountD = d.body.id;

    const recon = await http
      .post(`/accounts/${accountD}/reconciliations`)
      .set(...auth())
      .send({ declaredBalance: 29050 })
      .expect(201);
    // Les champs Decimal Prisma sont sérialisés en chaîne dans le JSON — comparaison numérique explicite.
    expect(Number(recon.body.discrepancy)).toBe(-250);
    expect(recon.body.status).toBe('pending');

    // Le solde courant n'a PAS bougé tout seul (RG-083 : jamais de correction automatique)
    const stillUnresolved = await http.get(`/accounts/${accountD}`).set(...auth()).expect(200);
    expect(stillUnresolved.body.soldeCourant).toBe(29300);

    // Seule une action explicite (« enregistrer un ajustement ») corrige, en le traçant
    const adjusted = await http
      .post(`/accounts/${accountD}/reconciliations/${recon.body.id}/adjust`)
      .set(...auth())
      .send({ reason: 'Frais bancaires' })
      .expect(201);
    expect(adjusted.body.soldeCourant).toBe(29050);
    expect(adjusted.body.adjustment.type).toBe('ecart_rapprochement');

    const reconciliations = await http.get(`/accounts/${accountD}/reconciliations`).set(...auth()).expect(200);
    expect(reconciliations.body[0].status).toBe('resolue');

    // Un rapprochement déjà résolu ne peut pas être ajusté deux fois
    await http
      .post(`/accounts/${accountD}/reconciliations/${recon.body.id}/adjust`)
      .set(...auth())
      .send({})
      .expect(400);
  });

  it('un transfert planifié dans le futur reste sans effet tant qu\'il n\'est pas confirmé', async () => {
    const e = await http.post('/accounts').set(...auth()).send({ name: 'Compte E', type: 'courant', initialBalance: 1000 }).expect(201);
    const f = await http.post('/accounts').set(...auth()).send({ name: 'Compte F', type: 'courant', initialBalance: 0 }).expect(201);

    const future = new Date(Date.now() + 30 * 86400000).toISOString();
    const transfer = await http
      .post('/accounts/transfers')
      .set(...auth())
      .send({ fromAccountId: e.body.id, toAccountId: f.body.id, amount: 200, plannedDate: future })
      .expect(201);
    expect(transfer.body.status).toBe('prevu');

    const eBalance = await http.get(`/accounts/${e.body.id}`).set(...auth()).expect(200);
    expect(eBalance.body.soldeCourant).toBe(1000); // inchangé tant que non confirmé

    await http.post(`/accounts/transfers/${transfer.body.id}/confirm`).set(...auth()).expect(201);
    const eAfter = await http.get(`/accounts/${e.body.id}`).set(...auth()).expect(200);
    expect(eAfter.body.soldeCourant).toBe(800);
  });

  it('isolation stricte : un utilisateur extérieur ne voit jamais les comptes du foyer', async () => {
    const strangerSignupToken = await signupVerified(http, mailer, `strangerL1+${run}@example.com`, 'password123', 'S', 'T');
    const strangerHousehold = await http
      .post('/households')
      .set('Authorization', `Bearer ${strangerSignupToken}`)
      .send({ name: 'Foyer étranger L1' })
      .expect(201);
    const strangerToken = strangerHousehold.body.accessToken;

    await http.get(`/accounts/${accountA}`).set('Authorization', `Bearer ${strangerToken}`).expect(404);
    const list = await http.get('/accounts').set('Authorization', `Bearer ${strangerToken}`).expect(200);
    expect(list.body).toEqual([]);

    // Preuve RLS indépendante du filtre applicatif
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_household_id', ${strangerHousehold.body.household.id}, true)`;
      return tx.$queryRaw<{ id: string }[]>`SELECT id FROM "financial_account" WHERE id = ${accountA}`;
    });
    expect(rows).toHaveLength(0);
  });
});
