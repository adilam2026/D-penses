import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Correction (point 14.3) — poste RÉCURRENT rattaché DIRECTEMENT à un
 * FinancialPlan (auto_frequence + recurrenceRule ≠ ponctuel, financialPlanId
 * renseigné) : garde-fou obligatoire, endDate = FinancialPlan.periodEnd,
 * imposé par le backend à la création — jamais laissé au client, jamais
 * redemandé à l'utilisateur. Réutilise exclusivement le moteur de récurrence
 * existant (occurrence-generation.util.ts respecte déjà ChargePlan.endDate,
 * cf. investigation point 14.3 "COMPATIBLE AVEC GARDE-FOUS") — aucun nouveau
 * mécanisme de bornage.
 */
describe('Correction (point 14.3) — poste récurrent directement dans un plan, borné par periodEnd (e2e)', () => {
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

  async function newHousehold(tag: string) {
    const signupToken = await signupVerified(http, mailer, `lot60+${tag}+${run}@example.com`, 'password123', 'L60', 'T');
    const household = await http.post('/households').set('Authorization', `Bearer ${signupToken}`).send({ name: `Foyer Lot60 ${tag}` }).expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function newPlanAndCategory(auth: () => [string, string], tag: string) {
    const category = await http.post('/categories').set(...auth()).send({ name: `Cat Lot60 ${tag}`, kind: 'expense' }).expect(201);
    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: `Plan Lot60 ${tag}`, periodStart: '2026-09-01', periodEnd: '2026-12-31' })
      .expect(201);
    return { categoryId: category.body.id as string, planId: plan.body.id as string };
  }

  it('1. plan 01/09-31/12, poste mensuel dès le 15/09 : échéances générées jusqu\'au 15/12, aucune après le 31/12', async () => {
    const { auth } = await newHousehold('a');
    const { categoryId, planId } = await newPlanAndCategory(auth, 'A');

    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({
        label: 'Activité mensuelle A',
        categoryId,
        startDate: '2026-09-15',
        financialPlanId: planId,
        generationMode: 'auto_frequence',
        recurrenceRule: 'mensuel',
        recurrenceAnchorDate: '2026-09-15',
        obligationStatus: 'optionnelle_souscrite',
      })
      .expect(201);
    // endDate imposé automatiquement par le backend — jamais fourni par le client.
    expect(chargePlan.body.endDate?.slice(0, 10)).toBe('2026-12-31');

    // Consommateur avec un horizon largement au-delà de periodEnd, pour prouver
    // que le garde-fou tient même quand l'appelant demande plus.
    await http.get('/projection/monthly').set(...auth()).query({ at: '2026-09-01', horizonMonths: 6 }).expect(200);

    const deadlines = await http.get(`/charge-plans/${chargePlan.body.id}/deadlines`).set(...auth()).expect(200);
    const dueDates = (deadlines.body as Array<{ dueDate: string }>).map((d) => d.dueDate.slice(0, 10)).sort();

    expect(dueDates).toEqual(['2026-09-15', '2026-10-15', '2026-11-15', '2026-12-15']);
    expect(dueDates.every((d) => d <= '2026-12-31')).toBe(true);
  });

  it("2. horizon Projection allant au-delà du 31/12 : aucune génération supplémentaire du poste", async () => {
    const { auth } = await newHousehold('b');
    const { categoryId, planId } = await newPlanAndCategory(auth, 'B');

    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({
        label: 'Activité mensuelle B',
        categoryId,
        startDate: '2026-09-15',
        financialPlanId: planId,
        generationMode: 'auto_frequence',
        recurrenceRule: 'mensuel',
        recurrenceAnchorDate: '2026-09-15',
        obligationStatus: 'optionnelle_souscrite',
      })
      .expect(201);

    // Horizon suffisamment large (6 mois) pour que toute la génération bornée
    // par periodEnd (2026-12-31) soit déjà produite — jamais limitée par
    // l'horizon lui-même, seulement par le garde-fou.
    await http.get('/projection/monthly').set(...auth()).query({ at: '2026-09-01', horizonMonths: 6 }).expect(200);
    const before = await http.get(`/charge-plans/${chargePlan.body.id}/deadlines`).set(...auth()).expect(200);
    expect(before.body.length).toBe(4);

    // Horizon Projection bien plus large (12 mois, jusqu'à fin 2027) — aucune
    // échéance supplémentaire ne doit apparaître, endDate=periodEnd tient.
    await http.get('/projection/monthly').set(...auth()).query({ at: '2026-09-01', horizonMonths: 12 }).expect(200);
    const after = await http.get(`/charge-plans/${chargePlan.body.id}/deadlines`).set(...auth()).expect(200);
    expect(after.body.length).toBe(4);
    const dueDates = (after.body as Array<{ dueDate: string }>).map((d) => d.dueDate.slice(0, 10));
    expect(dueDates.every((d) => d <= '2026-12-31')).toBe(true);
  });

  it('3. Calendrier interrogé après periodEnd : aucune échéance future du poste', async () => {
    const { auth } = await newHousehold('c');
    const { categoryId, planId } = await newPlanAndCategory(auth, 'C');

    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({
        label: 'Activité mensuelle C',
        categoryId,
        startDate: '2026-09-15',
        financialPlanId: planId,
        generationMode: 'auto_frequence',
        recurrenceRule: 'mensuel',
        recurrenceAnchorDate: '2026-09-15',
        obligationStatus: 'optionnelle_souscrite',
      })
      .expect(201);

    // Déclenche la génération sur un large horizon (via Projection), puis
    // interroge le Calendrier sur une fenêtre postérieure à periodEnd.
    await http.get('/projection/monthly').set(...auth()).query({ at: '2026-09-01', horizonMonths: 6 }).expect(200);
    const calendarBefore = await http.get('/calendar').set(...auth()).query({ from: '2026-09-01', to: '2026-12-31' }).expect(200);
    expect(calendarBefore.body.events.some((e: { label: string }) => e.label.startsWith('Activité mensuelle C'))).toBe(true);

    const calendarAfter = await http.get('/calendar').set(...auth()).query({ from: '2027-01-01', to: '2027-06-30' }).expect(200);
    expect(calendarAfter.body.events.some((e: { label: string }) => e.label.startsWith('Activité mensuelle C'))).toBe(false);
    expect(chargePlan.body.id).toBeTruthy();
  });

  it('4. retrait du poste récurrent (retire()) : aucune nouvelle génération ensuite, même avec un horizon élargi', async () => {
    const { auth } = await newHousehold('d');
    const { categoryId, planId } = await newPlanAndCategory(auth, 'D');

    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({
        label: 'Activité mensuelle D',
        categoryId,
        startDate: '2026-09-15',
        financialPlanId: planId,
        generationMode: 'auto_frequence',
        recurrenceRule: 'mensuel',
        recurrenceAnchorDate: '2026-09-15',
        obligationStatus: 'optionnelle_souscrite',
      })
      .expect(201);
    await http.get('/projection/monthly').set(...auth()).query({ at: '2026-09-01', horizonMonths: 6 }).expect(200);
    const before = await http.get(`/charge-plans/${chargePlan.body.id}/deadlines`).set(...auth()).expect(200);
    expect(before.body.length).toBe(4);

    const retired = await http.post(`/charge-plans/${chargePlan.body.id}/retire`).set(...auth()).expect(201);
    expect(retired.body.status).toBe('inactif');
    expect(retired.body.financialPlanId).toBeNull();

    // Horizon élargi après le retrait : ensureChargeDeadlinesUntil exclut déjà
    // tout ChargePlan status ≠ 'actif' (occurrence-generation.util.ts) — rien
    // de neuf ne doit apparaître, même avec un horizon beaucoup plus large.
    await http.get('/projection/monthly').set(...auth()).query({ at: '2026-09-01', horizonMonths: 12 }).expect(200);
    const after = await http.get(`/charge-plans/${chargePlan.body.id}/deadlines`).set(...auth()).expect(200);
    expect(after.body.length).toBe(4);
  });

  it('5. suppression du plan : règles existantes de préservation historique/annulation du futur inchangées pour un poste récurrent', async () => {
    const { auth } = await newHousehold('e');
    const { categoryId, planId } = await newPlanAndCategory(auth, 'E');
    const account = await http.post('/accounts').set(...auth()).send({ name: 'Compte Lot60 E', type: 'courant', initialBalance: 5000 }).expect(201);

    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({
        label: 'Activité mensuelle E',
        categoryId,
        startDate: '2026-09-15',
        financialPlanId: planId,
        generationMode: 'auto_frequence',
        recurrenceRule: 'mensuel',
        recurrenceAnchorDate: '2026-09-15',
        obligationStatus: 'optionnelle_souscrite',
      })
      .expect(201);

    // Première échéance créée explicitement avec un montant confirmé (même
    // flux que le mobile, cf. FinancialPlanDetailScreen.tsx onCreateDeadline) :
    // sert de référence de montant pour les occurrences auto-générées ensuite
    // (resolveReferenceAmount, occurrence-generation.util.ts) et permet un
    // paiement réel à solder ici.
    const firstCreated = await http
      .post(`/charge-plans/${chargePlan.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-09-15', amountCurrent: 50, amountStatus: 'confirme' })
      .expect(201);
    await http.get('/projection/monthly').set(...auth()).query({ at: '2026-09-01', horizonMonths: 6 }).expect(200);
    const deadlines = await http.get(`/charge-plans/${chargePlan.body.id}/deadlines`).set(...auth()).expect(200);
    expect(deadlines.body).toHaveLength(4); // 15/09 (créée) + 15/10, 15/11, 15/12 (générées)
    const first = { id: firstCreated.body.id as string };

    // Un paiement réel sur la première échéance (historique à préserver).
    await http.post(`/deadlines/${first.id}/payments`).set(...auth()).send({ amount: 50, accountId: account.body.id }).expect(201);
    await http.post(`/deadlines/${first.id}/close`).set(...auth()).expect(201);

    await http.delete(`/financial-plans/${planId}`).set(...auth()).expect(200);

    // Le ChargePlan survit détaché du plan (financialPlanId=null), jamais supprimé
    // dès qu'un historique de paiement existe (financial-plans.service.ts remove()).
    const cpAfter = await http.get(`/charge-plans/${chargePlan.body.id}`).set(...auth()).expect(200);
    expect(cpAfter.body.financialPlanId).toBeNull();

    const firstAfter = await http.get(`/deadlines/${first.id}`).set(...auth()).expect(200);
    expect(firstAfter.body.financialStatus).toBe('soldee'); // payée : jamais touchée
    const payments = await http.get(`/deadlines/${first.id}/payments`).set(...auth()).expect(200);
    expect(payments.body).toHaveLength(1);

    const others = (deadlines.body as Array<{ id: string; financialStatus: string }>).filter((d) => d.id !== first.id);
    for (const d of others) {
      const dAfter = await http.get(`/deadlines/${d.id}`).set(...auth()).expect(200);
      expect(dAfter.body.financialStatus).toBe('annulee'); // sans paiement : annulée, jamais supprimée
    }
  });

  it('6. date de départ postérieure à periodEnd : refus clair (400), aucun ChargePlan créé', async () => {
    const { auth } = await newHousehold('f');
    const { categoryId, planId } = await newPlanAndCategory(auth, 'F');

    const before = await http.get('/charge-plans').set(...auth()).expect(200);

    const res = await http
      .post('/charge-plans')
      .set(...auth())
      .send({
        label: 'Activité trop tardive',
        categoryId,
        startDate: '2027-01-15', // > periodEnd (2026-12-31)
        financialPlanId: planId,
        generationMode: 'auto_frequence',
        recurrenceRule: 'mensuel',
        recurrenceAnchorDate: '2027-01-15',
        obligationStatus: 'optionnelle_souscrite',
      })
      .expect(400);
    expect(res.body.message).toMatch(/postérieure à la fin du plan/i);

    const after = await http.get('/charge-plans').set(...auth()).expect(200);
    expect(after.body.length).toBe(before.body.length);
  });
});
