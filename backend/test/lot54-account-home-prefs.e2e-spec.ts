import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Corrections consolidées §5/§6 — préférences d'affichage par compte
 * (hideBalanceByDefault, showOnHome), purement visuelles et INDÉPENDANTES de
 * includeInOperationalTreasury (pilotage) : un compte peut être piloté et
 * masqué de l'accueil, ou hors pilotage et affiché, sans jamais que l'une
 * découle de l'autre. Aucun moteur financier touché.
 */
describe('Corrections consolidées §5/§6 — préférences par compte (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  const run = Date.now();
  let seq = 0;

  const mailer = new FakeMailer();
  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold() {
    seq += 1;
    const signupToken = await signupVerified(http, mailer, `lot54+${run}+${seq}@example.com`, 'password123', 'L54', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer Lot54 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  it('un compte créé sans préciser les préférences a showOnHome=true et hideBalanceByDefault=false par défaut', async () => {
    const { auth } = await newHousehold();
    const created = await http.post('/accounts').set(...auth()).send({ name: 'Compte défaut', type: 'courant', initialBalance: 0 }).expect(201);
    expect(created.body.showOnHome).toBe(true);
    expect(created.body.hideBalanceByDefault).toBe(false);
  });

  it('PATCH modifie hideBalanceByDefault et showOnHome indépendamment, sans jamais toucher includeInOperationalTreasury', async () => {
    const { auth } = await newHousehold();
    const created = await http
      .post('/accounts')
      .set(...auth())
      .send({ name: 'Compte SG', type: 'courant', initialBalance: 5000, includeInOperationalTreasury: true })
      .expect(201);

    const updated = await http
      .patch(`/accounts/${created.body.id}`)
      .set(...auth())
      .send({ hideBalanceByDefault: true, showOnHome: false })
      .expect(200);

    expect(updated.body.hideBalanceByDefault).toBe(true);
    expect(updated.body.showOnHome).toBe(false);
    expect(updated.body.includeInOperationalTreasury).toBe(true); // jamais altéré par ce PATCH
  });

  it('un compte HORS pilotage peut rester affiché sur l\'accueil (showOnHome=true) — les 2 notions ne se déduisent jamais l\'une de l\'autre', async () => {
    const { auth } = await newHousehold();
    const created = await http
      .post('/accounts')
      .set(...auth())
      .send({ name: 'Épargne enfant', type: 'epargne', initialBalance: 2000, includeInOperationalTreasury: false })
      .expect(201);

    const updated = await http.patch(`/accounts/${created.body.id}`).set(...auth()).send({ showOnHome: true }).expect(200);
    expect(updated.body.includeInOperationalTreasury).toBe(false);
    expect(updated.body.showOnHome).toBe(true);
  });

  it('un compte PILOTÉ peut être masqué de l\'accueil (showOnHome=false) sans en sortir du pilotage', async () => {
    const { auth } = await newHousehold();
    const created = await http
      .post('/accounts')
      .set(...auth())
      .send({ name: 'Compte pro', type: 'courant', initialBalance: 1000, includeInOperationalTreasury: true })
      .expect(201);

    const updated = await http.patch(`/accounts/${created.body.id}`).set(...auth()).send({ showOnHome: false }).expect(200);
    expect(updated.body.includeInOperationalTreasury).toBe(true);
    expect(updated.body.showOnHome).toBe(false);

    // Le compte reste bien listé (et son solde intact) via GET /accounts — showOnHome
    // ne filtre jamais la liste complète, seulement l'affichage Accueil côté mobile.
    const list = await http.get('/accounts').set(...auth()).expect(200);
    const found = list.body.find((a: { id: string }) => a.id === created.body.id);
    expect(found).toBeDefined();
    expect(found.soldeCourant).toBe(1000);
  });
});
