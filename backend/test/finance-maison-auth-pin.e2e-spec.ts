import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { INestApplication, Logger } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { MailerService } from '../src/auth/mailer.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Code personnel à 6 chiffres : transition des anciens mots de passe,
 * déverrouillage serveur, blocage progressif des tentatives, « Code
 * oublié ? » et inscription directe avec un code.
 */
describe('Finance Maison — code personnel à 6 chiffres', () => {
  let app: INestApplication;
  let http: request.Agent;
  let mailer: FakeMailer;
  let prisma: PrismaService;
  let seq = 0;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const LEGACY_PASSWORD = '87654321';
  const PIN = '482913';
  const NEW_PIN = '730518';

  beforeAll(async () => {
    mailer = new FakeMailer();
    app = await createTestApp((builder) => builder.overrideProvider(MailerService).useValue(mailer));
    http = request.agent(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}-${++seq}@test.local`;

  /** Compte avec un code à 6 chiffres déjà défini. */
  async function pinUser(prefix = 'pin', firstName = 'Adil') {
    const email = uniqueEmail(prefix);
    await signupVerified(http, mailer, email, PIN, firstName, 'Test');
    return { email };
  }

  /** Compte existant AVANT cette évolution : ancien mot de passe numérique, pin_set_at NULL. */
  async function legacyUser(prefix = 'legacy', firstName = 'Lamiaa') {
    const { email } = await pinUser(prefix, firstName);
    await prisma.user.update({ where: { email }, data: { passwordHash: await bcrypt.hash(LEGACY_PASSWORD, 12), pinSetAt: null } });
    return { email };
  }

  const login = (email: string, password: string) => http.post('/auth/login').send({ email, password });

  describe('transition des anciens mots de passe', () => {
    it('ancien mot de passe accepté, mustSetPin=true, tout le reste répond 403 PIN_SETUP_REQUIRED', async () => {
      const { email } = await legacyUser();
      const res = await login(email, LEGACY_PASSWORD).expect(200);
      expect(res.body).toEqual(expect.objectContaining({ mustSetPin: true, user: expect.objectContaining({ firstName: 'Lamiaa' }) }));

      const blocked = await http.get('/me').set(bearer(res.body.accessToken)).expect(403);
      expect(blocked.body.code).toBe('PIN_SETUP_REQUIRED');
      const session = await http.get('/auth/session').set(bearer(res.body.accessToken)).expect(200);
      expect(session.body).toEqual({ userId: res.body.user.id, firstName: 'Lamiaa', email, mustSetPin: true });
    });

    it('création du code : ancien mot de passe revérifié, code haché, ancien mot de passe inutilisable, accès rétabli', async () => {
      const { email } = await legacyUser();
      const first = await login(email, LEGACY_PASSWORD).expect(200);

      await http.post('/auth/pin').set(bearer(first.body.accessToken)).send({ currentCredential: '11112222', newPin: NEW_PIN }).expect(401);
      const set = await http.post('/auth/pin').set(bearer(first.body.accessToken)).send({ currentCredential: LEGACY_PASSWORD, newPin: NEW_PIN }).expect(200);
      expect(set.body.mustSetPin).toBe(false);

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.pinSetAt).not.toBeNull();
      expect(user.passwordHash).not.toContain(NEW_PIN);
      expect(await bcrypt.compare(NEW_PIN, user.passwordHash)).toBe(true);

      await http.get('/me').set(bearer(set.body.accessToken)).expect(200);
      await login(email, LEGACY_PASSWORD).expect(401);
      const again = await login(email, NEW_PIN).expect(200);
      expect(again.body.mustSetPin).toBe(false);
    });

    it('utilisateur déjà connecté : sa session ne suffit pas, l’ancien mot de passe est exigé ; les autres sessions sont révoquées', async () => {
      const { email } = await legacyUser();
      const deviceA = await login(email, LEGACY_PASSWORD).expect(200);
      const deviceB = await login(email, LEGACY_PASSWORD).expect(200);

      await http.post('/auth/pin').set(bearer(deviceA.body.accessToken)).send({ newPin: NEW_PIN }).expect(400);
      const set = await http.post('/auth/pin').set(bearer(deviceA.body.accessToken)).send({ currentCredential: LEGACY_PASSWORD, newPin: NEW_PIN }).expect(200);

      await http.post('/auth/refresh').send({ refreshToken: deviceA.body.refreshToken }).expect(401);
      await http.post('/auth/refresh').send({ refreshToken: deviceB.body.refreshToken }).expect(401);
      await http.post('/auth/refresh').send({ refreshToken: set.body.refreshToken }).expect(200);
    });

    it('codes refusés : format autre que 6 chiffres et codes triviaux', async () => {
      const { email } = await legacyUser();
      const { body } = await login(email, LEGACY_PASSWORD).expect(200);
      for (const newPin of ['12345', '1234567', 'abcdef', '12 456']) {
        await http.post('/auth/pin').set(bearer(body.accessToken)).send({ currentCredential: LEGACY_PASSWORD, newPin }).expect(400);
      }
      for (const newPin of ['000000', '111111', '999999', '123456', '654321', '012345', '987654', '345678']) {
        const res = await http.post('/auth/pin').set(bearer(body.accessToken)).send({ currentCredential: LEGACY_PASSWORD, newPin }).expect(400);
        expect(res.body.message).toMatch(/trop simple/);
      }
      expect((await prisma.user.findUniqueOrThrow({ where: { email } })).pinSetAt).toBeNull();
    });
  });

  describe('déverrouillage serveur', () => {
    it('bon code : nouvelle paire de jetons, l’ancien refresh token est révoqué', async () => {
      const { email } = await pinUser();
      const { body } = await login(email, PIN).expect(200);
      const unlocked = await http.post('/auth/unlock').send({ refreshToken: body.refreshToken, pin: PIN }).expect(200);
      expect(unlocked.body).toEqual(expect.objectContaining({ mustSetPin: false, user: expect.objectContaining({ firstName: 'Adil' }) }));
      await http.post('/auth/refresh').send({ refreshToken: body.refreshToken }).expect(401);
      await http.get('/me').set(bearer(unlocked.body.accessToken)).expect(200);
    });

    it('mauvais code, code d’un AUTRE utilisateur, session révoquée : refusés', async () => {
      const adil = await pinUser('adil', 'Adil');
      const lamiaa = await pinUser('lamiaa', 'Lamiaa');
      await prisma.user.update({ where: { email: lamiaa.email }, data: { passwordHash: await bcrypt.hash(NEW_PIN, 12) } });
      const { body } = await login(adil.email, PIN).expect(200);

      expect((await http.post('/auth/unlock').send({ refreshToken: body.refreshToken, pin: '000001' }).expect(401)).body.code).toBe('INVALID_PIN');
      await http.post('/auth/unlock').send({ refreshToken: body.refreshToken, pin: NEW_PIN }).expect(401);

      await http.post('/auth/logout').send({ refreshToken: body.refreshToken }).expect(204);
      const revoked = await http.post('/auth/unlock').send({ refreshToken: body.refreshToken, pin: PIN }).expect(401);
      expect(revoked.body.code).toBe('SESSION_INVALID');
    });
  });

  describe('limitation des tentatives (par compte, en base)', () => {
    async function failTimes(email: string, n: number) {
      for (let i = 0; i < n; i++) await login(email, '000001').expect(401);
    }
    async function expireLock(email: string) {
      await prisma.user.update({ where: { email }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    }
    async function lockSeconds(email: string): Promise<number> {
      const res = await login(email, PIN).expect(429);
      expect(res.body.code).toBe('TOO_MANY_ATTEMPTS');
      return res.body.retryAfterSeconds as number;
    }

    it('5 échecs -> 1 min (même le bon code est refusé), puis 5, 15 et 30 min maximum', async () => {
      const { email } = await pinUser('lock');
      await failTimes(email, 4);
      await login(email, PIN).expect(200); // 4 échecs puis succès : remis à zéro
      await failTimes(email, 5);
      expect(await lockSeconds(email)).toBeGreaterThan(55);
      expect(await lockSeconds(email)).toBeLessThanOrEqual(60);

      const expected = [5 * 60, 15 * 60, 30 * 60, 30 * 60];
      for (const seconds of expected) {
        await expireLock(email);
        await failTimes(email, 5);
        const retry = await lockSeconds(email);
        expect(retry).toBeGreaterThan(seconds - 10);
        expect(retry).toBeLessThanOrEqual(seconds);
      }
    });

    it('un succès remet compteur et niveau à zéro', async () => {
      const { email } = await pinUser('lock-reset');
      await failTimes(email, 5);
      await expireLock(email);
      await login(email, PIN).expect(200);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user).toEqual(expect.objectContaining({ failedLoginCount: 0, lockLevel: 0, lockedUntil: null }));
    });

    it('compteur partagé login + unlock + changement de code ; blocage aussi appliqué au déverrouillage', async () => {
      const { email } = await pinUser('lock-shared');
      const { body } = await login(email, PIN).expect(200);
      await failTimes(email, 2);
      for (let i = 0; i < 2; i++) await http.post('/auth/unlock').send({ refreshToken: body.refreshToken, pin: '000001' }).expect(401);
      await http.post('/auth/pin').set(bearer(body.accessToken)).send({ currentCredential: '000001', newPin: NEW_PIN }).expect(401);
      const res = await http.post('/auth/unlock').send({ refreshToken: body.refreshToken, pin: PIN }).expect(429);
      expect(res.body.code).toBe('TOO_MANY_ATTEMPTS');
    });

    it('email inconnu : réponse générique, aucune erreur', async () => {
      const res = await login(uniqueEmail('inconnu'), PIN).expect(401);
      expect(res.body.message).toBe('Identifiants invalides');
    });
  });

  describe('« Code oublié ? »', () => {
    async function resetFlow(email: string) {
      await http.post('/auth/pin-reset/request').send({ email }).expect(200);
      expect(mailer.sentPurposes.get(email)).toBe('PIN_RESET');
      const verified = await http.post('/auth/pin-reset/verify').send({ email, code: mailer.lastCodeFor(email) }).expect(200);
      return verified.body.resetToken as string;
    }

    it('parcours complet : code email -> nouveau code -> toutes les sessions révoquées, jeton à usage unique', async () => {
      const { email } = await pinUser('reset');
      const old = await login(email, PIN).expect(200);
      const resetToken = await resetFlow(email);

      await http.post('/auth/pin-reset/complete').send({ resetToken, newPin: '111111' }).expect(400);
      const done = await http.post('/auth/pin-reset/complete').send({ resetToken, newPin: NEW_PIN }).expect(200);
      expect(done.body.mustSetPin).toBe(false);
      await http.get('/me').set(bearer(done.body.accessToken)).expect(200);

      await http.post('/auth/refresh').send({ refreshToken: old.body.refreshToken }).expect(401);
      await http.post('/auth/pin-reset/complete').send({ resetToken, newPin: '730519' }).expect(400);
      await login(email, PIN).expect(401);
      await login(email, NEW_PIN).expect(200);
    });

    it('email inconnu ou non confirmé : même réponse, aucun email envoyé', async () => {
      const unknown = uniqueEmail('reset-inconnu');
      expect((await http.post('/auth/pin-reset/request').send({ email: unknown }).expect(200)).body).toEqual({ sent: true });
      expect(mailer.sentCodes.has(unknown)).toBe(false);

      const pending = uniqueEmail('reset-non-confirme');
      await http.post('/auth/signup').send({ email: pending, password: PIN, firstName: 'X', lastName: 'Y' }).expect(201);
      const verificationCode = mailer.lastCodeFor(pending);
      await http.post('/auth/pin-reset/request').send({ email: pending }).expect(200);
      expect(mailer.lastCodeFor(pending)).toBe(verificationCode);
      expect(mailer.sentPurposes.get(pending)).toBe('EMAIL_VERIFICATION');
    });

    it('un code de confirmation d’inscription ne réinitialise jamais le code personnel (usage séparé)', async () => {
      const { email } = await pinUser('reset-usage');
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      await prisma.emailOtp.create({
        data: { userId: user.id, purpose: 'EMAIL_VERIFICATION', codeHash: await bcrypt.hash('246810', 10), expiresAt: new Date(Date.now() + 600_000) },
      });
      await http.post('/auth/pin-reset/verify').send({ email, code: '246810' }).expect(400);
    });

    it('5 mauvais codes email -> demande à refaire ; délai de 10 min pour définir le code', async () => {
      const { email } = await pinUser('reset-limit');
      await http.post('/auth/pin-reset/request').send({ email }).expect(200);
      const good = mailer.lastCodeFor(email);
      const wrong = good === '000000' ? '000001' : '000000';
      for (let i = 0; i < 5; i++) await http.post('/auth/pin-reset/verify').send({ email, code: wrong }).expect(400);
      const res = await http.post('/auth/pin-reset/verify').send({ email, code: good }).expect(400);
      expect(res.body.message).toMatch(/Trop de tentatives/);

      const resetToken = await resetFlow(email);
      await prisma.emailOtp.updateMany({ where: { user: { email }, purpose: 'PIN_RESET', consumedAt: null }, data: { verifiedAt: new Date(Date.now() - 11 * 60_000) } });
      await http.post('/auth/pin-reset/complete').send({ resetToken, newPin: NEW_PIN }).expect(400);
    });

    it('lève un blocage en cours et sert aussi de transition pour un ancien mot de passe', async () => {
      const { email } = await legacyUser('reset-legacy');
      for (let i = 0; i < 5; i++) await login(email, '000001').expect(401);
      await login(email, LEGACY_PASSWORD).expect(429);
      const resetToken = await resetFlow(email);
      await http.post('/auth/pin-reset/complete').send({ resetToken, newPin: NEW_PIN }).expect(200);
      const res = await login(email, NEW_PIN).expect(200);
      expect(res.body.mustSetPin).toBe(false);
    });
  });

  describe('inscription', () => {
    it('crée directement un code à 6 chiffres (8 caractères ou code trivial refusés)', async () => {
      const email = uniqueEmail('signup');
      await http.post('/auth/signup').send({ email, password: '12345678', firstName: 'N', lastName: 'U' }).expect(400);
      await http.post('/auth/signup').send({ email, password: '123456', firstName: 'N', lastName: 'U' }).expect(400);
      await http.post('/auth/signup').send({ email, password: PIN, firstName: 'N', lastName: 'U' }).expect(201);
      const verified = await http.post('/auth/verify-email-otp').send({ email, code: mailer.lastCodeFor(email) }).expect(200);
      expect(verified.body).toEqual(expect.objectContaining({ mustSetPin: false, user: expect.objectContaining({ firstName: 'N' }) }));
      expect((await prisma.user.findUniqueOrThrow({ where: { email } })).pinSetAt).not.toBeNull();
    });

    it('un code de réinitialisation ne confirme jamais une adresse email', async () => {
      const email = uniqueEmail('signup-usage');
      await http.post('/auth/signup').send({ email, password: PIN, firstName: 'N', lastName: 'U' }).expect(201);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      await prisma.emailOtp.updateMany({ where: { userId: user.id }, data: { consumedAt: new Date() } });
      await prisma.emailOtp.create({
        data: { userId: user.id, purpose: 'PIN_RESET', codeHash: await bcrypt.hash('246810', 10), expiresAt: new Date(Date.now() + 600_000) },
      });
      await http.post('/auth/verify-email-otp').send({ email, code: '246810' }).expect(400);
    });
  });

  it('aucun code ni mot de passe dans les journaux', async () => {
    const lines: string[] = [];
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      }),
    );
    try {
      const { email } = await legacyUser('logs');
      await login(email, '13572468').expect(401);
      const { body } = await login(email, LEGACY_PASSWORD).expect(200);
      await http.post('/auth/pin').set(bearer(body.accessToken)).send({ currentCredential: LEGACY_PASSWORD, newPin: NEW_PIN }).expect(200);
      await http.post('/auth/unlock').send({ refreshToken: 'x', pin: NEW_PIN }).expect(401);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    const all = lines.join('\n');
    for (const secret of ['13572468', LEGACY_PASSWORD, NEW_PIN]) expect(all).not.toContain(secret);
  });
});
