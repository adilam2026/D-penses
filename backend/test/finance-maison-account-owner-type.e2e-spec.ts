import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Lot "responsable automatique" — propriétaire STRUCTURÉ d'un compte
 * (ownerType: INDIVIDUAL/SHARED/UNDEFINED + ownerMemberId), jamais déduit
 * d'ownerLabel ni du nom du compte. Invariants validés côté SERVICE, pas
 * seulement côté client : INDIVIDUAL exige ownerMemberId, SHARED/UNDEFINED
 * l'exigent absent — vérifié sur la combinaison RÉSOLUE (merge avec l'état
 * actuel) lors d'un update partiel.
 */
describe('Finance Maison — propriétaire structuré du compte (ownerType/ownerMemberId)', () => {
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

  async function freshHousehold(): Promise<{ token: string; adilId: string }> {
    counter += 1;
    const email = `owner-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Adil', `User${counter}`);
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    const householdToken = res.body.accessToken as string;
    const me = await http.get('/households/me').set('Authorization', `Bearer ${householdToken}`).expect(200);
    const adilId = me.body.memberships[0].id as string;
    return { token: householdToken, adilId };
  }

  async function addSecondMember(adminToken: string): Promise<{ token: string; lamiaaId: string }> {
    const invite = await http.post('/households/invites').set('Authorization', `Bearer ${adminToken}`).send({}).expect(201);
    counter += 1;
    const email = `owner-lamiaa-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Lamiaa', `User${counter}`);
    const joined = await http.post('/households/join').set('Authorization', `Bearer ${token}`).send({ code: invite.body.code }).expect(201);
    const me = await http.get('/households/me').set('Authorization', `Bearer ${joined.body.accessToken}`).expect(200);
    const membership = me.body.memberships.find((m: any) => m.user.email === email);
    return { token: joined.body.accessToken as string, lamiaaId: membership.id as string };
  }

  it('INDIVIDUAL sans ownerMemberId est rejeté (création)', async () => {
    const { token } = await freshHousehold();
    await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'SG Adil', ownerType: 'INDIVIDUAL' }).expect(400);
  });

  it('INDIVIDUAL + membre valide est accepté (création)', async () => {
    const { token, adilId } = await freshHousehold();
    const res = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'SG Adil', ownerType: 'INDIVIDUAL', ownerMemberId: adilId }).expect(201);
    expect(res.body.ownerType).toBe('INDIVIDUAL');
    expect(res.body.ownerMemberId).toBe(adilId);
  });

  it('SHARED + ownerMemberId est rejeté (création)', async () => {
    const { token, adilId } = await freshHousehold();
    await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'Compte commun', ownerType: 'SHARED', ownerMemberId: adilId }).expect(400);
  });

  it('UNDEFINED + ownerMemberId est rejeté (création)', async () => {
    const { token, adilId } = await freshHousehold();
    await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'Compte X', ownerType: 'UNDEFINED', ownerMemberId: adilId }).expect(400);
  });

  it('propriétaire omis à la création -> UNDEFINED par défaut, jamais déduit du nom du compte', async () => {
    const { token } = await freshHousehold();
    const res = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'BP Lamiaa' }).expect(201);
    expect(res.body.ownerType).toBe('UNDEFINED');
    expect(res.body.ownerMemberId).toBeNull();
  });

  it('transitions Adil -> Commun -> Lamiaa -> Non défini, chacune acceptée et cohérente', async () => {
    const { token, adilId } = await freshHousehold();
    const { lamiaaId } = await addSecondMember(token);
    const account = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'Compte', ownerType: 'INDIVIDUAL', ownerMemberId: adilId }).expect(201);

    // Adil -> Commun
    let res = await http.patch(`/accounts/${account.body.id}`).set('Authorization', `Bearer ${token}`).send({ ownerType: 'SHARED', ownerMemberId: null }).expect(200);
    expect(res.body.ownerType).toBe('SHARED');
    expect(res.body.ownerMemberId).toBeNull();

    // Commun -> Lamiaa
    res = await http.patch(`/accounts/${account.body.id}`).set('Authorization', `Bearer ${token}`).send({ ownerType: 'INDIVIDUAL', ownerMemberId: lamiaaId }).expect(200);
    expect(res.body.ownerType).toBe('INDIVIDUAL');
    expect(res.body.ownerMemberId).toBe(lamiaaId);

    // Lamiaa -> Non défini
    res = await http.patch(`/accounts/${account.body.id}`).set('Authorization', `Bearer ${token}`).send({ ownerType: 'UNDEFINED', ownerMemberId: null }).expect(200);
    expect(res.body.ownerType).toBe('UNDEFINED');
    expect(res.body.ownerMemberId).toBeNull();
  });

  it('update partiel incohérent avec l\'état déjà en base est refusé (merge sur la valeur résolue, jamais seulement sur ce qui est envoyé)', async () => {
    const { token, adilId } = await freshHousehold();
    const account = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'SG Adil', ownerType: 'INDIVIDUAL', ownerMemberId: adilId }).expect(201);

    // Envoie SEULEMENT ownerType=SHARED sans vider ownerMemberId -> combinaison résolue incohérente -> refusé.
    await http.patch(`/accounts/${account.body.id}`).set('Authorization', `Bearer ${token}`).send({ ownerType: 'SHARED' }).expect(400);

    // L'état en base n'a pas bougé.
    const refreshed = await http.get(`/accounts/${account.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(refreshed.body.ownerType).toBe('INDIVIDUAL');
    expect(refreshed.body.ownerMemberId).toBe(adilId);
  });

  it('ownerLabel reste un simple libellé libre, jamais lu pour déterminer ownerType', async () => {
    const { token } = await freshHousehold();
    // ownerLabel seul, sans ownerType ni ownerMemberId -> reste UNDEFINED (jamais interprété comme "Commun" ou autre).
    const res = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'Compte', ownerLabel: 'Commun' }).expect(201);
    expect(res.body.ownerType).toBe('UNDEFINED');
    expect(res.body.ownerMemberId).toBeNull();
    expect(res.body.ownerLabel).toBe('Commun');
  });

  it('modification du propriétaire d\'un compte après création : les échéances existantes gardent leur responsibleMemberId (jamais réécrit silencieusement)', async () => {
    const { token, adilId } = await freshHousehold();
    const { lamiaaId } = await addSecondMember(token);
    const account = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'SG Adil', ownerType: 'INDIVIDUAL', ownerMemberId: adilId }).expect(201);

    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'SAVINGS_CONTRIBUTION',
        label: 'Épargne',
        expectedDate: new Date().toISOString().slice(0, 10),
        expectedAmount: '500',
        sourceAccountId: account.body.id,
        destinationAccountId: account.body.id,
        includeInTodo: true,
        responsibleMemberId: adilId,
      })
      .expect(201);

    // Le propriétaire du compte change APRÈS coup.
    await http.patch(`/accounts/${account.body.id}`).set('Authorization', `Bearer ${token}`).send({ ownerType: 'INDIVIDUAL', ownerMemberId: lamiaaId }).expect(200);

    const refreshedPlanned = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body.find((p: any) => p.id === planned.body.id);
    expect(refreshedPlanned.responsibleMemberId).toBe(adilId); // inchangé malgré le nouveau propriétaire du compte
  });
});
