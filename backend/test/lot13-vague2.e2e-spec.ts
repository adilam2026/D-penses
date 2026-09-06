import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Vague 2 (§21 de la demande) — Catégorie/Type/Sous-type, vue enfant enrichie,
 * taux de couverture du plan (couvert ≠ payé), multi-enveloppes/sous-couverture
 * physique, paiement avec/sans enveloppe/cross-compte/partiel, absence de
 * double comptage foyer. Réutilise exclusivement les moteurs existants
 * (provision.util.ts, treasury.util.ts) — aucune logique dupliquée ici.
 */
describe('Vague 2 — métier transactions/enfants/plans/enveloppes (e2e)', () => {
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

  async function newHousehold() {
    seq += 1;
    const signupToken = await signupVerified(http, mailer, `lot13+${run}+${seq}@example.com`, 'password123', 'L13', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer Vague2 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { accessToken, auth, householdId: household.body.household.id as string };
  }

  async function createAccount(auth: () => [string, string], name: string, initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  async function getAccount(auth: () => [string, string], id: string) {
    const res = await http.get('/accounts').set(...auth()).expect(200);
    return res.body.find((a: { id: string }) => a.id === id);
  }

  async function createCategory(auth: () => [string, string], name: string) {
    const res = await http.post('/categories').set(...auth()).send({ name, kind: 'expense' }).expect(201);
    return res.body.id as string;
  }

  // ============================================================
  // A. Catégorie → Type → Sous-type
  // ============================================================
  describe('A. Catégorie → Type → Sous-type', () => {
    it('un type est filtré par sa catégorie : un type créé pour la catégorie A ne remonte jamais pour la catégorie B', async () => {
      const { auth } = await newHousehold();
      const catA = await createCategory(auth, 'Alimentation locale');
      const catB = await createCategory(auth, 'Transport local');
      await http.post(`/categories/${catA}/types`).set(...auth()).send({ name: 'Courses locales' }).expect(201);
      await http.post(`/categories/${catB}/types`).set(...auth()).send({ name: 'Carburant local' }).expect(201);

      const typesA = await http.get(`/categories/${catA}/types`).set(...auth()).expect(200);
      const typesB = await http.get(`/categories/${catB}/types`).set(...auth()).expect(200);

      expect(typesA.body.map((t: { name: string }) => t.name)).toContain('Courses locales');
      expect(typesA.body.map((t: { name: string }) => t.name)).not.toContain('Carburant local');
      expect(typesB.body.map((t: { name: string }) => t.name)).toContain('Carburant local');
      expect(typesB.body.map((t: { name: string }) => t.name)).not.toContain('Courses locales');
    });

    it('un sous-type est filtré par son type : les sous-types de deux types de la même catégorie ne se mélangent jamais', async () => {
      const { auth } = await newHousehold();
      const cat = await createCategory(auth, 'Alimentation mixte');
      const courses = await http.post(`/categories/${cat}/types`).set(...auth()).send({ name: 'Courses' }).expect(201);
      const restaurant = await http.post(`/categories/${cat}/types`).set(...auth()).send({ name: 'Restaurant' }).expect(201);
      await http.post(`/category-types/${courses.body.id}/subtypes`).set(...auth()).send({ name: 'Viande' }).expect(201);
      await http.post(`/category-types/${restaurant.body.id}/subtypes`).set(...auth()).send({ name: 'Fast-food' }).expect(201);

      const types = await http.get(`/categories/${cat}/types`).set(...auth()).expect(200);
      const coursesRow = types.body.find((t: { id: string }) => t.id === courses.body.id);
      const restaurantRow = types.body.find((t: { id: string }) => t.id === restaurant.body.id);

      expect(coursesRow.subtypes.map((s: { name: string }) => s.name)).toEqual(['Viande']);
      expect(restaurantRow.subtypes.map((s: { name: string }) => s.name)).toEqual(['Fast-food']);
    });

    it('création de type custom : visible immédiatement dans la liste de sa catégorie', async () => {
      const { auth } = await newHousehold();
      const cat = await createCategory(auth, 'Personnel maison test');
      const created = await http.post(`/categories/${cat}/types`).set(...auth()).send({ name: 'Jardinier' }).expect(201);
      expect(created.body.isSystem).toBe(false);
      expect(created.body.active).toBe(true);

      const types = await http.get(`/categories/${cat}/types`).set(...auth()).expect(200);
      expect(types.body.map((t: { name: string }) => t.name)).toContain('Jardinier');
    });

    it("désactivation d'un type sans perte d'historique : une dépense déjà enregistrée garde son type/nom même après désactivation", async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte test', 5000);
      const cat = await createCategory(auth, 'Alimentation désactivation');
      const type = await http.post(`/categories/${cat}/types`).set(...auth()).send({ name: 'Courses désactivables' }).expect(201);

      await http.post('/expenses').set(...auth()).send({ amount: 200, accountId: account, categoryId: cat, categoryTypeId: type.body.id }).expect(201);

      await http.patch(`/category-types/${type.body.id}`).set(...auth()).send({ active: false }).expect(200);

      const txs = await http.get('/transactions').set(...auth()).expect(200);
      const row = txs.body.find((t: { categoryTypeId: string }) => t.categoryTypeId === type.body.id);
      expect(row).toBeDefined();
      expect(row.label).toBe('Courses désactivables'); // toujours affiché malgré la désactivation

      const types = await http.get(`/categories/${cat}/types`).set(...auth()).expect(200);
      const stillThere = types.body.find((t: { id: string }) => t.id === type.body.id);
      expect(stillThere).toBeDefined(); // jamais supprimé, seulement désactivé
      expect(stillThere.active).toBe(false);
    });

    it('transaction avec catégorie + type + sous-type : le libellé affiché devient "Type · Sous-type"', async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte courses', 3000);
      const cat = await createCategory(auth, 'Alimentation complète');
      const type = await http.post(`/categories/${cat}/types`).set(...auth()).send({ name: 'Courses' }).expect(201);
      const subtype = await http.post(`/category-types/${type.body.id}/subtypes`).set(...auth()).send({ name: 'Viande' }).expect(201);

      await http
        .post('/expenses')
        .set(...auth())
        .send({ amount: 500, accountId: account, categoryId: cat, categoryTypeId: type.body.id, categorySubtypeId: subtype.body.id })
        .expect(201);

      const txs = await http.get('/transactions').set(...auth()).expect(200);
      const row = txs.body.find((t: { categorySubtypeId: string }) => t.categorySubtypeId === subtype.body.id);
      expect(row.label).toBe('Courses · Viande');
      expect(row.categoryName).toBe('Alimentation complète');
    });

    it('un type qui ne correspond pas à la catégorie indiquée est refusé (hiérarchie validée)', async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte hiérarchie', 1000);
      const catA = await createCategory(auth, 'Cat A hiérarchie');
      const catB = await createCategory(auth, 'Cat B hiérarchie');
      const typeOfB = await http.post(`/categories/${catB}/types`).set(...auth()).send({ name: 'Type de B' }).expect(201);

      await http
        .post('/expenses')
        .set(...auth())
        .send({ amount: 100, accountId: account, categoryId: catA, categoryTypeId: typeOfB.body.id })
        .expect(400);
    });

    it('un sous-type sans type est refusé', async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte sous-type seul', 1000);
      const cat = await createCategory(auth, 'Cat sous-type seul');
      const type = await http.post(`/categories/${cat}/types`).set(...auth()).send({ name: 'Type parent' }).expect(201);
      const subtype = await http.post(`/category-types/${type.body.id}/subtypes`).set(...auth()).send({ name: 'Sous-type orphelin' }).expect(201);

      await http
        .post('/expenses')
        .set(...auth())
        .send({ amount: 100, accountId: account, categoryId: cat, categorySubtypeId: subtype.body.id })
        .expect(400);
    });
  });

  // ============================================================
  // B. Vue enfant enrichie
  // ============================================================
  describe('B. Vue enfant enrichie (prochaine échéance, plans associés, reste à financer)', () => {
    it('prochaine échéance : la plus proche dueDate ouverte, jamais une échéance déjà soldée', async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte enfant B1', 50000);
      const cat = await createCategory(auth, 'École B1');
      const child = await http.post('/children').set(...auth()).send({ firstName: 'Dina', lastName: 'TAHA' }).expect(201);
      const childId = child.body.id;

      const cpNear = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Uniforme', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01', childIds: [childId] })
        .expect(201);
      const dNear = await http
        .post(`/charge-plans/${cpNear.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-15', amountCurrent: 400, amountStatus: 'confirme' })
        .expect(201);

      const cpFar = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Scolarité T3', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01', childIds: [childId] })
        .expect(201);
      await http
        .post(`/charge-plans/${cpFar.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2027-04-15', amountCurrent: 16350, amountStatus: 'estime' })
        .expect(201);

      const cpPast = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Fournitures', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01', childIds: [childId] })
        .expect(201);
      const dPast = await http
        .post(`/charge-plans/${cpPast.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-01', amountCurrent: 100, amountStatus: 'confirme' })
        .expect(201);
      await http.post(`/deadlines/${dPast.body.id}/payments`).set(...auth()).send({ amount: 100, accountId: account }).expect(201);
      await http.post(`/deadlines/${dPast.body.id}/close`).set(...auth()).expect(201);

      const costs = await http.get(`/children/${childId}/costs`).set(...auth()).expect(200);
      expect(costs.body.prochaineEcheance).not.toBeNull();
      expect(costs.body.prochaineEcheance.deadlineId).toBe(dNear.body.id);
      expect(costs.body.prochaineEcheance.label).toBe('Uniforme');
    });

    it('plans associés : un plan rattaché via ChargePlan.financialPlanId apparaît, sans doublon avec un rattachement bénéficiaire direct', async () => {
      const { auth } = await newHousehold();
      const cat = await createCategory(auth, 'École B2');
      const child = await http.post('/children').set(...auth()).send({ firstName: 'Wael', lastName: 'TAHA' }).expect(201);
      const childId = child.body.id;
      const plan = await http
        .post('/financial-plans')
        .set(...auth())
        .send({ label: 'École 2026/2027', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
        .expect(201);
      const planId = plan.body.id;
      // Rattachement bénéficiaire direct ET via ChargePlan.financialPlanId — ne doit compter qu'une fois.
      await http.post(`/financial-plans/${planId}/beneficiaries`).set(...auth()).send({ beneficiaryType: 'child', childId }).expect(201);
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Scolarité', categoryId: cat, generationMode: 'calendrier_manuel', financialPlanId: planId, startDate: '2026-09-01', childIds: [childId] })
        .expect(201);
      await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-09-30', amountCurrent: 1000, amountStatus: 'confirme' }).expect(201);

      const costs = await http.get(`/children/${childId}/costs`).set(...auth()).expect(200);
      const matches = costs.body.plansAssocies.filter((p: { id: string }) => p.id === planId);
      expect(matches.length).toBe(1); // jamais deux fois pour le même plan
    });

    it('reste à financer soustrait la couverture provision, au prorata attribué à cet enfant', async () => {
      const { auth } = await newHousehold();
      const bp = await createAccount(auth, 'BP reste à financer', 20000);
      const cat = await createCategory(auth, 'École B3');
      const child = await http.post('/children').set(...auth()).send({ firstName: 'Sami', lastName: 'B' }).expect(201);
      const childId = child.body.id;
      const provision = await http
        .post('/provisions')
        .set(...auth())
        .send({ name: 'Provision École B3', allocationMode: 'virtual_allocation', linkedAccountId: bp })
        .expect(201);
      await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 6000 }).expect(201);

      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Scolarité B3', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01', childIds: [childId] })
        .expect(201);
      const d = await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-30', amountCurrent: 10000, amountStatus: 'confirme' })
        .expect(201);
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId: d.body.id }).expect(201);

      const costs = await http.get(`/children/${childId}/costs`).set(...auth()).expect(200);
      expect(costs.body.resteAPayer).toBe(10000);
      expect(costs.body.resteAFinancer).toBe(4000); // 10000 - 6000 couverts par la provision
    });
  });

  // ============================================================
  // C. Taux de couverture du plan — couvert ≠ payé
  // ============================================================
  describe('C. Taux de couverture (§8/§9/§10) — couverture et paiement toujours distincts', () => {
    async function setupPlanWithDeadline(auth: () => [string, string], amount: number) {
      const cat = await createCategory(auth, `Cat couverture ${Math.random()}`);
      const plan = await http
        .post('/financial-plans')
        .set(...auth())
        .send({ label: 'Plan couverture', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
        .expect(201);
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Poste couverture', categoryId: cat, generationMode: 'calendrier_manuel', financialPlanId: plan.body.id, startDate: '2026-09-01' })
        .expect(201);
      const d = await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-30', amountCurrent: amount, amountStatus: 'confirme' })
        .expect(201);
      return { planId: plan.body.id, deadlineId: d.body.id };
    }

    it('taux_couverture est null quand il ne reste plus rien à payer (rien à couvrir)', async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte C1', 10000);
      const { planId, deadlineId } = await setupPlanWithDeadline(auth, 1000);
      await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 1000, accountId: account }).expect(201);

      const plan = await http.get(`/financial-plans/${planId}`).set(...auth()).expect(200);
      expect(plan.body.remainingDue).toBe(0);
      expect(plan.body.tauxCouverture).toBeNull();
    });

    it('taux_couverture = 0% et statut "non_couverte" sans provision liée', async () => {
      const { auth } = await newHousehold();
      const { planId, deadlineId } = await setupPlanWithDeadline(auth, 6000);

      const plan = await http.get(`/financial-plans/${planId}`).set(...auth()).expect(200);
      expect(plan.body.tauxCouverture).toBe(0);
      const line = plan.body.deadlinesCertain.find((d: { id: string }) => d.id === deadlineId);
      expect(line.coverageStatus).toBe('non_couverte');
    });

    it('taux_couverture = 100% et statut "couverte" quand la provision couvre tout — MAIS le paiement reste "ouverte" (couvert ≠ payé)', async () => {
      const { auth } = await newHousehold();
      const bp = await createAccount(auth, 'BP C3', 20000);
      const { planId, deadlineId } = await setupPlanWithDeadline(auth, 3400);
      const provision = await http
        .post('/provisions')
        .set(...auth())
        .send({ name: 'Provision C3', allocationMode: 'virtual_allocation', linkedAccountId: bp })
        .expect(201);
      await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 3400 }).expect(201);
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId }).expect(201);

      const plan = await http.get(`/financial-plans/${planId}`).set(...auth()).expect(200);
      expect(plan.body.tauxCouverture).toBe(100);
      const line = plan.body.deadlinesCertain.find((d: { id: string }) => d.id === deadlineId);
      expect(line.coverageStatus).toBe('couverte');
      // §10 — jamais confondu avec le paiement réel : aucun Payment n'a été créé.
      const deadline = await http.get(`/deadlines/${deadlineId}`).set(...auth()).expect(200);
      expect(deadline.body.financialStatus).toBe('ouverte');
      expect(deadline.body.resteAPayer).toBe(3400);
    });

    it('taux_couverture entre 0 et 100 et statut "partielle" quand la provision ne couvre qu\'une partie (exemple §9 : Scolarité T1 21800 partiellement couverte)', async () => {
      const { auth } = await newHousehold();
      const bp = await createAccount(auth, 'BP C4', 30000);
      const { planId, deadlineId } = await setupPlanWithDeadline(auth, 21800);
      const provision = await http
        .post('/provisions')
        .set(...auth())
        .send({ name: 'Provision C4', allocationMode: 'virtual_allocation', linkedAccountId: bp })
        .expect(201);
      await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 10000 }).expect(201);
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId }).expect(201);

      const plan = await http.get(`/financial-plans/${planId}`).set(...auth()).expect(200);
      const line = plan.body.deadlinesCertain.find((d: { id: string }) => d.id === deadlineId);
      expect(line.coverageStatus).toBe('partielle');
      expect(line.coverageAffectee).toBe(10000);
      expect(line.engagementNonCouvert).toBe(11800);
      expect(plan.body.tauxCouverture).toBeCloseTo((10000 / 21800) * 100, 1);
    });
  });

  // ============================================================
  // D. Multi-enveloppes sur un même compte / sous-couverture physique
  // (scénario exact §14 de la demande)
  // ============================================================
  describe('D. Multi-enveloppes sur le même compte — scénario exact §14', () => {
    it('BP=30000, École=10000/Assurance=4000/Voyage=6000 → réservé=20000, libre=10000 ; puis BP=15000 → manque=5000', async () => {
      const { auth } = await newHousehold();
      const bp = await createAccount(auth, 'BP §14', 30000);
      const ecole = await http.post('/provisions').set(...auth()).send({ name: 'École', allocationMode: 'virtual_allocation', linkedAccountId: bp }).expect(201);
      const assurance = await http.post('/provisions').set(...auth()).send({ name: 'Assurance', allocationMode: 'virtual_allocation', linkedAccountId: bp }).expect(201);
      const voyage = await http.post('/provisions').set(...auth()).send({ name: 'Voyage', allocationMode: 'virtual_allocation', linkedAccountId: bp }).expect(201);
      await http.post(`/provisions/${ecole.body.id}/contribute`).set(...auth()).send({ amount: 10000 }).expect(201);
      await http.post(`/provisions/${assurance.body.id}/contribute`).set(...auth()).send({ amount: 4000 }).expect(201);
      await http.post(`/provisions/${voyage.body.id}/contribute`).set(...auth()).send({ amount: 6000 }).expect(201);

      const afterInitial = await getAccount(auth, bp);
      expect(afterInitial.soldeCourant).toBe(30000);
      expect(afterInitial.reservedByEnvelopes).toBe(20000); // jamais un double comptage des 3 enveloppes

      // Le solde baisse sous le total réservé (ex. un retrait/dépense) — la provision reste inchangée,
      // seule la lecture dérivée "manque" doit refléter l'écart.
      await http.post('/expenses').set(...auth()).send({ amount: 15000, accountId: bp }).expect(201);

      const afterDrop = await getAccount(auth, bp);
      expect(afterDrop.soldeCourant).toBe(15000);
      expect(afterDrop.reservedByEnvelopes).toBe(20000); // les enveloppes ne bougent jamais automatiquement
      expect(afterDrop.reservedByEnvelopes - afterDrop.soldeCourant).toBe(5000); // manque de couverture physique
    });
  });

  // ============================================================
  // E. Paiement avec/sans enveloppe, cross-compte, partiel, pas de double débit
  // ============================================================
  describe('E. Paiement avec/sans enveloppe (§15-18)', () => {
    it('CAS A — paiement avec enveloppe depuis un compte DIFFÉRENT du compte lié à la provision (virtual_allocation)', async () => {
      const { auth } = await newHousehold();
      const cih = await createAccount(auth, 'CIH E1', 10000);
      const bp = await createAccount(auth, 'BP E1', 8000);
      const cat = await createCategory(auth, 'École E1');
      const provision = await http.post('/provisions').set(...auth()).send({ name: 'École E1', allocationMode: 'virtual_allocation', linkedAccountId: cih }).expect(201);
      await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 5000 }).expect(201);

      const cp = await http.post('/charge-plans').set(...auth()).send({ label: 'Frais E1', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' }).expect(201);
      const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-09-30', amountCurrent: 3000, amountStatus: 'confirme' }).expect(201);
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId: d.body.id }).expect(201);

      // Paiement depuis BP (compte différent de CIH, où la provision est localisée) — autorisé en virtual_allocation.
      await http.post(`/deadlines/${d.body.id}/payments`).set(...auth()).send({ amount: 3000, accountId: bp, fundingSource: 'provision', provisionId: provision.body.id }).expect(201);

      const bpAfter = await getAccount(auth, bp);
      const cihAfter = await getAccount(auth, cih);
      expect(bpAfter.soldeCourant).toBe(5000); // 8000 - 3000, un seul débit réel
      expect(cihAfter.soldeCourant).toBe(10000); // CIH physiquement inchangé (§17 CAS A)

      const provisionAfter = await http.get(`/provisions/${provision.body.id}`).set(...auth()).expect(200);
      expect(provisionAfter.body.currentAmount).toBe(2000); // 5000 - 3000
    });

    it('CAS B — paiement SANS enveloppe : la provision liée à la deadline reste totalement inchangée', async () => {
      const { auth } = await newHousehold();
      const cih = await createAccount(auth, 'CIH E2', 10000);
      const bp = await createAccount(auth, 'BP E2', 8000);
      const cat = await createCategory(auth, 'École E2');
      const provision = await http.post('/provisions').set(...auth()).send({ name: 'École E2', allocationMode: 'virtual_allocation', linkedAccountId: cih }).expect(201);
      await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 5000 }).expect(201);

      const cp = await http.post('/charge-plans').set(...auth()).send({ label: 'Frais E2', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' }).expect(201);
      const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-09-30', amountCurrent: 3000, amountStatus: 'confirme' }).expect(201);
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId: d.body.id }).expect(201);

      // Paiement sans enveloppe, depuis BP.
      await http.post(`/deadlines/${d.body.id}/payments`).set(...auth()).send({ amount: 3000, accountId: bp }).expect(201);

      const bpAfter = await getAccount(auth, bp);
      const cihAfter = await getAccount(auth, cih);
      expect(bpAfter.soldeCourant).toBe(5000);
      expect(cihAfter.soldeCourant).toBe(10000);

      const provisionAfter = await http.get(`/provisions/${provision.body.id}`).set(...auth()).expect(200);
      expect(provisionAfter.body.currentAmount).toBe(5000); // jamais entamée par un paiement sans enveloppe (CAS B, §16)
    });

    it('paiement partiel : reste_a_payer recalculé, statut "partiellement_payee", jamais soldée automatiquement', async () => {
      const { auth } = await newHousehold();
      const account = await createAccount(auth, 'Compte partiel', 20000);
      const cat = await createCategory(auth, 'Cat partiel');
      const cp = await http.post('/charge-plans').set(...auth()).send({ label: 'Échéance partielle', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' }).expect(201);
      const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-09-30', amountCurrent: 10000, amountStatus: 'confirme' }).expect(201);

      await http.post(`/deadlines/${d.body.id}/payments`).set(...auth()).send({ amount: 4000, accountId: account }).expect(201);

      const deadline = await http.get(`/deadlines/${d.body.id}`).set(...auth()).expect(200);
      expect(deadline.body.financialStatus).toBe('partiellement_payee');
      expect(deadline.body.resteAPayer).toBe(6000);
    });

    it('pas de double débit : un unique paiement avec enveloppe ne débite le compte qu\'une seule fois', async () => {
      const { auth } = await newHousehold();
      const cih = await createAccount(auth, 'CIH double débit', 10000);
      const cat = await createCategory(auth, 'Cat double débit');
      const provision = await http.post('/provisions').set(...auth()).send({ name: 'Provision double débit', allocationMode: 'virtual_allocation', linkedAccountId: cih }).expect(201);
      await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 5000 }).expect(201);
      const cp = await http.post('/charge-plans').set(...auth()).send({ label: 'Frais double débit', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' }).expect(201);
      const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-09-30', amountCurrent: 2000, amountStatus: 'confirme' }).expect(201);
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId: d.body.id }).expect(201);

      const before = await getAccount(auth, cih);
      await http.post(`/deadlines/${d.body.id}/payments`).set(...auth()).send({ amount: 2000, accountId: cih, fundingSource: 'provision', provisionId: provision.body.id }).expect(201);
      const after = await getAccount(auth, cih);

      expect(before.soldeCourant - after.soldeCourant).toBe(2000); // exactement une fois, jamais 4000
    });
  });

  // ============================================================
  // F. Pas de double comptage foyer (plan multi-enfants)
  // ============================================================
  describe('F. Pas de double comptage foyer — plan avec plusieurs bénéficiaires enfants', () => {
    it('un plan avec 2 enfants bénéficiaires est compté UNE SEULE FOIS dans la liste des plans et au dashboard', async () => {
      const { auth } = await newHousehold();
      const cat = await createCategory(auth, 'École F1');
      const wael = await http.post('/children').set(...auth()).send({ firstName: 'Wael', lastName: 'F' }).expect(201);
      const dina = await http.post('/children').set(...auth()).send({ firstName: 'Dina', lastName: 'F' }).expect(201);
      const plan = await http.post('/financial-plans').set(...auth()).send({ label: 'École commune F1', periodStart: '2026-09-01', periodEnd: '2027-06-30' }).expect(201);
      const planId = plan.body.id;
      await http.post(`/financial-plans/${planId}/beneficiaries`).set(...auth()).send({ beneficiaryType: 'child', childId: wael.body.id }).expect(201);
      await http.post(`/financial-plans/${planId}/beneficiaries`).set(...auth()).send({ beneficiaryType: 'child', childId: dina.body.id }).expect(201);

      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Sorties communes', categoryId: cat, generationMode: 'calendrier_manuel', financialPlanId: planId, startDate: '2026-09-01', childIds: [wael.body.id, dina.body.id] })
        .expect(201);
      await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-10-20', amountCurrent: 1000, amountStatus: 'confirme' }).expect(201);

      const plans = await http.get('/financial-plans').set(...auth()).expect(200);
      const matches = plans.body.filter((p: { id: string }) => p.id === planId);
      expect(matches.length).toBe(1);
      expect(matches[0].knownPlanCost).toBe(1000); // jamais 2000 (une fois par bénéficiaire)

      const dashboard = await http.get('/dashboard/summary').set(...auth()).expect(200);
      const dashMatches = dashboard.body.financialPlansResume.filter((p: { id: string }) => p.id === planId);
      expect(dashMatches.length).toBe(1);
      expect(dashMatches[0].knownPlanCost).toBe(1000);
    });
  });
});
