import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Lot "Administration, première utilisation et finitions mobile" — tests
 * obligatoires A-K (K, empty state, est vérifié côté API : GET /accounts
 * renvoie [] pour un foyer neuf, ce que consomme AccueilScreen côté mobile).
 */
describe('Finance Maison — Administration, première utilisation et finitions', () => {
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

  async function freshUser(): Promise<{ token: string; email: string }> {
    counter += 1;
    const email = `admin-lot-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Test', `User${counter}`);
    return { token, email };
  }

  async function freshHousehold(): Promise<{ token: string; email: string }> {
    const { token, email } = await freshUser();
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    return { token: res.body.accessToken as string, email };
  }

  // K. Empty state premier démarrage — un foyer neuf n'a aucun compte.
  it('K. un foyer fraîchement créé ne possède aucun compte (empty state Accueil)', async () => {
    const { token } = await freshHousehold();
    const accounts = await http.get('/accounts').set('Authorization', `Bearer ${token}`).expect(200);
    expect(accounts.body).toEqual([]);
  });

  // A. création d'un premier compte.
  it('A. création d\'un premier compte', async () => {
    const { token } = await freshHousehold();
    const res = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'CIH Courant', bank: 'CIH', type: 'COURANT' }).expect(201);
    expect(res.body.name).toBe('CIH Courant');
    expect(res.body.active).toBe(true);
    expect(res.body.balance).toBe(0);
  });

  // B. solde initial via OPENING_BALANCE — jamais une colonne de vérité.
  it('B. le solde initial d\'un compte crée une opération OPENING_BALANCE', async () => {
    const { token } = await freshHousehold();
    const account = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'CIH', openingBalance: '20000' }).expect(201);
    expect(account.body.balance).toBe(20000);

    const ops = await http.get(`/financial-operations?accountId=${account.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(ops.body).toHaveLength(1);
    expect(ops.body[0].kind).toBe('OPENING_BALANCE');
    expect(ops.body[0].amount).toBe(20000);
  });

  // C. création d'un sous-compte avec allocation initiale.
  it('C. création d\'un sous-compte avec allocation initiale', async () => {
    const { token } = await freshHousehold();
    const account = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'CIH', openingBalance: '20000' }).expect(201);
    const sub = await http
      .post('/accounts/subaccounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId: account.body.id, name: 'Voiture', initialAllocation: '5000' })
      .expect(201);
    expect(sub.body.balance).toBe(5000);
    expect(sub.body.active).toBe(true);

    const parent = await http.get(`/accounts/${account.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(parent.body.nonAffecte).toBe(15000);
  });

  // D. dépassement du non-affecté refusé.
  it('D. une allocation supérieure au non-affecté disponible est refusée', async () => {
    const { token } = await freshHousehold();
    const account = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'CIH', openingBalance: '20000' }).expect(201);
    await http
      .post('/accounts/subaccounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId: account.body.id, name: 'Voiture', initialAllocation: '25000' })
      .expect(400);
  });

  // E. compte désactivé absent des nouvelles opérations (liste par défaut).
  it('E. un compte désactivé n\'apparaît plus dans la liste par défaut', async () => {
    const { token } = await freshHousehold();
    const account = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'CIH' }).expect(201);

    await http.patch(`/accounts/${account.body.id}`).set('Authorization', `Bearer ${token}`).send({ active: false }).expect(200);

    const defaultList = await http.get('/accounts').set('Authorization', `Bearer ${token}`).expect(200);
    expect(defaultList.body.find((a: any) => a.id === account.body.id)).toBeUndefined();

    const fullList = await http.get('/accounts?includeInactive=true').set('Authorization', `Bearer ${token}`).expect(200);
    const found = fullList.body.find((a: any) => a.id === account.body.id);
    expect(found).toBeDefined();
    expect(found.active).toBe(false);
  });

  // F. historique conservé après désactivation.
  it('F. l\'historique d\'un compte reste consultable après désactivation', async () => {
    const { token } = await freshHousehold();
    const account = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'CIH', openingBalance: '10000' }).expect(201);
    await http.patch(`/accounts/${account.body.id}`).set('Authorization', `Bearer ${token}`).send({ active: false }).expect(200);

    const ops = await http.get(`/financial-operations?accountId=${account.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(ops.body).toHaveLength(1);
    const detail = await http.get(`/accounts/${account.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(detail.body.balance).toBe(10000);
  });

  // G. "Autres" impossible à désactiver/supprimer.
  it('G. la catégorie "Autres" ne peut jamais être désactivée', async () => {
    const { token } = await freshHousehold();
    const categories = await http.get('/categories').set('Authorization', `Bearer ${token}`).expect(200);
    const autres = categories.body.find((c: any) => c.isDefaultFallback);
    expect(autres).toBeDefined();

    await http.delete(`/categories/${autres.id}`).set('Authorization', `Bearer ${token}`).expect(400);
    await http.patch(`/categories/${autres.id}`).set('Authorization', `Bearer ${token}`).send({ active: false }).expect(400);
  });

  // H. invitation foyer — un second utilisateur rejoint via le code.
  it('H. une invitation foyer permet à un second utilisateur de rejoindre', async () => {
    const { token } = await freshHousehold();
    const invite = await http.post('/households/invites').set('Authorization', `Bearer ${token}`).send({}).expect(201);
    expect(invite.body.code).toBeDefined();

    const { token: secondToken } = await freshUser();
    const joined = await http.post('/households/join').set('Authorization', `Bearer ${secondToken}`).send({ code: invite.body.code }).expect(201);
    expect(joined.body.household.id).toBeDefined();

    const memberships = await http.get('/households/memberships').set('Authorization', `Bearer ${joined.body.accessToken}`).expect(200);
    expect(memberships.body.some((m: any) => m.householdId === joined.body.household.id)).toBe(true);
  });

  // I. réinitialisation limitée au foyer concerné (jamais un autre foyer).
  it('I. la réinitialisation ne supprime que les données du foyer concerné', async () => {
    const { token: tokenA } = await freshHousehold();
    const { token: tokenB } = await freshHousehold();

    await http.post('/accounts').set('Authorization', `Bearer ${tokenA}`).send({ name: 'CIH A', openingBalance: '1000' }).expect(201);
    const accountB = await http.post('/accounts').set('Authorization', `Bearer ${tokenB}`).send({ name: 'CIH B', openingBalance: '2000' }).expect(201);

    await http.post('/households/reset').set('Authorization', `Bearer ${tokenA}`).expect(201);

    const accountsA = await http.get('/accounts').set('Authorization', `Bearer ${tokenA}`).expect(200);
    expect(accountsA.body).toEqual([]);
    const categoriesA = await http.get('/categories').set('Authorization', `Bearer ${tokenA}`).expect(200);
    expect(categoriesA.body).toHaveLength(1);
    expect(categoriesA.body[0].isDefaultFallback).toBe(true);

    const accountsB = await http.get('/accounts').set('Authorization', `Bearer ${tokenB}`).expect(200);
    expect(accountsB.body).toHaveLength(1);
    expect(accountsB.body[0].id).toBe(accountB.body.id);
  });

  // J. l'authentification de l'utilisateur survit à une réinitialisation.
  it('J. l\'utilisateur reste authentifié et son foyer intact après réinitialisation', async () => {
    const { token, email } = await freshHousehold();
    await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'CIH', openingBalance: '500' }).expect(201);

    await http.post('/households/reset').set('Authorization', `Bearer ${token}`).expect(201);

    const me = await http.get('/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body.householdId).toBeDefined();

    const login = await http.post('/auth/login').send({ email, password: 'Password123!' }).expect(200);
    expect(login.body.accessToken).toBeDefined();

    const household = await http.get('/households/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(household.body.memberships).toHaveLength(1);
  });
});
