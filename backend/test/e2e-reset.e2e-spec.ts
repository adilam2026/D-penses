import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

const E2E_EMAIL = 'demo@finance-maison.local';

/**
 * POST /e2e/reset — mécanisme de réinitialisation réservé à la recette E2E
 * Maestro (staging uniquement). Toujours inerte (404) hors E2E_TEST_MODE=true,
 * jamais utilisable sans le jeton exact.
 */
describe('Finance Maison — E2E reset (recette Maestro)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let mailer: FakeMailer;

  const originalMode = process.env.E2E_TEST_MODE;
  const originalToken = process.env.E2E_RESET_TOKEN;

  beforeAll(async () => {
    mailer = new FakeMailer();
    app = await createTestApp((builder) => builder.overrideProvider(MailerService).useValue(mailer));
    http = request.agent(app.getHttpServer());
    app.get(PrismaService);
  });

  afterAll(async () => {
    process.env.E2E_TEST_MODE = originalMode;
    process.env.E2E_RESET_TOKEN = originalToken;
    await app.close();
  });

  afterEach(() => {
    process.env.E2E_TEST_MODE = originalMode;
    process.env.E2E_RESET_TOKEN = originalToken;
  });

  it('A. E2E_TEST_MODE absent/non "true" -> 404, quel que soit le jeton', async () => {
    delete process.env.E2E_TEST_MODE;
    process.env.E2E_RESET_TOKEN = 'anything';
    await http.post('/e2e/reset').set('x-e2e-token', 'anything').expect(404);
  });

  it('B. mode actif mais jeton incorrect -> 403', async () => {
    process.env.E2E_TEST_MODE = 'true';
    process.env.E2E_RESET_TOKEN = 'the-real-token';
    await http.post('/e2e/reset').set('x-e2e-token', 'wrong-token').expect(403);
    await http.post('/e2e/reset').expect(403); // aucun header du tout
  });

  it("C. mode actif, jeton correct, mais aucun utilisateur E2E connu -> 404 explicite", async () => {
    process.env.E2E_TEST_MODE = 'true';
    process.env.E2E_RESET_TOKEN = 'the-real-token';
    // Le foyer de démo (demo@finance-maison.local) n'existe pas dans la base de test
    // tant qu'aucun test de cette suite ne l'a créé — vérifié ici en premier.
    const existing = await app.get(PrismaService).user.findUnique({ where: { email: E2E_EMAIL } });
    if (!existing) {
      await http.post('/e2e/reset').set('x-e2e-token', 'the-real-token').expect(404);
    }
  });

  it('D. mode actif + jeton correct + foyer E2E existant -> réinitialise vers le jeu de données de référence', async () => {
    process.env.E2E_TEST_MODE = 'true';
    process.env.E2E_RESET_TOKEN = 'the-real-token';

    const token = await signupVerified(http, mailer, E2E_EMAIL, 'DemoFinanceMaison2026!', 'Lamiaa', 'Demo');
    const household = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: 'Foyer Demo' }).expect(201);
    const householdId = household.body.household.id as string;
    const adminToken = household.body.accessToken as string;

    // Compte "parasite" créé après le foyer — doit disparaître après le reset.
    await http.post('/accounts').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Compte Parasite', openingBalance: '999' }).expect(201);

    const res = await http.post('/e2e/reset').set('x-e2e-token', 'the-real-token').expect(201);
    expect(res.body.householdId).toBe(householdId);
    expect(res.body.email).toBe(E2E_EMAIL);

    const accounts = await http.get('/accounts').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const names: string[] = accounts.body.map((a: any) => a.name);
    expect(names).toHaveLength(6);
    expect(names).toEqual(expect.arrayContaining(['BP Adil', 'BP Épargne', 'BP Lamiaa', 'CIH', 'Épargne 2', 'Épargne Enfants']));
    expect(names).not.toContain('Compte Parasite');

    const cih = accounts.body.find((a: any) => a.name === 'CIH');
    const cihSubaccountNames: string[] = cih.subaccounts.map((s: any) => s.name);
    expect(cihSubaccountNames).toHaveLength(3);
    expect(cihSubaccountNames).toEqual(expect.arrayContaining(['CIH-Santé', 'CIH-Voiture', 'CIH-Voyage']));

    const planned = await http.get('/planned-operations').set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(planned.body.some((p: any) => p.label === 'Voyage Été')).toBe(true);
  });
});
