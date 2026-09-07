import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Vague 3 §24/§25/§32 — réinitialisation des données financières (rôle admin
 * réellement existant, mot de passe + confirmation, atomicité, RLS) et
 * onboarding partagé (onboardingSkippedSteps, HouseholdSettings).
 */
describe('Vague 3 — reset données financières & onboarding partagé (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let prisma: PrismaService;
  const run = Date.now();
  let seq = 0;

  const mailer = new FakeMailer();
  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  const PASSWORD = 'password123';

  async function newHousehold() {
    seq += 1;
    const email = `lot14+${run}+${seq}@example.com`;
    const signupToken = await signupVerified(http, mailer, email, PASSWORD, 'L14', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer Vague3 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { accessToken, auth, householdId: household.body.household.id as string, email };
  }

  /** Ajoute un second membre (rôle au choix) au foyer de `owner` via le flux invite/join réel. */
  async function addMember(owner: { auth: () => [string, string] }, role: 'admin' | 'member' | 'read_only') {
    const invite = await http.post('/households/invites').set(...owner.auth()).send({ role }).expect(201);
    seq += 1;
    const email = `lot14+${run}+${seq}@example.com`;
    const signupToken = await signupVerified(http, mailer, email, PASSWORD, 'L14', 'M');
    const joined = await http
      .post('/households/join')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ code: invite.body.code })
      .expect(201);
    const accessToken = joined.body.accessToken as string;
    return { auth: () => ['Authorization', `Bearer ${accessToken}`] as [string, string] };
  }

  async function createAccount(auth: () => [string, string], name: string, initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  async function seedFinancialData(auth: () => [string, string]) {
    const accountId = await createAccount(auth, 'Compte à réinitialiser', 5000);
    const child = await http.post('/children').set(...auth()).send({ firstName: 'Reset', lastName: 'Child' }).expect(201);
    const category = await http.post('/categories').set(...auth()).send({ name: 'Cat reset', kind: 'expense' }).expect(201);
    await http.post('/expenses').set(...auth()).send({ amount: 300, accountId, categoryId: category.body.id }).expect(201);
    return { accountId, childId: child.body.id as string, categoryId: category.body.id as string };
  }

  // ============================================================
  // Reset — rôle, mot de passe, confirmation
  // ============================================================
  describe('Réinitialisation — autorisation et garde-fous', () => {
    it('un membre non-admin (role=member) ne peut PAS réinitialiser les données financières', async () => {
      const owner = await newHousehold();
      const member = await addMember(owner, 'member');
      await seedFinancialData(owner.auth);

      await http.post('/households/reset-financial-data').set(...member.auth()).send({ password: PASSWORD, confirm: true }).expect(403);

      const accounts = await http.get('/accounts').set(...owner.auth()).expect(200);
      expect(accounts.body.length).toBe(1); // rien supprimé
    });

    it('un admin AVEC un mauvais mot de passe est refusé — rien supprimé, transaction annulée', async () => {
      const owner = await newHousehold();
      await seedFinancialData(owner.auth);

      await http.post('/households/reset-financial-data').set(...owner.auth()).send({ password: 'mauvais-mot-de-passe', confirm: true }).expect(401);

      const accounts = await http.get('/accounts').set(...owner.auth()).expect(200);
      const children = await http.get('/children').set(...owner.auth()).expect(200);
      expect(accounts.body.length).toBe(1);
      expect(children.body.length).toBe(1);
    });

    it('un admin SANS confirmation explicite (confirm=false) est refusé — rien supprimé', async () => {
      const owner = await newHousehold();
      await seedFinancialData(owner.auth);

      await http.post('/households/reset-financial-data').set(...owner.auth()).send({ password: PASSWORD, confirm: false }).expect(403);

      const accounts = await http.get('/accounts').set(...owner.auth()).expect(200);
      expect(accounts.body.length).toBe(1);
    });

    it('un admin avec mot de passe correct + confirmation : succès, données financières supprimées, reste conservé', async () => {
      const owner = await newHousehold();
      const { childId, categoryId } = await seedFinancialData(owner.auth);

      await http.post('/households/reset-financial-data').set(...owner.auth()).send({ password: PASSWORD, confirm: true }).expect(201);

      const accounts = await http.get('/accounts').set(...owner.auth()).expect(200);
      expect(accounts.body.length).toBe(0); // supprimé

      const children = await http.get('/children').set(...owner.auth()).expect(200);
      expect(children.body.map((c: { id: string }) => c.id)).toContain(childId); // conservé

      const categories = await http.get('/categories').set(...owner.auth()).expect(200);
      expect(categories.body.map((c: { id: string }) => c.id)).toContain(categoryId); // conservé

      const me = await http.get('/households/me').set(...owner.auth()).expect(200);
      expect(me.body.id).toBeDefined(); // foyer conservé
      expect(me.body.settings).toBeDefined(); // paramètres foyer conservés

      const dashboard = await http.get('/dashboard/summary').set(...owner.auth()).expect(200);
      expect(dashboard.body.operational_treasury).toBe(0); // accueil repasse en état "à configurer"
    });

    it("le foyer d'un autre utilisateur reste totalement intact après le reset du premier foyer (RLS)", async () => {
      const ownerA = await newHousehold();
      const ownerB = await newHousehold();
      await seedFinancialData(ownerA.auth);
      const { accountId: accountB } = await seedFinancialData(ownerB.auth);

      await http.post('/households/reset-financial-data').set(...ownerA.auth()).send({ password: PASSWORD, confirm: true }).expect(201);

      const accountsA = await http.get('/accounts').set(...ownerA.auth()).expect(200);
      const accountsB = await http.get('/accounts').set(...ownerB.auth()).expect(200);
      expect(accountsA.body.length).toBe(0);
      expect(accountsB.body.map((a: { id: string }) => a.id)).toContain(accountB); // foyer B intact
    });

    it('un utilisateur sans foyer actif ne peut pas déclencher de reset (garde HouseholdRequiredGuard)', async () => {
      seq += 1;
      const email = `lot14+${run}+${seq}@example.com`;
      const signupToken = await signupVerified(http, mailer, email, PASSWORD, 'L14', 'NoHH');
      await http
        .post('/households/reset-financial-data')
        .set('Authorization', `Bearer ${signupToken}`)
        .send({ password: PASSWORD, confirm: true })
        .expect(403);
    });
  });

  // ============================================================
  // Onboarding partagé
  // ============================================================
  describe('Onboarding partagé (HouseholdSettings.onboardingSkippedSteps)', () => {
    it('une étape marquée "ignorée" par un membre est visible par un AUTRE membre du même foyer', async () => {
      const owner = await newHousehold();
      const member = await addMember(owner, 'member');

      await http.patch('/households/onboarding/skip').set(...owner.auth()).send({ step: 'children' }).expect(200);

      const me = await http.get('/households/me').set(...member.auth()).expect(200);
      expect(me.body.settings.onboardingSkippedSteps).toContain('children');
    });

    it('marquer deux fois la même étape reste idempotent (pas de doublon)', async () => {
      const owner = await newHousehold();
      await http.patch('/households/onboarding/skip').set(...owner.auth()).send({ step: 'goals' }).expect(200);
      await http.patch('/households/onboarding/skip').set(...owner.auth()).send({ step: 'goals' }).expect(200);

      const me = await http.get('/households/me').set(...owner.auth()).expect(200);
      const occurrences = me.body.settings.onboardingSkippedSteps.filter((s: string) => s === 'goals');
      expect(occurrences.length).toBe(1);
    });

    it("un foyer différent n'est jamais affecté par une étape ignorée d'un autre foyer (RLS)", async () => {
      const ownerA = await newHousehold();
      const ownerB = await newHousehold();
      await http.patch('/households/onboarding/skip').set(...ownerA.auth()).send({ step: 'goals' }).expect(200);

      const meB = await http.get('/households/me').set(...ownerB.auth()).expect(200);
      expect(meB.body.settings.onboardingSkippedSteps).not.toContain('goals');
    });
  });

  // ============================================================
  // Recette téléphone réel §13 — bandeau "Terminer ma configuration" masqué définitivement
  // ============================================================
  describe('Bandeau Accueil (HouseholdSettings.homeBannerDismissed)', () => {
    it('false par défaut à la création du foyer', async () => {
      const owner = await newHousehold();
      const me = await http.get('/households/me').set(...owner.auth()).expect(200);
      expect(me.body.settings.homeBannerDismissed).toBe(false);
    });

    it('PATCH /households/settings {homeBannerDismissed:true} persiste le choix', async () => {
      const owner = await newHousehold();

      await http.patch('/households/settings').set(...owner.auth()).send({ homeBannerDismissed: true }).expect(200);

      const me = await http.get('/households/me').set(...owner.auth()).expect(200);
      expect(me.body.settings.homeBannerDismissed).toBe(true);
    });

    it('le choix est partagé entre tous les membres du foyer, jamais individuel', async () => {
      const owner = await newHousehold();
      const member = await addMember(owner, 'member');

      await http.patch('/households/settings').set(...member.auth()).send({ homeBannerDismissed: true }).expect(200);

      const meOwner = await http.get('/households/me').set(...owner.auth()).expect(200);
      expect(meOwner.body.settings.homeBannerDismissed).toBe(true);
    });

    it("un foyer différent n'est jamais affecté (RLS)", async () => {
      const ownerA = await newHousehold();
      const ownerB = await newHousehold();

      await http.patch('/households/settings').set(...ownerA.auth()).send({ homeBannerDismissed: true }).expect(200);

      const meB = await http.get('/households/me').set(...ownerB.auth()).expect(200);
      expect(meB.body.settings.homeBannerDismissed).toBe(false);
    });
  });
});
