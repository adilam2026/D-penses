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
 * avant une vérification réelle. Un OTP est strictement à usage unique (TEST
 * A-E ci-dessous) : le premier jet de cette suite laissait un compte déjà
 * confirmé réémettre une session pour N'IMPORTE QUEL code fourni, sans même
 * le vérifier — corrigé (AuthService.verifyEmailOtp), plus jamais de session
 * à partir d'un OTP déjà consommé.
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

  // ================== Usage unique de l'OTP (correctif sécurité) ==================

  // ---------- TEST A ----------
  it('TEST A — OTP valide utilisé une première fois → session créée (accessToken + refreshToken + Session en base)', async () => {
    const email = `otpA+${run}@example.com`;
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

  // ---------- TEST B ----------
  it('TEST B — le même OTP réutilisé après succès ne crée jamais de nouvelle session (double-tap sans rejeu)', async () => {
    const email = `otpB+${run}@example.com`;
    await http.post('/auth/signup').send({ email, password, firstName: 'A', lastName: 'B' }).expect(201);
    const code = mailer.lastCodeFor(email);
    const first = await http.post('/auth/verify-email-otp').send({ email, code }).expect(200);

    const userAfterFirst = await prisma.user.findUniqueOrThrow({ where: { email } });
    const verifiedAtFirst = userAfterFirst.emailVerifiedAt!.getTime();

    // Deuxième appel avec le même code déjà consommé (double-tap) : réponse métier
    // contrôlée « déjà confirmé », jamais une nouvelle session — le client mobile
    // s'appuie sur la session déjà obtenue au premier succès.
    const second = await http.post('/auth/verify-email-otp').send({ email, code }).expect(400);
    expect(second.body.message).toBe('Cet email est déjà confirmé — connectez-vous avec votre mot de passe');
    expect(second.body.accessToken).toBeUndefined();

    const userAfterSecond = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(userAfterSecond.emailVerifiedAt!.getTime()).toBe(verifiedAtFirst); // jamais réécrite

    const sessions = await prisma.session.findMany({ where: { userId: userAfterSecond.id } });
    expect(sessions).toHaveLength(1); // uniquement la session du premier succès
    expect(first.body.accessToken).toBeDefined();
  });

  // ---------- TEST C ----------
  it('TEST C — deux appels concurrents avec le même OTP : un seul consomme le code, jamais deux validations indépendantes', async () => {
    const email = `otpC+${run}@example.com`;
    await http.post('/auth/signup').send({ email, password, firstName: 'A', lastName: 'B' }).expect(201);
    const code = mailer.lastCodeFor(email);

    const [first, second] = await Promise.all([
      http.post('/auth/verify-email-otp').send({ email, code }),
      http.post('/auth/verify-email-otp').send({ email, code }),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 400]); // un seul gagne la course de consommation atomique

    const winner = first.status === 200 ? first : second;
    expect(winner.body.accessToken).toBeDefined();

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).not.toBeNull();
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1); // jamais deux sessions issues du même OTP consommé en concurrence
  });

  // ---------- TEST D ----------
  it('TEST D — resend : ancien OTP immédiatement refusé, nouveau OTP utilisable une seule fois', async () => {
    const email = `otpD+${run}@example.com`;
    await http.post('/auth/signup').send({ email, password, firstName: 'A', lastName: 'B' }).expect(201);
    const firstCode = mailer.lastCodeFor(email);

    await http.post('/auth/resend-email-otp').send({ email }).expect(200);
    const secondCode = mailer.lastCodeFor(email);
    expect(secondCode).toBeDefined();

    await http.post('/auth/verify-email-otp').send({ email, code: firstCode }).expect(400);
    await http.post('/auth/verify-email-otp').send({ email, code: secondCode }).expect(200);
    // Le nouveau code est lui aussi à usage unique une fois consommé.
    await http.post('/auth/verify-email-otp').send({ email, code: secondCode }).expect(400);
  });

  // ---------- TEST E ----------
  it("TEST E — un OTP consommé ne peut jamais être réactivé, même si le raccourci « déjà confirmé » était contourné", async () => {
    const email = `otpE+${run}@example.com`;
    await http.post('/auth/signup').send({ email, password, firstName: 'A', lastName: 'B' }).expect(201);
    const code = mailer.lastCodeFor(email);
    await http.post('/auth/verify-email-otp').send({ email, code }).expect(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const otp = await prisma.emailOtp.findFirstOrThrow({ where: { userId: user.id } });
    expect(otp.consumedAt).not.toBeNull(); // la garantie single-use vit dans consumedAt

    // Simule un contournement du raccourci « email déjà confirmé » (ex. régression future) :
    // même si emailVerifiedAt repassait à NULL, l'OTP consommé reste définitivement
    // inutilisable — la ligne email_otp elle-même ne redevient jamais valide.
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
    const res = await http.post('/auth/verify-email-otp').send({ email, code }).expect(400);
    expect(res.body.message).toBe('Aucun code en attente — demandez un nouveau code');
  });

  // ==================================================================================

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
