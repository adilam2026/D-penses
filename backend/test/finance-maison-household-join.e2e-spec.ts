import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * "Rejoindre un foyer" (§9 Finance Maison v1) — le mécanisme (HouseholdsService.join)
 * existait déjà côté backend/mobile (menu "Mes foyers") ; ces tests couvrent
 * explicitement les cas exigés par la recette : code invalide/expiré/déjà
 * utilisé, déjà membre, foyer inexistant, ajout réel du membre, jamais de
 * doublon de foyer.
 */
describe('Finance Maison — Rejoindre un foyer (join via code d\'invitation)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let mailer: FakeMailer;
  let prisma: PrismaService;
  let counter = 0;

  beforeAll(async () => {
    mailer = new FakeMailer();
    app = await createTestApp((builder) => builder.overrideProvider(MailerService).useValue(mailer));
    http = request.agent(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function freshUserWithHousehold(): Promise<{ token: string; householdId: string }> {
    counter += 1;
    const email = `hh-join-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Test', `User${counter}`);
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    return { token: res.body.accessToken as string, householdId: res.body.household.id as string };
  }

  /**
   * Écriture directe hors contexte RLS applicatif (jamais via un endpoint HTTP,
   * qui ne permet pas de forcer une date d'expiration passée) — repositionne le
   * même GUC que RlsContextService.run() le temps de la transaction, exactement
   * comme le ferait une vraie requête pour ce foyer.
   */
  async function expireInvite(inviteId: string, householdId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_household_id', ${householdId}, true)`;
      await tx.householdInvite.update({ where: { id: inviteId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    });
  }

  async function freshUserWithoutHousehold(): Promise<string> {
    counter += 1;
    const email = `hh-joiner-${counter}-${Date.now()}@test.local`;
    return signupVerified(http, mailer, email, 'Password123!', 'Joiner', `User${counter}`);
  }

  it('rejoint un foyer avec un code valide — ajoute le membership et bascule le foyer actif', async () => {
    const owner = await freshUserWithHousehold();
    const invite = await http.post('/households/invites').set('Authorization', `Bearer ${owner.token}`).send({ role: 'member' }).expect(201);

    const joinerToken = await freshUserWithoutHousehold();
    const res = await http.post('/households/join').set('Authorization', `Bearer ${joinerToken}`).send({ code: invite.body.code }).expect(201);

    expect(res.body.household.id).toBe(owner.householdId);
    expect(res.body.accessToken).toBeTruthy();

    const memberships = await http.get('/households/memberships').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    expect(memberships.body).toHaveLength(1);
    expect(memberships.body[0].householdId).toBe(owner.householdId);
    expect(memberships.body[0].isActive).toBe(true);
  });

  it('refuse un code inexistant (jamais rien créé)', async () => {
    const joinerToken = await freshUserWithoutHousehold();
    await http.post('/households/join').set('Authorization', `Bearer ${joinerToken}`).send({ code: 'CODE-INEXISTANT' }).expect(404);
  });

  it('refuse un code expiré', async () => {
    const owner = await freshUserWithHousehold();
    const invite = await http.post('/households/invites').set('Authorization', `Bearer ${owner.token}`).send({ role: 'member' }).expect(201);
    await expireInvite(invite.body.id, owner.householdId);

    const joinerToken = await freshUserWithoutHousehold();
    await http.post('/households/join').set('Authorization', `Bearer ${joinerToken}`).send({ code: invite.body.code }).expect(404);
  });

  it('refuse un code déjà utilisé (double-usage impossible)', async () => {
    const owner = await freshUserWithHousehold();
    const invite = await http.post('/households/invites').set('Authorization', `Bearer ${owner.token}`).send({ role: 'member' }).expect(201);

    const firstJoiner = await freshUserWithoutHousehold();
    await http.post('/households/join').set('Authorization', `Bearer ${firstJoiner}`).send({ code: invite.body.code }).expect(201);

    const secondJoiner = await freshUserWithoutHousehold();
    await http.post('/households/join').set('Authorization', `Bearer ${secondJoiner}`).send({ code: invite.body.code }).expect(404);
  });

  it('refuse de rejoindre un foyer dont on est déjà membre (jamais de doublon)', async () => {
    const owner = await freshUserWithHousehold();
    const invite1 = await http.post('/households/invites').set('Authorization', `Bearer ${owner.token}`).send({ role: 'member' }).expect(201);
    const joinerToken = await freshUserWithoutHousehold();
    const joined = await http.post('/households/join').set('Authorization', `Bearer ${joinerToken}`).send({ code: invite1.body.code }).expect(201);

    // Une deuxième invitation vers le MÊME foyer, tentée par le même utilisateur déjà membre.
    const invite2 = await http.post('/households/invites').set('Authorization', `Bearer ${owner.token}`).send({ role: 'member' }).expect(201);
    await http.post('/households/join').set('Authorization', `Bearer ${joined.body.accessToken}`).send({ code: invite2.body.code }).expect(409);

    const memberships = await http.get('/households/memberships').set('Authorization', `Bearer ${joined.body.accessToken}`).expect(200);
    expect(memberships.body).toHaveLength(1); // toujours un seul membership pour ce foyer, jamais un doublon
  });

  it('un utilisateur déjà rattaché à un foyer peut en rejoindre un second — bascule le foyer actif sans perdre le premier', async () => {
    const firstOwner = await freshUserWithHousehold();
    const secondOwner = await freshUserWithHousehold();
    const invite = await http.post('/households/invites').set('Authorization', `Bearer ${secondOwner.token}`).send({ role: 'member' }).expect(201);

    const memberToken = await freshUserWithoutHousehold();
    await http.post('/households/join').set('Authorization', `Bearer ${memberToken}`).send({ code: invite.body.code }).expect(201);

    // Ce membre rejoint maintenant AUSSI le foyer du premier owner via une nouvelle invitation.
    const inviteToFirst = await http.post('/households/invites').set('Authorization', `Bearer ${firstOwner.token}`).send({ role: 'member' }).expect(201);
    const res = await http.post('/households/join').set('Authorization', `Bearer ${memberToken}`).send({ code: inviteToFirst.body.code }).expect(201);

    const memberships = await http.get('/households/memberships').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    expect(memberships.body).toHaveLength(2);
    expect(memberships.body.filter((m: { isActive: boolean }) => m.isActive)).toHaveLength(1);
    expect(memberships.body.find((m: { householdId: string }) => m.householdId === firstOwner.householdId)?.isActive).toBe(true);
  });
});
