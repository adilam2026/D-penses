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

  // ---------- Panne du service d'email (root cause du bug prod) ----------
  describe('panne du service d\'envoi d\'email (Resend indisponible/mal configuré)', () => {
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

    it("l'inscription réussit malgré tout (jamais 500) même si l'envoi du code échoue — le compte est créé, consultable via Renvoyer le code plus tard", async () => {
      const email = `mailfail+${run}@example.com`;
      const res = await httpFailing.post('/auth/signup').send({ email, password: 'password123', firstName: 'Test', lastName: 'User' }).expect(201);
      expect(res.body).toEqual({ requiresEmailVerification: true, email });

      const user = await prismaFailing.user.findUniqueOrThrow({ where: { email } });
      expect(user.firstName).toBe('Test');
      const otp = await prismaFailing.emailOtp.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
      expect(otp).not.toBeNull(); // le code est bien généré/stocké malgré l'échec d'envoi
    });
  });
});
