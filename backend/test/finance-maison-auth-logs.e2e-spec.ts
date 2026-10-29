import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { INestApplication, Logger } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { otpCodes } from '../src/auth/otp-code.util';

/**
 * Aucun secret dans les journaux, à l'exécution : MailerService RÉEL sans
 * fournisseur configuré (RESEND_API_KEY vide en test — le cas où l'ancien
 * comportement journalisait le code), sur tous les parcours d'authentification
 * y compris les échecs. Les codes email sont rendus prévisibles (otpCodes.generate)
 * pour pouvoir les chercher dans les journaux (otpCodes.generate).
 */
describe('Finance Maison — aucun secret dans les journaux', () => {
  let app: INestApplication;
  let http: request.Agent;
  let prisma: PrismaService;
  const lines: string[] = [];
  const spies: jest.SpyInstance[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    http = request.agent(app.getHttpServer());
    prisma = app.get(PrismaService);
    const record = (...args: unknown[]) => {
      lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      spies.push(jest.spyOn(Logger.prototype, level).mockImplementation(record));
    }
    for (const level of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      spies.push(jest.spyOn(console, level).mockImplementation(record));
    }
  });

  afterAll(async () => {
    spies.forEach((s) => s.mockRestore());
    await app.close();
  });

  it('inscription, OTP, connexion, déverrouillage, transition, code oublié, échecs : aucun secret journalisé', async () => {
    const secrets: string[] = [];
    const keep = (...values: (string | undefined)[]) => values.forEach((v) => v && secrets.push(v));
    const otp = jest.spyOn(otpCodes, 'generate');

    const email = `logs-${Date.now()}@test.local`;
    const PIN = '482913';
    const NEW_PIN = '730518';
    const LEGACY = '87654321';
    const RESET_PIN = '205819';
    keep(PIN, NEW_PIN, LEGACY, RESET_PIN);

    // Inscription : code de confirmation 314159 (non envoyé : aucun fournisseur).
    otp.mockReturnValueOnce('314159');
    keep('314159');
    await http.post('/auth/signup').send({ email, password: PIN, firstName: 'Log', lastName: 'Test' }).expect(201);
    await http.post('/auth/verify-email-otp').send({ email, code: '999999' }).expect(400);
    const verified = await http.post('/auth/verify-email-otp').send({ email, code: '314159' }).expect(200);
    keep(verified.body.accessToken, verified.body.refreshToken);

    // Connexion, échec, rafraîchissement, déverrouillage (bon et mauvais code).
    await http.post('/auth/login').send({ email, password: '111112' }).expect(401);
    const logged = await http.post('/auth/login').send({ email, password: PIN }).expect(200);
    keep(logged.body.accessToken, logged.body.refreshToken);
    const refreshed = await http.post('/auth/refresh').send({ refreshToken: logged.body.refreshToken }).expect(200);
    keep(refreshed.body.accessToken, refreshed.body.refreshToken);
    await http.post('/auth/unlock').send({ refreshToken: refreshed.body.refreshToken, pin: '111112' }).expect(401);
    const unlocked = await http.post('/auth/unlock').send({ refreshToken: refreshed.body.refreshToken, pin: PIN }).expect(200);
    keep(unlocked.body.accessToken, unlocked.body.refreshToken);

    // Transition depuis un ancien mot de passe.
    await prisma.user.update({ where: { email }, data: { passwordHash: await bcrypt.hash(LEGACY, 12), pinSetAt: null } });
    const legacy = await http.post('/auth/login').send({ email, password: LEGACY }).expect(200);
    keep(legacy.body.accessToken, legacy.body.refreshToken);
    await http.get('/me').set('Authorization', `Bearer ${legacy.body.accessToken}`).expect(403);
    await http.post('/auth/pin').set('Authorization', `Bearer ${legacy.body.accessToken}`).send({ currentCredential: '12121212', newPin: NEW_PIN }).expect(401);
    const set = await http.post('/auth/pin').set('Authorization', `Bearer ${legacy.body.accessToken}`).send({ currentCredential: LEGACY, newPin: NEW_PIN }).expect(200);
    keep(set.body.accessToken, set.body.refreshToken);

    // Code oublié : code 271828, jeton de réinitialisation, nouveau code.
    otp.mockReturnValueOnce('271828');
    keep('271828');
    await http.post('/auth/pin-reset/request').send({ email }).expect(200);
    await http.post('/auth/pin-reset/verify').send({ email, code: '000001' }).expect(400);
    const reset = await http.post('/auth/pin-reset/verify').send({ email, code: '271828' }).expect(200);
    keep(reset.body.resetToken);
    const done = await http.post('/auth/pin-reset/complete').send({ resetToken: reset.body.resetToken, newPin: RESET_PIN }).expect(200);
    keep(done.body.accessToken, done.body.refreshToken);
    otp.mockRestore();

    expect(lines.length).toBeGreaterThan(0); // les journaux ont bien été capturés
    const all = lines.join('\n');
    const leaked = secrets.filter((secret) => all.includes(secret));
    expect(leaked).toEqual([]);
  });
});
