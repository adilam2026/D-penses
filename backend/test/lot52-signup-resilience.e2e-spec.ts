import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FakeMailer, withFakeMailer, withFailingMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Corrections UI/UX finales §17 (bug bloquant) — la création de compte
 * échouait en production avec "Erreur interne du serveur" : la cause
 * confirmée est une panne côté service d'envoi d'email (Resend, tiers
 * externe) qui faisait échouer TOUT signup() avec une 500 opaque, alors même
 * que le User avait déjà été créé en base. Cette suite prouve le parcours
 * complet demandé (création → login immédiat) et que l'inscription ne peut
 * plus jamais échouer à cause d'un tiers externe indisponible.
 */
describe('Lot 52 — Résilience création de compte (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let prisma: PrismaService;
  const mailer = new FakeMailer();
  const run = Date.now();

  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------- TEST OBLIGATOIRE (§17) ----------
  it('un utilisateur complètement neuf : création réussie, User créé une seule fois, login possible immédiatement après confirmation, aucune 500', async () => {
    const email = `neuf+${run}@example.com`;
    const res = await http.post('/auth/signup').send({ email, password: 'password123', firstName: 'Test', lastName: 'User' }).expect(201);
    expect(res.body).toEqual({ requiresEmailVerification: true, email });

    const usersWithThisEmail = await prisma.user.findMany({ where: { email } });
    expect(usersWithThisEmail).toHaveLength(1); // jamais créé deux fois

    const token = await signupVerified(http, mailer, `neuf2+${run}@example.com`, 'password123', 'Test', 'User');
    expect(token).toBeDefined();

    // Login possible immédiatement après confirmation, sans étape intermédiaire.
    const login = await http.post('/auth/login').send({ email: `neuf2+${run}@example.com`, password: 'password123' }).expect(200);
    expect(login.body.accessToken).toBeDefined();
    expect(login.body.refreshToken).toBeDefined();
  });

  it('un email déjà existant (compte confirmé) renvoie une erreur métier propre (409), jamais une 500', async () => {
    const email = `dup+${run}@example.com`;
    await signupVerified(http, mailer, email, 'password123', 'Test', 'User');

    const res = await http.post('/auth/signup').send({ email, password: 'autre-mdp-1234', firstName: 'X', lastName: 'Y' }).expect(409);
    expect(res.body.message).toBe('Un compte existe déjà avec cet email');
    expect(res.body.statusCode).toBe(409);
  });

  it('validation DTO : email invalide, mot de passe trop court, champ obligatoire manquant renvoient des 400 explicites (jamais 500)', async () => {
    const emailInvalide = await http.post('/auth/signup').send({ email: 'pas-un-email', password: 'password123', firstName: 'A', lastName: 'B' }).expect(400);
    expect(emailInvalide.body.statusCode).toBe(400);

    const motDePasseCourt = await http
      .post('/auth/signup')
      .send({ email: `court+${run}@example.com`, password: '123', firstName: 'A', lastName: 'B' })
      .expect(400);
    expect(JSON.stringify(motDePasseCourt.body.message)).toMatch(/8 caractères/);

    const champManquant = await http.post('/auth/signup').send({ email: `manquant+${run}@example.com`, password: 'password123', firstName: 'A' }).expect(400);
    expect(champManquant.body.statusCode).toBe(400);
  });

  // ---------- Panne RÉELLE du service d'email (point 2, révision) ----------
  // Corrige un comportement rejeté : l'ancienne version répondait 200/201
  // ("faux succès") même quand Resend refusait réellement l'envoi, laissant
  // l'utilisateur croire à tort qu'un email était en route. Le compte et le
  // code OTP restent créés en base (rien à rejouer), mais la réponse HTTP
  // doit désormais refléter fidèlement l'échec réel du provider.
  describe('panne RÉELLE du provider (Resend configuré mais qui refuse l\'envoi — domaine non vérifié, clé invalide, service indisponible)', () => {
    let appFailing: INestApplication;
    let httpFailing: request.Agent;
    let prismaFailing: PrismaService;

    beforeAll(async () => {
      appFailing = await createTestApp(withFailingMailer());
      httpFailing = request(appFailing.getHttpServer());
      prismaFailing = appFailing.get(PrismaService);
    });

    afterAll(async () => {
      await appFailing.close();
    });

    it("l'inscription renvoie une erreur contrôlée (503, jamais un 201 trompeur) si l'envoi échoue réellement — le compte et le code OTP sont malgré tout créés en base (rien à rejouer)", async () => {
      const email = `mailfail+${run}@example.com`;
      const res = await httpFailing.post('/auth/signup').send({ email, password: 'password123', firstName: 'Test', lastName: 'User' }).expect(503);
      expect(res.body.statusCode).toBe(503);
      expect(res.body.message).toMatch(/Renvoyer le code/);

      // Distinction explicite : le compte ET le code OTP existent bien en base
      // (« OTP créé ») même si l'email n'a jamais été réellement accepté par
      // le provider (« email envoyé » — c'est justement ce qui a échoué).
      const user = await prismaFailing.user.findUniqueOrThrow({ where: { email } });
      expect(user.firstName).toBe('Test');
      const otp = await prismaFailing.emailOtp.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
      expect(otp).not.toBeNull();
    });

    // "Renvoyer le code" doit avoir EXACTEMENT la même garantie que signup()
    // ci-dessus : un nouveau code est généré/persisté (l'ancien invalidé)
    // AVANT la tentative d'envoi, mais si le provider refuse réellement,
    // la réponse HTTP doit le signaler (503), jamais un 200 trompeur.
    it('"Renvoyer le code" renvoie une erreur contrôlée (503) si l\'envoi échoue réellement — un nouveau code est malgré tout généré, l\'ancien invalidé', async () => {
      const email = `resendfail+${run}@example.com`;
      await httpFailing.post('/auth/signup').send({ email, password: 'password123', firstName: 'Test', lastName: 'User' }).expect(503);
      const user = await prismaFailing.user.findUniqueOrThrow({ where: { email } });
      const firstOtp = await prismaFailing.emailOtp.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });

      const res = await httpFailing.post('/auth/resend-email-otp').send({ email }).expect(503);
      expect(res.body.statusCode).toBe(503);

      // L'ancien code est invalidé (consommé) et un nouveau, distinct, est généré
      // malgré l'échec d'envoi signalé à l'appelant.
      const firstOtpAfter = await prismaFailing.emailOtp.findUniqueOrThrow({ where: { id: firstOtp.id } });
      expect(firstOtpAfter.consumedAt).not.toBeNull();
      const liveOtp = await prismaFailing.emailOtp.findFirstOrThrow({ where: { userId: user.id, consumedAt: null }, orderBy: { createdAt: 'desc' } });
      expect(liveOtp.id).not.toBe(firstOtp.id);
    });
  });

  // ---------- RESEND_API_KEY absent (dev local/CI/tests) : jamais bloquant ----------
  // Cas distinct de la panne réelle ci-dessus : quand le provider n'est même
  // pas configuré (comme dans CET environnement de test, cf. .env sans
  // RESEND_API_KEY), MailerService journalise le code au lieu de tenter un
  // envoi — signup()/resendEmailOtp() doivent rester des succès normaux
  // (200/201), exactement le comportement déjà prouvé par les tests
  // "utilisateur complètement neuf" ci-dessus (FakeMailer = même contrat que
  // le mode "non configuré" : jamais d'exception).
});
