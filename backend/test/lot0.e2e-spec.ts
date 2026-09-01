import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { RlsContextService } from '../src/common/prisma/rls-context.service';

/**
 * Tests Lot 0 (docs/05-roadmap-et-risques.md, "Tests obligatoires").
 * Couvre les 8 scénarios demandés :
 *  1. création d'un utilisateur
 *  2. création d'un foyer
 *  3. invitation / rejoint du deuxième utilisateur
 *  4. création de deux enfants
 *  5. les deux adultes voient les mêmes données du foyer
 *  6. un utilisateur extérieur ne peut jamais lire/modifier les données du foyer
 *  7. suppression / déconnexion / session
 *  8. validation des contraintes de base
 */
describe('Lot 0 — Socle (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let prisma: PrismaService;
  let rls: RlsContextService;
  const run = Date.now(); // suffixe unique pour éviter les collisions d'email entre exécutions

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    rls = app.get(RlsContextService);
  });

  /** `user` n'est pas protégée par RLS — recherche directe possible sans contexte. */
  const userIdByEmail = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

  afterAll(async () => {
    await app.close();
  });

  const emailLamiaa = `lamiaa+${run}@example.com`;
  const emailAdil = `adil+${run}@example.com`;
  const emailStranger = `stranger+${run}@example.com`;
  const password = 'password123';

  let lamiaaAccessToken: string;
  let lamiaaRefreshToken: string;
  let adilAccessToken: string;
  let strangerAccessToken: string;
  let householdId: string;
  let inviteCode: string;
  let waelId: string;
  let dinaId: string;

  // ---------- 1. Création d'un utilisateur ----------
  it('1. crée un utilisateur (signup)', async () => {
    const res = await http
      .post('/auth/signup')
      .send({ email: emailLamiaa, password, firstName: 'Lamiaa', lastName: 'B' })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    lamiaaAccessToken = res.body.accessToken;
    lamiaaRefreshToken = res.body.refreshToken;

    const user = await prisma.user.findUnique({ where: { email: emailLamiaa } });
    expect(user).not.toBeNull();
    expect(user!.passwordHash).not.toBe(password); // jamais en clair
  });

  // ---------- 2. Création d'un foyer ----------
  it('2. crée un foyer et son créateur devient admin', async () => {
    const res = await http
      .post('/households')
      .set('Authorization', `Bearer ${lamiaaAccessToken}`)
      .send({ name: 'Foyer Test Lot0' })
      .expect(201);

    expect(res.body.household.name).toBe('Foyer Test Lot0');
    householdId = res.body.household.id;
    lamiaaAccessToken = res.body.accessToken; // le token est réémis avec le householdId

    const lamiaaId = await userIdByEmail(emailLamiaa);
    const membership = await rls.run(lamiaaId, householdId, () =>
      rls.getClient().householdMembership.findFirst({ where: { householdId, userId: lamiaaId } }),
    );
    expect(membership?.role).toBe('admin');

    // HouseholdSettings créé par défaut (document 02 §C.1)
    const settings = await rls.run(lamiaaId, householdId, () =>
      rls.getClient().householdSettings.findUnique({ where: { householdId } }),
    );
    expect(settings).not.toBeNull();
  });

  // ---------- 3. Invitation / rejoint du deuxième utilisateur ----------
  it("3. crée une invitation puis un deuxième utilisateur rejoint le foyer", async () => {
    const inviteRes = await http
      .post('/households/invites')
      .set('Authorization', `Bearer ${lamiaaAccessToken}`)
      .send({})
      .expect(201);
    inviteCode = inviteRes.body.code;
    expect(inviteCode).toBeDefined();

    const signupRes = await http
      .post('/auth/signup')
      .send({ email: emailAdil, password, firstName: 'Adil', lastName: 'B' })
      .expect(201);
    adilAccessToken = signupRes.body.accessToken;

    const joinRes = await http
      .post('/households/join')
      .set('Authorization', `Bearer ${adilAccessToken}`)
      .send({ code: inviteCode })
      .expect(201);

    expect(joinRes.body.household.id).toBe(householdId);
    adilAccessToken = joinRes.body.accessToken;

    const adilId = await userIdByEmail(emailAdil);
    const membership = await rls.run(adilId, householdId, () =>
      rls.getClient().householdMembership.findFirst({ where: { householdId, userId: adilId } }),
    );
    expect(membership).not.toBeNull();

    // Une invitation déjà utilisée ne peut pas resservir, même avec le token pré-jointure
    // (qui ne porte pas encore le householdId — la garde RG-001 n'intervient donc pas ici,
    // c'est bien le code d'invitation lui-même qui est rejeté comme non disponible).
    await http
      .post('/households/join')
      .set('Authorization', `Bearer ${signupRes.body.accessToken}`)
      .send({ code: inviteCode })
      .expect(404);
  });

  // ---------- 4. Création de deux enfants ----------
  it('4. crée deux enfants du foyer', async () => {
    const wael = await http
      .post('/children')
      .set('Authorization', `Bearer ${lamiaaAccessToken}`)
      .send({ firstName: 'Wael', lastName: 'B' })
      .expect(201);
    waelId = wael.body.id;

    const dina = await http
      .post('/children')
      .set('Authorization', `Bearer ${adilAccessToken}`)
      .send({ firstName: 'Dina', lastName: 'B' })
      .expect(201);
    dinaId = dina.body.id;

    expect(waelId).not.toBe(dinaId);
  });

  // ---------- 5. Les deux adultes voient les mêmes données du foyer ----------
  it('5. les deux adultes voient exactement les mêmes données du foyer', async () => {
    const asLamiaa = await http.get('/households/me').set('Authorization', `Bearer ${lamiaaAccessToken}`).expect(200);
    const asAdil = await http.get('/households/me').set('Authorization', `Bearer ${adilAccessToken}`).expect(200);

    const childNames = (body: any) => body.children.map((c: any) => c.firstName).sort();
    expect(childNames(asLamiaa.body)).toEqual(['Dina', 'Wael']);
    expect(childNames(asAdil.body)).toEqual(childNames(asLamiaa.body));

    const memberEmails = (body: any) => body.memberships.map((m: any) => m.user.email).sort();
    expect(memberEmails(asLamiaa.body)).toEqual([emailAdil, emailLamiaa].sort());
    expect(memberEmails(asAdil.body)).toEqual(memberEmails(asLamiaa.body));
  });

  // ---------- 6. Isolation stricte — utilisateur extérieur ----------
  it('6. un utilisateur extérieur ne peut jamais lire ni modifier les données du foyer', async () => {
    await http.post('/auth/signup').send({ email: emailStranger, password, firstName: 'S', lastName: 'T' }).expect(201);
    const loginRes = await http.post('/auth/login').send({ email: emailStranger, password }).expect(200);
    strangerAccessToken = loginRes.body.accessToken;

    // Sans foyer actif : accès refusé aux routes household-scoped
    await http.get('/households/me').set('Authorization', `Bearer ${strangerAccessToken}`).expect(403);
    await http.get('/children').set('Authorization', `Bearer ${strangerAccessToken}`).expect(403);

    // L'étranger crée son propre foyer, sans lien avec celui de Lamiaa/Adil
    const ownHousehold = await http
      .post('/households')
      .set('Authorization', `Bearer ${strangerAccessToken}`)
      .send({ name: 'Foyer étranger' })
      .expect(201);
    strangerAccessToken = ownHousehold.body.accessToken;

    // Liste ses propres enfants : vide, jamais ceux de l'autre foyer
    const listRes = await http.get('/children').set('Authorization', `Bearer ${strangerAccessToken}`).expect(200);
    expect(listRes.body).toEqual([]);

    // Lecture directe d'un enfant du foyer de Lamiaa/Adil par son id : refusée (application)
    await http.get(`/children/${waelId}`).set('Authorization', `Bearer ${strangerAccessToken}`).expect(404);
    // Modification directe : refusée
    await http
      .patch(`/children/${waelId}`)
      .set('Authorization', `Bearer ${strangerAccessToken}`)
      .send({ firstName: 'Hacked' })
      .expect(404);

    // Preuve indépendante que l'isolation vient bien de PostgreSQL RLS, pas seulement du filtre applicatif :
    // avec le contexte RLS de l'étranger, une requête SQL brute sans clause WHERE ne renvoie aucune ligne
    // hors de son foyer.
    const foreignHouseholdId = householdId;
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', (SELECT id FROM "user" WHERE email = ${emailStranger}), true)`;
      await tx.$executeRaw`SELECT set_config('app.current_household_id', ${ownHousehold.body.household.id}, true)`;
      return tx.$queryRaw<{ id: string }[]>`SELECT id FROM "child" WHERE "household_id" = ${foreignHouseholdId}`;
    });
    expect(rows).toHaveLength(0);

    // L'enfant reste bien intact, jamais modifié par la tentative
    const lamiaaId = await userIdByEmail(emailLamiaa);
    const stillWael = await rls.run(lamiaaId, householdId, () =>
      rls.getClient().child.findUnique({ where: { id: waelId } }),
    );
    expect(stillWael?.firstName).toBe('Wael');
  });

  // ---------- 7. Suppression / déconnexion / session ----------
  it('7. déconnexion : le refresh token révoqué ne peut plus être utilisé', async () => {
    await http.post('/auth/refresh').send({ refreshToken: lamiaaRefreshToken }).expect(200); // fonctionne encore

    const refreshed = await http.post('/auth/refresh').send({ refreshToken: lamiaaRefreshToken }).expect(401); // rotation : l'ancien est déjà révoqué
    expect(refreshed.body.message).toContain('révoqu');

    // logout-all : toutes les sessions de Lamiaa sont révoquées
    const secondLogin = await http.post('/auth/login').send({ email: emailLamiaa, password }).expect(200);
    await http
      .post('/auth/logout-all')
      .set('Authorization', `Bearer ${secondLogin.body.accessToken}`)
      .expect(204);
    await http.post('/auth/refresh').send({ refreshToken: secondLogin.body.refreshToken }).expect(401);
  });

  // ---------- 8. Validation des contraintes de base ----------
  it('8. valide les contraintes de base', async () => {
    // Email déjà utilisé
    await http
      .post('/auth/signup')
      .send({ email: emailAdil, password, firstName: 'X', lastName: 'Y' })
      .expect(409);

    // Mot de passe trop court
    await http
      .post('/auth/signup')
      .send({ email: `short+${run}@example.com`, password: '123', firstName: 'X', lastName: 'Y' })
      .expect(400);

    // Champ requis manquant
    await http.post('/auth/signup').send({ email: `nofn+${run}@example.com`, password }).expect(400);

    // Identifiants invalides au login
    await http.post('/auth/login').send({ email: emailAdil, password: 'wrong-password' }).expect(401);

    // Code d'invitation invalide (utilisateur sans foyer, sinon RG-001 court-circuite avec 409 avant)
    const noHouseholdUser = await http
      .post('/auth/signup')
      .send({ email: `nohh+${run}@example.com`, password, firstName: 'N', lastName: 'H' })
      .expect(201);
    await http
      .post('/households/join')
      .set('Authorization', `Bearer ${noHouseholdUser.body.accessToken}`)
      .send({ code: 'CODE_INEXISTANT' })
      .expect(404);

    // Un membre déjà rattaché à un foyer ne peut pas en rejoindre un second (RG-001)
    await http
      .post('/households/join')
      .set('Authorization', `Bearer ${adilAccessToken}`)
      .send({ code: inviteCode })
      .expect(409);

    // Contrainte d'unicité base : (household_id, user_id) — vérifiée indirectement ci-dessus,
    // et directement ici en tentant un doublon au niveau base (contrainte Prisma @@unique).
    const adilIdForConstraint = await userIdByEmail(emailAdil);
    await expect(
      rls.run(adilIdForConstraint, householdId, () =>
        rls.getClient().householdMembership.create({ data: { householdId, userId: adilIdForConstraint, role: 'member' } }),
      ),
    ).rejects.toThrow();
  });
});
