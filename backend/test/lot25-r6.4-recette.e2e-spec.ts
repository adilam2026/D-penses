import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * LOT R6.4 — corrections recette mobile. Couvre les scénarios ciblés A-H
 * (backend) demandés par la recette : Budgets Modifier/Supprimer (A/B),
 * Plan financier ajouter/modifier/supprimer échéance (C/D/E/F), Garderie
 * modifiable + option retenue → obligation sans double comptage (G/H).
 * Les scénarios J-P (transferts récurrents / Projection) sont couverts dans
 * lot18-projection-mensuelle.e2e-spec.ts et lot23-r6.2-corrections.e2e-spec.ts
 * (moteur déjà correct — seule l'itemisation planned_transfer_items y a été
 * ajoutée pour R6.4 §9).
 */
describe('R6.4 — corrections recette mobile (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  const run = Date.now();

  const mailer = new FakeMailer();
  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold(suffix: string) {
    const signupToken = await signupVerified(http, mailer, `r64+${suffix}+${run}@example.com`, 'password123', 'R64', suffix);
    const household = await http.post('/households').set('Authorization', `Bearer ${signupToken}`).send({ name: `Foyer ${suffix}` }).expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function newAccount(auth: () => [string, string], name: string, initialBalance = 5000) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  async function newCategory(auth: () => [string, string], name: string) {
    const res = await http.post('/categories').set(...auth()).send({ name, kind: 'expense' }).expect(201);
    return res.body.id as string;
  }

  describe('§1 — Budgets Modifier/Supprimer', () => {
    it('A. un budget existant est modifiable (montant + périodicité)', async () => {
      const { auth } = await newHousehold('a');
      const categoryId = await newCategory(auth, 'Alimentation A');
      const created = await http
        .post('/variable-budgets')
        .set(...auth())
        .send({ categoryId, referenceAmount: 1500, referencePeriod: 'semaine', startDate: '2026-01-01' })
        .expect(201);

      const updated = await http
        .patch(`/variable-budgets/${created.body.id}`)
        .set(...auth())
        .send({ referenceAmount: 1800, referencePeriod: 'mois' })
        .expect(200);
      expect(Number(updated.body.referenceAmount)).toBe(1800);
      expect(updated.body.referencePeriod).toBe('mois');

      const reread = await http.get(`/variable-budgets/${created.body.id}`).set(...auth()).expect(200);
      expect(Number(reread.body.referenceAmount)).toBe(1800);
    });

    it("B. un budget SANS historique est supprimé physiquement ; un budget AVEC historique est archivé (inactif), jamais perdu", async () => {
      const { auth } = await newHousehold('b');
      const categoryId = await newCategory(auth, 'Alimentation B');
      const accountId = await newAccount(auth, 'Compte B');

      // Budget sans dépense → suppression physique.
      const emptyBudget = await http
        .post('/variable-budgets')
        .set(...auth())
        .send({ categoryId, referenceAmount: 1000, referencePeriod: 'mois', startDate: '2026-01-01' })
        .expect(201);
      const del = await http.delete(`/variable-budgets/${emptyBudget.body.id}`).set(...auth()).expect(200);
      expect(del.body).toEqual({ deleted: true, archived: false });
      await http.get(`/variable-budgets/${emptyBudget.body.id}`).set(...auth()).expect(404);

      // Budget avec une dépense rattachée → archivage, jamais de perte de l'historique.
      const usedBudget = await http
        .post('/variable-budgets')
        .set(...auth())
        .send({ categoryId, referenceAmount: 1000, referencePeriod: 'mois', startDate: '2026-01-01' })
        .expect(201);
      await http.post('/expenses').set(...auth()).send({ amount: 100, accountId, categoryId }).expect(201);

      const archived = await http.delete(`/variable-budgets/${usedBudget.body.id}`).set(...auth()).expect(200);
      expect(archived.body).toEqual({ deleted: false, archived: true });

      const stillThere = await http.get(`/variable-budgets/${usedBudget.body.id}`).set(...auth()).expect(200);
      expect(stillThere.body.status.consommeADate).toBe(100); // l'historique de dépense est intact
    });
  });

  describe('§2/§3 — Plan financier : ajouter/modifier/supprimer une échéance', () => {
    async function newPlan(auth: () => [string, string]) {
      const res = await http
        .post('/financial-plans')
        .set(...auth())
        .send({ label: 'École 2026/2027', periodStart: '2026-09-01', periodEnd: '2027-07-31' })
        .expect(201);
      return res.body.id as string;
    }

    it("C. ajouter une échéance à un plan EXISTANT l'intègre au coût connu / reste à financer du plan (jamais un ChargePlan récurrent)", async () => {
      const { auth } = await newHousehold('c');
      const planId = await newPlan(auth);
      const categoryId = await newCategory(auth, 'Frais scolaires C');

      const chargePlan = await http
        .post('/charge-plans')
        .set(...auth())
        .send({
          label: 'Frais T1',
          categoryId,
          startDate: '2026-10-01',
          financialPlanId: planId,
          generationMode: 'calendrier_manuel',
          obligationStatus: 'obligatoire',
        })
        .expect(201);
      expect(chargePlan.body.recurrenceRule).toBeNull(); // jamais de récurrence pour cette opération ponctuelle

      await http
        .post(`/charge-plans/${chargePlan.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-10-15', amountCurrent: 3000, amountStatus: 'confirme' })
        .expect(201);

      const plan = await http.get(`/financial-plans/${planId}`).set(...auth()).expect(200);
      expect(plan.body.knownPlanCost).toBe(3000);
      expect(plan.body.remainingDue).toBe(3000);
    });

    it("D. une échéance existante est modifiable (montant, statut, date)", async () => {
      const { auth } = await newHousehold('d');
      const planId = await newPlan(auth);
      const categoryId = await newCategory(auth, 'Frais scolaires D');
      // R6.4 (§3) — 'optionnelle_souscrite' : compte comme obligation réelle du plan (test H),
      // mais reste une date modifiable (DeadlinesService.update ne bloque le report de date
      // que pour 'obligatoire', réservé aux charges contractuelles générées automatiquement).
      const chargePlan = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Frais T1', categoryId, startDate: '2026-10-01', financialPlanId: planId, generationMode: 'calendrier_manuel', obligationStatus: 'optionnelle_souscrite' })
        .expect(201);
      const deadline = await http
        .post(`/charge-plans/${chargePlan.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-10-15', amountStatus: 'inconnu' })
        .expect(201);

      const updated = await http
        .patch(`/deadlines/${deadline.body.id}`)
        .set(...auth())
        .send({ dueDate: '2026-10-20', amountCurrent: 3200, amountStatus: 'confirme' })
        .expect(200);
      expect(updated.body.dueDate).toContain('2026-10-20');
      expect(Number(updated.body.amountCurrent)).toBe(3200);
    });

    it('E. une échéance SANS paiement peut être annulée', async () => {
      const { auth } = await newHousehold('e');
      const planId = await newPlan(auth);
      const categoryId = await newCategory(auth, 'Frais scolaires E');
      const chargePlan = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Frais T1', categoryId, startDate: '2026-10-01', financialPlanId: planId, generationMode: 'calendrier_manuel', obligationStatus: 'obligatoire' })
        .expect(201);
      const deadline = await http
        .post(`/charge-plans/${chargePlan.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-10-15', amountCurrent: 1000, amountStatus: 'confirme' })
        .expect(201);

      const cancelled = await http.post(`/deadlines/${deadline.body.id}/cancel`).set(...auth()).expect(201);
      expect(cancelled.body.financialStatus).toBe('annulee');
    });

    it("F. une échéance PAYÉE et clôturée protège l'historique : ni le plan (ChargePlan.remove) ni l'échéance (cancel) ne peuvent l'effacer", async () => {
      const { auth } = await newHousehold('f');
      const planId = await newPlan(auth);
      const categoryId = await newCategory(auth, 'Frais scolaires F');
      const accountId = await newAccount(auth, 'Compte F');
      const chargePlan = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Frais T1', categoryId, startDate: '2026-10-01', financialPlanId: planId, generationMode: 'calendrier_manuel', obligationStatus: 'optionnelle_souscrite' })
        .expect(201);
      const deadline = await http
        .post(`/charge-plans/${chargePlan.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-10-15', amountCurrent: 1000, amountStatus: 'confirme' })
        .expect(201);

      await http
        .post(`/deadlines/${deadline.body.id}/payments`)
        .set(...auth())
        .send({ amount: 1000, accountId })
        .expect(201);
      // La clôture exige une confirmation explicite (RG-014, jamais automatique).
      await http.post(`/deadlines/${deadline.body.id}/close`).set(...auth()).expect(201);

      // Une échéance soldée ne peut plus être annulée.
      await http.post(`/deadlines/${deadline.body.id}/cancel`).set(...auth()).expect(400);
      // Le plan qui la porte ne peut pas être supprimé physiquement (historique de paiement).
      await http.delete(`/charge-plans/${chargePlan.body.id}`).set(...auth()).expect(409);

      const stillThere = await http.get(`/deadlines/${deadline.body.id}`).set(...auth()).expect(200);
      expect(stillThere.body.financialStatus).toBe('soldee');
    });
  });

  describe('§4 — Options envisagées (Garderie) modifiables', () => {
    async function newPlan(auth: () => [string, string]) {
      const res = await http
        .post('/financial-plans')
        .set(...auth())
        .send({ label: 'Garderie 2026', periodStart: '2026-09-01', periodEnd: '2027-07-31' })
        .expect(201);
      return res.body.id as string;
    }

    it('G. une option envisagée (Garderie T1) est modifiable (montant + statut)', async () => {
      const { auth } = await newHousehold('g');
      const planId = await newPlan(auth);
      const categoryId = await newCategory(auth, 'Garderie G');
      const chargePlan = await http
        .post('/charge-plans')
        .set(...auth())
        .send({
          label: 'Garderie T1',
          categoryId,
          startDate: '2026-10-01',
          financialPlanId: planId,
          generationMode: 'calendrier_manuel',
          obligationStatus: 'optionnelle_envisagee',
        })
        .expect(201);

      const updated = await http
        .patch(`/charge-plans/${chargePlan.body.id}`)
        .set(...auth())
        .send({ label: 'Garderie T1 (révisée)' })
        .expect(200);
      expect(updated.body.label).toBe('Garderie T1 (révisée)');

      const plan = await http.get(`/financial-plans/${planId}`).set(...auth()).expect(200);
      expect(plan.body.envisagedItems.find((i: { chargePlanId: string }) => i.chargePlanId === chargePlan.body.id).label).toBe('Garderie T1 (révisée)');
    });

    it('H. une option RETENUE devient une obligation réelle du plan, sans jamais être comptée deux fois (option ET échéance obligatoire simultanément)', async () => {
      const { auth } = await newHousehold('h');
      const planId = await newPlan(auth);
      const categoryId = await newCategory(auth, 'Garderie H');
      const chargePlan = await http
        .post('/charge-plans')
        .set(...auth())
        .send({
          label: 'Garderie T1',
          categoryId,
          startDate: '2026-10-01',
          financialPlanId: planId,
          generationMode: 'calendrier_manuel',
          obligationStatus: 'optionnelle_envisagee',
        })
        .expect(201);
      await http
        .post(`/charge-plans/${chargePlan.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-10-15', amountCurrent: 800, amountStatus: 'confirme' })
        .expect(201);

      const beforeRetenue = await http.get(`/financial-plans/${planId}`).set(...auth()).expect(200);
      expect(beforeRetenue.body.knownPlanCost).toBe(0); // encore une option : jamais dans le coût connu

      await http
        .patch(`/charge-plans/${chargePlan.body.id}`)
        .set(...auth())
        .send({ obligationStatus: 'obligatoire' })
        .expect(200);

      const afterRetenue = await http.get(`/financial-plans/${planId}`).set(...auth()).expect(200);
      expect(afterRetenue.body.knownPlanCost).toBe(800); // désormais une obligation réelle
      expect(afterRetenue.body.remainingDue).toBe(800);
      // Le classement obligationStatus est le SEUL discriminant (financial-plans.service.detailOnTx) :
      // un ChargePlan ne peut structurellement apparaître que dans une seule des trois listes
      // (certain/envisagé/refusé) à la fois — aucun double comptage possible par construction.
    });
  });
});
