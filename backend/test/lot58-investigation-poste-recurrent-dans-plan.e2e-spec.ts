import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Point 14.3 — INVESTIGATION UNIQUEMENT, aucun changement de moteur ni d'UI.
 *
 * Question posée : un ChargePlan combinant financialPlanId + recurrenceRule +
 * recurrenceAnchorDate + generationMode='auto_frequence' est-il compatible
 * avec l'architecture existante (génération d'échéances, Calendrier,
 * Projection, Dashboard, période bornée du plan, suppression/retrait) ?
 *
 * Ce test caractérise le comportement RÉEL du code actuel (jamais modifié
 * ici) — il documente ce qui se passe, pas ce qui devrait se passer.
 */
describe('Point 14.3 — investigation : poste récurrent (auto_frequence) rattaché à un plan financier (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot58+${tag}+${run}@example.com`, 'password123', 'L58', 'T');
    const household = await http.post('/households').set('Authorization', `Bearer ${signupToken}`).send({ name: `Foyer Lot58 ${tag}` }).expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  it('A. SANS endDate : la génération continue bien au-delà de periodEnd du plan (risque confirmé), et gonfle knownPlanCost en conséquence', async () => {
    const { auth } = await newHousehold('a');
    const category = await http.post('/categories').set(...auth()).send({ name: 'Cat Lot58 A', kind: 'expense' }).expect(201);
    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'Plan borné A', periodStart: '2026-09-01', periodEnd: '2026-11-30' })
      .expect(201);
    const planId = plan.body.id as string;

    // Poste récurrent mensuel rattaché au plan, SANS endDate (cas non garde-fouté).
    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({
        label: 'Cantine mensuelle A',
        categoryId: category.body.id,
        startDate: '2026-09-01',
        financialPlanId: planId,
        generationMode: 'auto_frequence',
        recurrenceRule: 'mensuel',
        recurrenceAnchorDate: '2026-09-15',
        obligationStatus: 'optionnelle_souscrite',
      })
      .expect(201);

    // Horizon de 6 mois demandé par un consommateur (Projection) — bien au-delà
    // de periodEnd (2026-11-30), pour révéler le comportement réel de génération.
    await http.get('/projection/monthly').set(...auth()).query({ at: '2026-09-01', horizonMonths: 6 }).expect(200);

    const deadlines = await http.get(`/charge-plans/${chargePlan.body.id}/deadlines`).set(...auth()).expect(200);
    const dueDates = (deadlines.body as Array<{ dueDate: string }>).map((d) => d.dueDate.slice(0, 10)).sort();

    // CONSTAT : la génération ne s'arrête jamais à periodEnd (2026-11-30) —
    // ensureChargeDeadlinesUntil (occurrence-generation.util.ts) ne connaît
    // QUE plan.endDate (optionnel, non renseigné ici) et l'horizon demandé
    // par l'appelant, jamais FinancialPlan.periodEnd.
    const beyondPeriodEnd = dueDates.filter((d) => d > '2026-11-30');
    expect(beyondPeriodEnd.length).toBeGreaterThan(0);
    expect(dueDates.length).toBeGreaterThanOrEqual(6); // sept, oct, nov, déc, janv, févr au minimum

    // CONSTAT : knownPlanCost (financial-plans.service.ts) somme TOUTES les
    // deadlines du poste, sans filtrer par periodStart/periodEnd — les
    // occurrences générées au-delà de la période bornée du plan gonflent donc
    // artificiellement le "coût connu du plan" affiché à l'utilisateur.
    const detail = await http.get(`/financial-plans/${planId}`).set(...auth()).expect(200);
    const perDeadlineAmount = Number(deadlines.body[0].amountCurrent);
    expect(detail.body.knownPlanCost).toBeCloseTo(perDeadlineAmount * dueDates.length, 5);

    // CONSTAT : le Calendrier affiche aussi les occurrences bien après periodEnd
    // (aucune notion de "plan borné" à ce niveau non plus).
    const farCalendar = await http.get('/calendar').set(...auth()).query({ from: '2027-01-01', to: '2027-01-31' }).expect(200);
    expect(farCalendar.body.events.some((e: { label: string }) => e.label.startsWith('Cantine mensuelle A'))).toBe(true);

    // CONSTAT : ce poste reste bien absent de la liste "Charges récurrentes"
    // (GET /charge-plans, filtrée financialPlanId=null) — comportement existant
    // pour les postes ponctuels de plan, inchangé pour un poste auto_frequence.
    const recurringList = await http.get('/charge-plans').set(...auth()).expect(200);
    expect(recurringList.body.some((p: { id: string }) => p.id === chargePlan.body.id)).toBe(false);
  });

  it("B. AVEC endDate = periodEnd du plan (garde-fou déjà disponible, champ existant, aucune migration) : génération correctement bornée", async () => {
    const { auth } = await newHousehold('b');
    const category = await http.post('/categories').set(...auth()).send({ name: 'Cat Lot58 B', kind: 'expense' }).expect(201);
    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'Plan borné B', periodStart: '2026-09-01', periodEnd: '2026-11-30' })
      .expect(201);
    const planId = plan.body.id as string;

    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({
        label: 'Cantine mensuelle B',
        categoryId: category.body.id,
        startDate: '2026-09-01',
        financialPlanId: planId,
        generationMode: 'auto_frequence',
        recurrenceRule: 'mensuel',
        recurrenceAnchorDate: '2026-09-15',
        obligationStatus: 'optionnelle_souscrite',
        endDate: '2026-11-30', // garde-fou : réutilise le champ ChargePlan.endDate existant.
      })
      .expect(201);

    await http.get('/projection/monthly').set(...auth()).query({ at: '2026-09-01', horizonMonths: 6 }).expect(200);

    const deadlines = await http.get(`/charge-plans/${chargePlan.body.id}/deadlines`).set(...auth()).expect(200);
    const dueDates = (deadlines.body as Array<{ dueDate: string }>).map((d) => d.dueDate.slice(0, 10));

    // CONFIRMÉ : avec endDate renseigné, ensureChargeDeadlinesUntil respecte
    // strictement cette borne (occurrence-generation.util.ts §92) — plus aucune
    // occurrence au-delà, quel que soit l'horizon demandé par l'appelant.
    expect(dueDates.every((d) => d <= '2026-11-30')).toBe(true);
    expect(dueDates.length).toBe(3); // sept/oct/nov uniquement
  });

  it("C. suppression/retrait : retire() gère correctement un poste récurrent avec de nombreuses échéances générées, sans erreur", async () => {
    const { auth } = await newHousehold('c');
    const category = await http.post('/categories').set(...auth()).send({ name: 'Cat Lot58 C', kind: 'expense' }).expect(201);
    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'Plan borné C', periodStart: '2026-09-01', periodEnd: '2026-11-30' })
      .expect(201);
    const planId = plan.body.id as string;

    const chargePlan = await http
      .post('/charge-plans')
      .set(...auth())
      .send({
        label: 'Cantine mensuelle C',
        categoryId: category.body.id,
        startDate: '2026-09-01',
        financialPlanId: planId,
        generationMode: 'auto_frequence',
        recurrenceRule: 'mensuel',
        recurrenceAnchorDate: '2026-09-15',
        obligationStatus: 'optionnelle_souscrite',
      })
      .expect(201);
    await http.get('/projection/monthly').set(...auth()).query({ at: '2026-09-01', horizonMonths: 6 }).expect(200);
    const before = await http.get(`/charge-plans/${chargePlan.body.id}/deadlines`).set(...auth()).expect(200);
    expect(before.body.length).toBeGreaterThanOrEqual(6);

    // CONFIRMÉ : retire() (point 14.1, déjà committé) traite correctement un
    // poste avec de nombreuses échéances générées automatiquement — toutes
    // annulées (aucun paiement), détachement propre, aucune erreur/timeout.
    const retired = await http.post(`/charge-plans/${chargePlan.body.id}/retire`).set(...auth()).expect(201);
    expect(retired.body.status).toBe('inactif');
    expect(retired.body.financialPlanId).toBeNull();
    expect(retired.body.cancelledDeadlinesCount).toBe(before.body.length);
  });
});
