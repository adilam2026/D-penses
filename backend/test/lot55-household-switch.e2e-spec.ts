import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { RlsContextService } from '../src/common/prisma/rls-context.service';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Corrections consolidées §16/§17 — deux concepts distincts, jamais mélangés :
 *  - "Rejoindre un foyer" (POST /households/join) : ajoute un NOUVEAU
 *    membership via un code d'invitation, et bascule le foyer actif dessus.
 *  - "Changer de foyer" (POST /households/switch-active) : choisit parmi les
 *    memberships EXISTANTS de l'utilisateur, JAMAIS via invitation.
 * Aucun Household ni HouseholdMembership n'est jamais supprimé par l'un ou
 * l'autre flux — seul le pointeur User.activeHouseholdId change.
 */
describe('Lot 55 — Changement de foyer actif (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let prisma: PrismaService;
  let rls: RlsContextService;
  const run = Date.now();
  const mailer = new FakeMailer();

  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    rls = app.get(RlsContextService);
  });

  afterAll(async () => {
    await app.close();
  });

  const userIdByEmail = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

  /** Décodage JWT sans vérification (payload seul) — suffisant pour lire householdId en test. */
  const decodeHouseholdId = (accessToken: string): string | null => {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
    return payload.householdId ?? null;
  };

  it("A. un utilisateur UNIQUE membre de son foyer peut rejoindre un autre foyer — son membership d'origine n'est jamais supprimé, donc rien à bloquer", async () => {
    const soloEmail = `solo+${run}@example.com`;
    const soloToken = await signupVerified(http, mailer, soloEmail, 'password123', 'Solo', 'S');

    const created = await http.post('/households').set('Authorization', `Bearer ${soloToken}`).send({ name: 'Foyer Solo' }).expect(201);
    const soloHouseholdId = created.body.household.id as string;
    const soloAccessToken = created.body.accessToken as string;

    const targetOwnerToken = await signupVerified(http, mailer, `target-owner+${run}@example.com`, 'password123', 'T', 'O');
    const targetHousehold = await http.post('/households').set('Authorization', `Bearer ${targetOwnerToken}`).send({ name: 'Foyer Cible' }).expect(201);
    const inviteRes = await http
      .post('/households/invites')
      .set('Authorization', `Bearer ${targetHousehold.body.accessToken}`)
      .send({})
      .expect(201);

    const joined = await http
      .post('/households/join')
      .set('Authorization', `Bearer ${soloAccessToken}`)
      .send({ code: inviteRes.body.code })
      .expect(201);
    expect(joined.body.household.id).toBe(targetHousehold.body.household.id);

    const soloId = await userIdByEmail(soloEmail);

    // Le membership d'origine (Foyer Solo, dont il était l'unique membre) existe toujours.
    const originalMembership = await rls.run(soloId, soloHouseholdId, () =>
      rls.getClient().householdMembership.findUnique({ where: { householdId_userId: { householdId: soloHouseholdId, userId: soloId } } }),
    );
    expect(originalMembership).not.toBeNull();

    // Le Foyer Solo lui-même n'a pas été supprimé (lecture RLS : household_membership_visibility
    // expose tout foyer où j'ai un membership, quel que soit le foyer actif de la requête).
    const soloHouseholdStillExists = await rls.run(soloId, null, () => rls.getClient().household.findUnique({ where: { id: soloHouseholdId } }));
    expect(soloHouseholdStillExists).not.toBeNull();

    // Le nouveau membership existe, et le foyer actif a basculé dessus.
    const soloUser = await prisma.user.findUniqueOrThrow({ where: { id: soloId } });
    expect(soloUser.activeHouseholdId).toBe(targetHousehold.body.household.id);
  });

  it("B. un utilisateur avec un foyer PARTAGÉ (≥2 membres) peut changer de foyer actif via une invitation valide, sans mélange ni perte de données", async () => {
    // Foyer A : Owner2 + Member2 (2 membres) — Member2 va changer de foyer actif.
    const owner2Token = await signupVerified(http, mailer, `owner2+${run}@example.com`, 'password123', 'Own', 'Two');
    const householdA = await http.post('/households').set('Authorization', `Bearer ${owner2Token}`).send({ name: 'Foyer A' }).expect(201);
    const inviteA = await http.post('/households/invites').set('Authorization', `Bearer ${householdA.body.accessToken}`).send({}).expect(201);

    const member2Email = `member2+${run}@example.com`;
    const member2PreJoinToken = await signupVerified(http, mailer, member2Email, 'password123', 'Mem', 'Two');
    const joinA = await http
      .post('/households/join')
      .set('Authorization', `Bearer ${member2PreJoinToken}`)
      .send({ code: inviteA.body.code })
      .expect(201);
    const member2InAToken = joinA.body.accessToken as string;
    expect(decodeHouseholdId(member2InAToken)).toBe(householdA.body.household.id);

    // Donnée propre au foyer A, créée par Member2, qui doit rester intacte et invisible depuis B.
    const childInA = await http
      .post('/children')
      .set('Authorization', `Bearer ${member2InAToken}`)
      .send({ firstName: 'EnfantFoyerA', lastName: 'X' })
      .expect(201);

    // Foyer B : un autre foyer, avec invitation valide, que Member2 va rejoindre.
    const owner3Token = await signupVerified(http, mailer, `owner3+${run}@example.com`, 'password123', 'Own', 'Three');
    const householdB = await http.post('/households').set('Authorization', `Bearer ${owner3Token}`).send({ name: 'Foyer B' }).expect(201);
    const inviteB = await http.post('/households/invites').set('Authorization', `Bearer ${householdB.body.accessToken}`).send({}).expect(201);

    const switched = await http
      .post('/households/join')
      .set('Authorization', `Bearer ${member2InAToken}`)
      .send({ code: inviteB.body.code })
      .expect(201);
    expect(switched.body.household.id).toBe(householdB.body.household.id);
    const member2InBToken = switched.body.accessToken as string;
    expect(decodeHouseholdId(member2InBToken)).toBe(householdB.body.household.id);

    const member2Id = await userIdByEmail(member2Email);

    // Le membership dans le foyer A n'a JAMAIS été supprimé.
    const oldMembership = await rls.run(member2Id, householdA.body.household.id, () =>
      rls.getClient().householdMembership.findUnique({
        where: { householdId_userId: { householdId: householdA.body.household.id, userId: member2Id } },
      }),
    );
    expect(oldMembership).not.toBeNull();

    // Le nouveau membership dans le foyer B existe bien.
    const newMembership = await rls.run(member2Id, householdB.body.household.id, () =>
      rls.getClient().householdMembership.findUnique({
        where: { householdId_userId: { householdId: householdB.body.household.id, userId: member2Id } },
      }),
    );
    expect(newMembership).not.toBeNull();

    // Le foyer actif persisté a bien basculé sur B (survit à un futur /auth/refresh).
    const member2User = await prisma.user.findUniqueOrThrow({ where: { id: member2Id } });
    expect(member2User.activeHouseholdId).toBe(householdB.body.household.id);

    // L'enfant du foyer A existe toujours, intact, et n'est PAS visible via le contexte B.
    const childStillInA = await rls.run(member2Id, householdA.body.household.id, () =>
      rls.getClient().child.findUnique({ where: { id: childInA.body.id } }),
    );
    expect(childStillInA?.firstName).toBe('EnfantFoyerA');

    const childrenViaB = await http.get('/children').set('Authorization', `Bearer ${member2InBToken}`).expect(200);
    expect(childrenViaB.body.find((c: any) => c.id === childInA.body.id)).toBeUndefined();

    // GET /households/me avec le nouveau token retourne bien le foyer B, pas A.
    const meB = await http.get('/households/me').set('Authorization', `Bearer ${member2InBToken}`).expect(200);
    expect(meB.body.id).toBe(householdB.body.household.id);

    // Un /auth/refresh ultérieur avec le refresh token de la session B doit rester sur B
    // (preuve que activeHouseholdId persisté empêche toute régression vers le plus ancien membership).
    const refreshed = await http.post('/auth/refresh').send({ refreshToken: switched.body.refreshToken }).expect(200);
    expect(decodeHouseholdId(refreshed.body.accessToken)).toBe(householdB.body.household.id);
  });

  it("C. un utilisateur SANS foyer rejoint normalement (comportement historique inchangé)", async () => {
    const ownerToken = await signupVerified(http, mailer, `owner-c+${run}@example.com`, 'password123', 'O', 'C');
    const household = await http.post('/households').set('Authorization', `Bearer ${ownerToken}`).send({ name: 'Foyer C' }).expect(201);
    const invite = await http.post('/households/invites').set('Authorization', `Bearer ${household.body.accessToken}`).send({}).expect(201);

    const newcomerToken = await signupVerified(http, mailer, `newcomer-c+${run}@example.com`, 'password123', 'N', 'C');
    const joined = await http
      .post('/households/join')
      .set('Authorization', `Bearer ${newcomerToken}`)
      .send({ code: invite.body.code })
      .expect(201);
    expect(joined.body.household.id).toBe(household.body.household.id);
    expect(decodeHouseholdId(joined.body.accessToken)).toBe(household.body.household.id);
  });

  it("D. switch-active permet de revenir sur un foyer déjà membre SANS nouveau code d'invitation, aller-retour A→B→A, JWT correctement scopé à chaque bascule, aucune donnée croisée", async () => {
    // Foyer D1 : Owner4 + Member4 (2 membres, évite tout garde-fou résiduel).
    const owner4Token = await signupVerified(http, mailer, `owner4+${run}@example.com`, 'password123', 'Own', 'Four');
    const householdD1 = await http.post('/households').set('Authorization', `Bearer ${owner4Token}`).send({ name: 'Foyer D1' }).expect(201);
    const inviteD1 = await http.post('/households/invites').set('Authorization', `Bearer ${householdD1.body.accessToken}`).send({}).expect(201);

    const member4Email = `member4+${run}@example.com`;
    const member4PreJoinToken = await signupVerified(http, mailer, member4Email, 'password123', 'Mem', 'Four');
    const joinD1 = await http
      .post('/households/join')
      .set('Authorization', `Bearer ${member4PreJoinToken}`)
      .send({ code: inviteD1.body.code })
      .expect(201);
    let member4Token = joinD1.body.accessToken as string;
    expect(decodeHouseholdId(member4Token)).toBe(householdD1.body.household.id);

    // Donnée propre à D1, créée par Member4.
    const childInD1 = await http
      .post('/children')
      .set('Authorization', `Bearer ${member4Token}`)
      .send({ firstName: 'EnfantD1', lastName: 'X' })
      .expect(201);

    // Foyer D2 : Member4 le rejoint via invitation (crée le second membership).
    const owner5Token = await signupVerified(http, mailer, `owner5+${run}@example.com`, 'password123', 'Own', 'Five');
    const householdD2 = await http.post('/households').set('Authorization', `Bearer ${owner5Token}`).send({ name: 'Foyer D2' }).expect(201);
    const inviteD2 = await http.post('/households/invites').set('Authorization', `Bearer ${householdD2.body.accessToken}`).send({}).expect(201);
    const joinD2 = await http.post('/households/join').set('Authorization', `Bearer ${member4Token}`).send({ code: inviteD2.body.code }).expect(201);
    member4Token = joinD2.body.accessToken as string;
    expect(decodeHouseholdId(member4Token)).toBe(householdD2.body.household.id);

    // Donnée propre à D2.
    const childInD2 = await http
      .post('/children')
      .set('Authorization', `Bearer ${member4Token}`)
      .send({ firstName: 'EnfantD2', lastName: 'Y' })
      .expect(201);

    // GET /households/memberships liste bien les DEUX foyers, avec D2 marqué actif.
    const memberships = await http.get('/households/memberships').set('Authorization', `Bearer ${member4Token}`).expect(200);
    expect(memberships.body).toHaveLength(2);
    const byId = (id: string) => memberships.body.find((m: any) => m.householdId === id);
    expect(byId(householdD1.body.household.id)).toMatchObject({ isActive: false });
    expect(byId(householdD2.body.household.id)).toMatchObject({ isActive: true });

    // Retour sur D1 SANS code d'invitation — via switch-active uniquement.
    const switchBackToD1 = await http
      .post('/households/switch-active')
      .set('Authorization', `Bearer ${member4Token}`)
      .send({ householdId: householdD1.body.household.id })
      .expect(201);
    expect(switchBackToD1.body.household.id).toBe(householdD1.body.household.id);
    member4Token = switchBackToD1.body.accessToken as string;
    expect(decodeHouseholdId(member4Token)).toBe(householdD1.body.household.id);

    // Les données de D1 sont bien visibles à nouveau, celles de D2 ne le sont plus.
    const childrenViaD1 = await http.get('/children').set('Authorization', `Bearer ${member4Token}`).expect(200);
    expect(childrenViaD1.body.map((c: any) => c.id)).toContain(childInD1.body.id);
    expect(childrenViaD1.body.map((c: any) => c.id)).not.toContain(childInD2.body.id);

    // Un /auth/refresh après ce switch-active reste bien scopé sur D1 (persistance confirmée).
    const refreshedOnD1 = await http.post('/auth/refresh').send({ refreshToken: switchBackToD1.body.refreshToken }).expect(200);
    expect(decodeHouseholdId(refreshedOnD1.body.accessToken)).toBe(householdD1.body.household.id);

    // Nouvel aller vers D2 via switch-active (toujours sans invitation).
    const switchToD2Again = await http
      .post('/households/switch-active')
      .set('Authorization', `Bearer ${member4Token}`)
      .send({ householdId: householdD2.body.household.id })
      .expect(201);
    expect(decodeHouseholdId(switchToD2Again.body.accessToken)).toBe(householdD2.body.household.id);
    const childrenViaD2 = await http.get('/children').set('Authorization', `Bearer ${switchToD2Again.body.accessToken}`).expect(200);
    expect(childrenViaD2.body.map((c: any) => c.id)).toContain(childInD2.body.id);
    expect(childrenViaD2.body.map((c: any) => c.id)).not.toContain(childInD1.body.id);

    // Aucun Household ni HouseholdMembership n'a jamais été supprimé par ces aller-retours.
    const member4Id = await userIdByEmail(member4Email);
    expect(await rls.run(member4Id, null, () => rls.getClient().household.findUnique({ where: { id: householdD1.body.household.id } }))).not.toBeNull();
    expect(await rls.run(member4Id, null, () => rls.getClient().household.findUnique({ where: { id: householdD2.body.household.id } }))).not.toBeNull();
    const membershipD1 = await rls.run(member4Id, householdD1.body.household.id, () =>
      rls.getClient().householdMembership.findUnique({ where: { householdId_userId: { householdId: householdD1.body.household.id, userId: member4Id } } }),
    );
    const membershipD2 = await rls.run(member4Id, householdD2.body.household.id, () =>
      rls.getClient().householdMembership.findUnique({ where: { householdId_userId: { householdId: householdD2.body.household.id, userId: member4Id } } }),
    );
    expect(membershipD1).not.toBeNull();
    expect(membershipD2).not.toBeNull();
  });

  it("E. switch-active refuse un foyer dont l'utilisateur n'est PAS membre (404), sans jamais créer de membership", async () => {
    const ownerEToken = await signupVerified(http, mailer, `ownere+${run}@example.com`, 'password123', 'O', 'E');
    const householdE = await http.post('/households').set('Authorization', `Bearer ${ownerEToken}`).send({ name: 'Foyer E' }).expect(201);

    const strangerToken = await signupVerified(http, mailer, `strangere+${run}@example.com`, 'password123', 'S', 'E');
    const strangerHousehold = await http.post('/households').set('Authorization', `Bearer ${strangerToken}`).send({ name: 'Foyer Stranger E' }).expect(201);

    await http
      .post('/households/switch-active')
      .set('Authorization', `Bearer ${strangerHousehold.body.accessToken}`)
      .send({ householdId: householdE.body.household.id })
      .expect(404);

    const strangerId = await userIdByEmail(`strangere+${run}@example.com`);
    const noMembership = await rls.run(strangerId, householdE.body.household.id, () =>
      rls.getClient().householdMembership.findUnique({ where: { householdId_userId: { householdId: householdE.body.household.id, userId: strangerId } } }),
    );
    expect(noMembership).toBeNull();
  });
});
