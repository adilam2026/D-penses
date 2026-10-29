import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Couleur d'une personne (User.color) — PATCH /households/members/:memberId/color.
 * Palette fixe validée, réservé à un admin du foyer actif (même règle que
 * paramètres / invitations / réinitialisation), membre du MÊME foyer
 * uniquement ; la couleur suit la personne (userId), jamais déduite.
 */
describe('Finance Maison — couleur des membres (User.color)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let mailer: FakeMailer;
  let counter = 0;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    mailer = new FakeMailer();
    app = await createTestApp((builder) => builder.overrideProvider(MailerService).useValue(mailer));
    http = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function signup(prefix: string): Promise<string> {
    counter += 1;
    return signupVerified(http, mailer, `${prefix}-${counter}-${Date.now()}@test.local`, '482913', 'Test', `User${counter}`);
  }

  /** Admin + un 2e membre (rôle choisi) dans le même foyer. */
  async function householdWithMember(role: 'admin' | 'member' | 'read_only' = 'member') {
    const adminSignup = await signup('color-admin');
    const created = await http.post('/households').set(auth(adminSignup)).send({ name: `Foyer ${counter}` }).expect(201);
    const adminToken = created.body.accessToken as string;
    const invite = await http.post('/households/invites').set(auth(adminToken)).send({ role }).expect(201);
    const joined = await http.post('/households/join').set(auth(await signup('color-member'))).send({ code: invite.body.code }).expect(201);
    const memberToken = joined.body.accessToken as string;
    const household = (await http.get('/households/me').set(auth(adminToken)).expect(200)).body;
    const adminMember = household.memberships.find((m: any) => m.role === 'admin');
    const otherMember = household.memberships.find((m: any) => m.id !== adminMember.id);
    return { adminToken, memberToken, adminMember, otherMember, householdId: household.id as string };
  }

  const colorOf = async (token: string, memberId: string) =>
    (await http.get('/households/me').set(auth(token)).expect(200)).body.memberships.find((m: any) => m.id === memberId).user.color;

  it('membres existants sans couleur : null (aucune couleur déduite)', async () => {
    const { adminToken, adminMember, otherMember } = await householdWithMember();
    expect(await colorOf(adminToken, adminMember.id)).toBeNull();
    expect(await colorOf(adminToken, otherMember.id)).toBeNull();
  });

  it("l'admin choisit la couleur de chaque personne ; GET /households/me la renvoie", async () => {
    const { adminToken, memberToken, adminMember, otherMember } = await householdWithMember();
    const res = await http.patch(`/households/members/${adminMember.id}/color`).set(auth(adminToken)).send({ color: 'bleu' }).expect(200);
    expect(res.body).toEqual(expect.objectContaining({ id: adminMember.id, user: expect.objectContaining({ color: 'bleu' }) }));
    await http.patch(`/households/members/${otherMember.id}/color`).set(auth(adminToken)).send({ color: 'rose' }).expect(200);
    expect(await colorOf(adminToken, adminMember.id)).toBe('bleu');
    expect(await colorOf(adminToken, otherMember.id)).toBe('rose');
    // Vu par l'autre membre : mêmes couleurs.
    expect(await colorOf(memberToken, adminMember.id)).toBe('bleu');
    expect(await colorOf(memberToken, otherMember.id)).toBe('rose');
  });

  it('deux personnes peuvent avoir la même couleur (préférence visuelle, pas une contrainte)', async () => {
    const { adminToken, adminMember, otherMember } = await householdWithMember();
    await http.patch(`/households/members/${adminMember.id}/color`).set(auth(adminToken)).send({ color: 'violet' }).expect(200);
    await http.patch(`/households/members/${otherMember.id}/color`).set(auth(adminToken)).send({ color: 'violet' }).expect(200);
    expect(await colorOf(adminToken, otherMember.id)).toBe('violet');
  });

  it('null remet la personne au neutre', async () => {
    const { adminToken, otherMember } = await householdWithMember();
    await http.patch(`/households/members/${otherMember.id}/color`).set(auth(adminToken)).send({ color: 'rose' }).expect(200);
    await http.patch(`/households/members/${otherMember.id}/color`).set(auth(adminToken)).send({ color: null }).expect(200);
    expect(await colorOf(adminToken, otherMember.id)).toBeNull();
  });

  it('palette validée : clé inconnue, couleur hex libre ou champ absent -> 400, rien écrit', async () => {
    const { adminToken, otherMember } = await householdWithMember();
    for (const body of [{ color: 'jaune' }, { color: '#FF0000' }, { color: 'Bleu' }, {}]) {
      await http.patch(`/households/members/${otherMember.id}/color`).set(auth(adminToken)).send(body).expect(400);
    }
    expect(await colorOf(adminToken, otherMember.id)).toBeNull();
  });

  it('non-admin (member ou read_only) : 403, y compris pour sa propre couleur', async () => {
    for (const role of ['member', 'read_only'] as const) {
      const { memberToken, adminToken, adminMember, otherMember } = await householdWithMember(role);
      await http.patch(`/households/members/${otherMember.id}/color`).set(auth(memberToken)).send({ color: 'rose' }).expect(403);
      await http.patch(`/households/members/${adminMember.id}/color`).set(auth(memberToken)).send({ color: 'rose' }).expect(403);
      expect(await colorOf(adminToken, otherMember.id)).toBeNull();
      expect(await colorOf(adminToken, adminMember.id)).toBeNull();
    }
  });

  it("un admin ne peut pas modifier un membre d'un autre foyer (404) ; identifiant invalide -> 400", async () => {
    const a = await householdWithMember();
    const b = await householdWithMember();
    await http.patch(`/households/members/${b.otherMember.id}/color`).set(auth(a.adminToken)).send({ color: 'rose' }).expect(404);
    expect(await colorOf(b.adminToken, b.otherMember.id)).toBeNull();
    await http.patch('/households/members/pas-un-uuid/color').set(auth(a.adminToken)).send({ color: 'rose' }).expect(400);
  });

  it('la couleur appartient à la personne : elle la suit dans un autre foyer', async () => {
    const a = await householdWithMember();
    await http.patch(`/households/members/${a.otherMember.id}/color`).set(auth(a.adminToken)).send({ color: 'turquoise' }).expect(200);
    // Le même utilisateur rejoint un 2e foyer.
    const ownerB = await http.post('/households').set(auth(await signup('color-owner-b'))).send({ name: 'Foyer B' }).expect(201);
    const inviteB = await http.post('/households/invites').set(auth(ownerB.body.accessToken)).send({ role: 'member' }).expect(201);
    const joinedB = await http.post('/households/join').set(auth(a.memberToken)).send({ code: inviteB.body.code }).expect(201);
    const householdB = (await http.get('/households/me').set(auth(joinedB.body.accessToken)).expect(200)).body;
    const same = householdB.memberships.find((m: any) => m.user.id === a.otherMember.user.id);
    expect(same.id).not.toBe(a.otherMember.id);
    expect(same.user.color).toBe('turquoise');
  });
});
