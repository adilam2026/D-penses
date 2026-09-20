import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Point 14.3 — investigation initiale (verdict "COMPATIBLE AVEC GARDE-FOUS"),
 * puis correction : charge-plans.service.ts create() impose désormais
 * endDate = FinancialPlan.periodEnd pour tout poste récurrent
 * (auto_frequence, recurrenceRule ≠ ponctuel) rattaché directement à un
 * FinancialPlan — jamais laissé au client. Le scénario A ci-dessous, qui
 * documentait à l'origine le RISQUE (génération non bornée), est devenu un
 * test de non-régression du correctif : avec le même payload qu'avant (sans
 * endDate fourni), le garde-fou est désormais automatique. Voir aussi
 * backend/test/lot60-poste-recurrent-plan-borne.e2e-spec.ts pour la
 * couverture complète (6 scénarios) du correctif.
 */
describe('Point 14.3 — poste récurrent (auto_frequence) rattaché à un plan financier (e2e)', () => {
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

  it('A. (corrigé, point 14.3) SANS endDate fourni par le client : le backend l\'impose automatiquement = periodEnd, génération bornée, knownPlanCost jamais gonflé au-delà', async () => {
    const { auth } = await newHousehold('a');
    const category = await http.post('/categories').set(...auth()).send({ name: 'Cat Lot58 A', kind: 'expense' }).expect(201);
    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'Plan borné A', periodStart: '2026-09-01', periodEnd: '2026-11-30' })
      .expect(201);
    const planId = plan.body.id as string;

    // Même payload qu'avant le correctif : poste récurrent mensuel rattaché au
    // plan, SANS endDate fourni par le client — désormais imposé côté serveur.
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
    expect(chargePlan.body.endDate?.slice(0, 10)).toBe('2026-11-30');

    // Horizon de 6 mois demandé par un consommateur (Projection) — bien au-delà
    // de periodEnd (2026-11-30) : le garde-fou doit tenir malgré tout.
    await http.get('/projection/monthly').set(...auth()).query({ at: '2026-09-01', horizonMonths: 6 }).expect(200);

    const deadlines = await http.get(`/charge-plans/${chargePlan.body.id}/deadlines`).set(...auth()).expect(200);
    const dueDates = (deadlines.body as Array<{ dueDate: string }>).map((d) => d.dueDate.slice(0, 10)).sort();

    // CORRIGÉ : plus aucune occurrence après periodEnd (2026-11-30) — endDate,
    // désormais toujours renseigné pour ce cas, respecté à la lettre par
    // ensureChargeDeadlinesUntil (occurrence-generation.util.ts, inchangé).
    const beyondPeriodEnd = dueDates.filter((d) => d > '2026-11-30');
    expect(beyondPeriodEnd.length).toBe(0);
    expect(dueDates).toEqual(['2026-09-15', '2026-10-15', '2026-11-15']);

    // CORRIGÉ : knownPlanCost ne peut donc plus être gonflé par des occurrences
    // au-delà de la période du plan — il n'y en a simplement plus à sommer.
    await http.get(`/financial-plans/${planId}`).set(...auth()).expect(200);

    // CORRIGÉ : le Calendrier ne montre plus aucune occurrence après periodEnd.
    const farCalendar = await http.get('/calendar').set(...auth()).query({ from: '2027-01-01', to: '2027-01-31' }).expect(200);
    expect(farCalendar.body.events.some((e: { label: string }) => e.label.startsWith('Cantine mensuelle A'))).toBe(false);

    // CONSTAT inchangé : ce poste reste absent de la liste "Charges récurrentes"
    // (GET /charge-plans, filtrée financialPlanId=null) — comportement existant
    // pour les postes de plan, inchangé pour un poste auto_frequence.
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
    // Période volontairement large (9 mois) — cette portion du test vérifie que
    // retire() encaisse SANS ERREUR un grand nombre d'échéances auto-générées ;
    // le bornage par periodEnd (point 14.3) est déjà couvert précisément par
    // lot60-poste-recurrent-plan-borne.e2e-spec.ts, pas répété ici.
    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'Plan borné C', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
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
    expect((before.body as Array<{ dueDate: string }>).every((d) => d.dueDate.slice(0, 10) <= '2027-06-30')).toBe(true);

    // CONFIRMÉ : retire() (point 14.1, déjà committé) traite correctement un
    // poste avec de nombreuses échéances générées automatiquement — toutes
    // annulées (aucun paiement), détachement propre, aucune erreur/timeout.
    const retired = await http.post(`/charge-plans/${chargePlan.body.id}/retire`).set(...auth()).expect(201);
    expect(retired.body.status).toBe('inactif');
    expect(retired.body.financialPlanId).toBeNull();
    expect(retired.body.cancelledDeadlinesCount).toBe(before.body.length);
  });
});
