import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Lot 10 — Vérification d'adresse email par code OTP à 6 chiffres (signup →
 * code envoyé → verify-email-otp → session). Mot de passe conservé (cette
 * application n'est pas passwordless) ; aucune session/foyer ne peut exister
 * avant une vérification réelle. Les 11 scénarios ci-dessous couvrent
 * exactement le comportement demandé, adapté à notre pile NestJS/Prisma/JWT
 * (pas de Supabase, pas de deep link, pas de lien cliquable).
 */
describe('Lot 10 — Vérification email par code OTP (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let prisma: PrismaService;
  const run = Date.now();
  const mailer = new FakeMailer();
  const password = 'password123';

  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------- 1 ----------
  it('1. signup envoie un code OTP mais ne renvoie ni accessToken ni refreshToken', async () => {
    const email = `otp1+${run}@example.com`;
    const res = await http.post('/auth/signup').send({ email, password, firstName: 'A', lastName: 'B' }).expect(201);
    expect(res.body).toEqual({ requiresEmailVerification: true, email });
    expect(mailer.lastCodeFor(email)).toMatch(/^\d{6}$/);
  });

  // ---------- 2 ----------
  it("2. aucune session ni action authentifiée n'est possible avant la confirmation de l'email", async () => {
    const email = `otp2+${run}@example.com`;
    await http.post('/auth/signup').send({ email, password, firstName: 'A', lastName: 'B' }).expect(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(0); // aucune session tant que l'email n'est pas confirmé

    // Aucun token n'a été délivré par signup — la création d'un foyer (comme toute
    // route protégée) est donc refusée faute d'Authorization Bearer valide.
    await http.post('/households').send({ name: 'Foyer avant confirmation' }).expect(401);
  });

  // ---------- 3 ----------
  it('3. code OTP valide → session réelle créée (accessToken + refreshToken + Session en base + email_verified_at posé)', async () => {
    const email = `otp3+${run}@example.com`;
    await http.post('/auth/signup').send({ email, password, firstName: 'A', lastName: 'B' }).expect(201);
    const code = mailer.lastCodeFor(email);

    const verified = await http.post('/auth/verify-email-otp').send({ email, code }).expect(200);
    expect(verified.body.accessToken).toBeDefined();
    expect(verified.body.refreshToken).toBeDefined();

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).not.toBeNull();
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
  });

  // ---------- 4 ----------
  it('4. revalider un email déjà confirmé est idempotent : nouvelle session à chaque fois, jamais de double confirmation', async () => {
    const email = `otp4+${run}@example.com`;
    await http.post('/auth/signup').send({ email, password, firstName: 'A', lastName: 'B' }).expect(201);
    const code = mailer.lastCodeFor(email);
    const first = await http.post('/auth/verify-email-otp').send({ email, code }).expect(200);

    const userAfterFirst = await prisma.user.findUniqueOrThrow({ where: { email } });
    const verifiedAtFirst = userAfterFirst.emailVerifiedAt!.getTime();

    // Même code réutilisé après confirmation (double-tap) : pas d'erreur, nouvelle session,
    // date de confirmation jamais réécrite.
    const second = await http.post('/auth/verify-email-otp').send({ email, code }).expect(200);
    expect(second.body.accessToken).toBeDefined();
    // Le refresh token est généré aléatoirement à chaque émission (contrairement à
    // l'access token JWT, déterministe à la seconde près si sub/householdId/iat coïncident).
    expect(second.body.refreshToken).not.toBe(first.body.refreshToken);

    const userAfterSecond = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(userAfterSecond.emailVerifiedAt!.getTime()).toBe(verifiedAtFirst);

    const sessions = await prisma.session.findMany({ where: { userId: userAfterSecond.id } });
    expect(sessions).toHaveLength(2); // une session par appel, aucun compteur de confirmation dupliqué
  });

  // ---------- 5 ----------
  it('5. un code OTP invalide est rejeté avec un message français, jamais une exception technique brute', async () => {
    const email = `otp5+${run}@example.com`;
    await http.post('/auth/signup').send({ email, password, firstName: 'A', lastName: 'B' }).expect(201);

    const res = await http.post('/auth/verify-email-otp').send({ email, code: '000000' }).expect(400);
    expect(res.body.message).toBe('Ce code est invalide ou a expiré');
  });

  // ---------- 6 ----------
  it('6. un code OTP expiré est rejeté (expiration réelle en base via Prisma, jamais simulée côté test)', async () => {
    const email = `otp6+${run}@example.com`;
    await http.post('/auth/signup').send({ email, password, firstName: 'A', lastName: 'B' }).expect(201);
    const code = mailer.lastCodeFor(email);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    // email_otp n'est pas protégée par RLS (comme session) — accès direct légitime ici.
    await prisma.emailOtp.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await http.post('/auth/verify-email-otp').send({ email, code }).expect(400);
    expect(res.body.message).toBe('Ce code est invalide ou a expiré');
  });

  // ---------- 6bis ----------
  it("6bis. après 5 tentatives invalides, le code est bloqué même s'il redevient correct — demande d'un nouveau code requise", async () => {
    const email = `otp6b+${run}@example.com`;
    await http.post('/auth/signup').send({ email, password, firstName: 'A', lastName: 'B' }).expect(201);
    const code = mailer.lastCodeFor(email);

    for (let i = 0; i < 5; i++) {
      await http.post('/auth/verify-email-otp').send({ email, code: '111111' }).expect(400);
    }
    const res = await http.post('/auth/verify-email-otp').send({ email, code }).expect(400);
    expect(res.body.message).toBe('Trop de tentatives — demandez un nouveau code');
  });

  // ---------- 7 ----------
  it("7. renvoyer le code (resend) invalide le précédent et permet de valider avec le nouveau", async () => {
    const email = `otp7+${run}@example.com`;
    await http.post('/auth/signup').send({ email, password, firstName: 'A', lastName: 'B' }).expect(201);
    const firstCode = mailer.lastCodeFor(email);

    await http.post('/auth/resend-email-otp').send({ email }).expect(200);
    const secondCode = mailer.lastCodeFor(email);
    expect(secondCode).toBeDefined();

    // L'ancien code n'est plus valide, même s'il n'a jamais expiré ni été consommé lui-même.
    await http.post('/auth/verify-email-otp').send({ email, code: firstCode }).expect(400);
    await http.post('/auth/verify-email-otp').send({ email, code: secondCode }).expect(200);
  });

  // ---------- 8 ----------
  it("8. un email déjà inscrit mais jamais confirmé peut se réinscrire sans jamais déclencher un conflit « déjà existant »", async () => {
    const email = `otp8+${run}@example.com`;
    await http.post('/auth/signup').send({ email, password: 'password123', firstName: 'Ancien', lastName: 'Nom' }).expect(201);
    const firstCode = mailer.lastCodeFor(email);

    // Deuxième inscription avant toute confirmation : jamais un 409, mot de passe/nom mis à jour.
    await http.post('/auth/signup').send({ email, password: 'newpassword456', firstName: 'Nouveau', lastName: 'Nom' }).expect(201);
    const secondCode = mailer.lastCodeFor(email);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.firstName).toBe('Nouveau'); // profil mis à jour, jamais dupliqué

    // L'ancien code est invalidé par la nouvelle inscription.
    await http.post('/auth/verify-email-otp').send({ email, code: firstCode }).expect(400);
    const verified = await http.post('/auth/verify-email-otp').send({ email, code: secondCode }).expect(200);
    expect(verified.body.accessToken).toBeDefined();

    // Le mot de passe actif est bien le dernier saisi.
    await http.post('/auth/login').send({ email, password: 'newpassword456' }).expect(200);
    await http.post('/auth/login').send({ email, password: 'password123' }).expect(401);
  });

  // ---------- 9 ----------
  it('9. un email déjà confirmé refuse toute réinscription (409) et continue de se connecter normalement par mot de passe', async () => {
    const email = `otp9+${run}@example.com`;
    const token = await signupVerified(http, mailer, email, password, 'A', 'B');
    expect(token).toBeDefined();

    await http.post('/auth/signup').send({ email, password: 'autre-mdp', firstName: 'X', lastName: 'Y' }).expect(409);

    const login = await http.post('/auth/login').send({ email, password }).expect(200);
    expect(login.body.accessToken).toBeDefined();

    // resend-email-otp refuse aussi un compte déjà confirmé (il doit se connecter, pas se reconfirmer).
    const resend = await http.post('/auth/resend-email-otp').send({ email }).expect(400);
    expect(resend.body.message).toBe('Cet email est déjà confirmé — connectez-vous avec votre mot de passe');
  });

  // ---------- 10 ----------
  it("10. après confirmation, l'onboarding reprend immédiatement (création de foyer) avec la session émise par verify-email-otp", async () => {
    const email = `otp10+${run}@example.com`;
    const token = await signupVerified(http, mailer, email, password, 'A', 'B');
    const household = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: 'Foyer post-OTP' }).expect(201);
    expect(household.body.household.name).toBe('Foyer post-OTP');
  });

  // ---------- 11 ----------
  it("11. aucune dépendance à un lien cliquable, une URL localhost ou un deep link — uniquement le code à 6 chiffres saisi dans l'app", async () => {
    const email = `otp11+${run}@example.com`;
    const res = await http.post('/auth/signup').send({ email, password, firstName: 'A', lastName: 'B' }).expect(201);
    expect(JSON.stringify(res.body)).not.toMatch(/https?:\/\/|localhost|:\/\//i);
    expect(res.body).toEqual({ requiresEmailVerification: true, email });

    const code = mailer.lastCodeFor(email);
    expect(code).toMatch(/^\d{6}$/); // uniquement un code à 6 chiffres, jamais un token ni un lien

    const verified = await http.post('/auth/verify-email-otp').send({ email, code }).expect(200);
    expect(JSON.stringify(verified.body)).not.toMatch(/https?:\/\/|localhost/i);
  });
});
