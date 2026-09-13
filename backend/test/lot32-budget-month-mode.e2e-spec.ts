import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Lot 6 (module Budgets) — modes mensuels CALENDAR/FINANCIAL/CUSTOM.
 *
 * FINANCIAL réutilise EXCLUSIVEMENT le moteur R6.3 (closingDay=25 => 26 août →
 * 25 septembre) — aucune redéfinition. CUSTOM reste basé sur un jour de DÉPART
 * (customStartDay=25 => 25 août → 24 septembre), volontairement différent.
 *
 * Historisation du closingDay (correction obligatoire avant implémentation) :
 * VariableBudgetVersion.financialClosingDaySnapshot est posé à CHAQUE création
 * de segment pour un budget monthMode='financier' (édition normale OU
 * changement de HouseholdSettings.closingDay), jamais seulement au moment du
 * changement de closingDay — sinon un segment créé pour une autre raison
 * resterait sans ancre et retomberait plus tard sur un closingDay futur.
 * resolveFinancialClosingDay ne retombe JAMAIS silencieusement sur le
 * closingDay live pour un segment historique incomplet : erreur explicite.
 */
describe('Lot 6 — modes mensuels CALENDAR/FINANCIAL/CUSTOM (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let prisma: PrismaService;
  const run = Date.now();
  const mailer = new FakeMailer();
  let seq = 0;

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
    const token = await signupVerified(http, mailer, `lot32+${run}+${seq}@example.com`, 'password123', 'L32', 'T');
    const household = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer Lot32 ${seq}` }).expect(201);
    const accessToken = household.body.accessToken as string;
    const householdId = household.body.household.id as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth, householdId };
  }

  async function createCategory(auth: () => [string, string], name: string) {
    const res = await http.post('/categories').set(...auth()).send({ name, kind: 'expense' }).expect(201);
    return res.body.id as string;
  }

  /** Accès direct DB (bypass RLS via SET LOCAL, même pattern que lot4.e2e-spec.ts)
   *  — uniquement pour vérifier des colonnes internes non exposées par l'API
   *  (financialClosingDaySnapshot) ou pour simuler une donnée incohérente. */
  async function withHouseholdContext<T>(householdId: string, fn: (tx: any) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_household_id', ${householdId}, true)`;
      return fn(tx);
    });
  }

  // ---------- TEST 1 — CALENDAR (défaut) : comportement civil inchangé ----------
  it('TEST 1 — CALENDAR (monthMode omis = défaut) : période civile 1er → dernier jour du mois, inchangée', async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation C1');
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 3000, referencePeriod: 'mois', startDate: '2020-01-01' })
      .expect(201);
    expect(budget.body.monthMode).toBe('calendaire');
    expect(budget.body.customStartDay).toBeNull();

    // `at` volontairement dans le passé (période déjà close par rapport à "maintenant")
    // — même convention que les tests Lot 4 existants (lot31) : computeBudgetPeriodStatus
    // fige todayForStatus à periodEnd pour une période close, garantissant une lecture
    // déterministe de status.periodStart/periodEnd, contrairement à une période encore
    // ouverte dans le futur où todayForStatus retomberait sur "maintenant" réel.
    const detail = await http
      .get(`/variable-budgets/${budget.body.id}`)
      .query({ at: '2026-03-15' })
      .set(...h.auth())
      .expect(200);
    expect(detail.body.status.periodStart.slice(0, 10)).toBe('2026-03-01');
    expect(detail.body.status.periodEnd.slice(0, 10)).toBe('2026-03-31');
  });

  // ---------- TEST 2 — FINANCIAL : identique au moteur R6.3 ----------
  it('TEST 2 — FINANCIAL, closingDay=25 : période 26 août → 25 septembre, identique au "mois financier" R6.3 déjà utilisé par Home/Projection', async () => {
    const h = await newHousehold();
    await http.patch('/households/settings').set(...h.auth()).send({ closingDay: 25 }).expect(200);
    const categoryId = await createCategory(h.auth, 'Alimentation F2');
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 3100, referencePeriod: 'mois', monthMode: 'financier', startDate: '2020-01-01' })
      .expect(201);
    expect(budget.body.monthMode).toBe('financier');

    const detail = await http
      .get(`/variable-budgets/${budget.body.id}`)
      .query({ at: '2026-03-10' })
      .set(...h.auth())
      .expect(200);
    expect(detail.body.status.periodStart.slice(0, 10)).toBe('2026-02-26');
    expect(detail.body.status.periodEnd.slice(0, 10)).toBe('2026-03-25');
  });

  // ---------- TEST 3 — CUSTOM : jour de départ, convention différente de FINANCIAL ----------
  it('TEST 3 — CUSTOM, customStartDay=25 : période 25 août → 24 septembre (jour de DÉPART, jamais 26 août comme FINANCIAL)', async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation P3');
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 3100, referencePeriod: 'mois', monthMode: 'personnalise', customStartDay: 25, startDate: '2020-01-01' })
      .expect(201);
    expect(budget.body.customStartDay).toBe(25);

    const detail = await http
      .get(`/variable-budgets/${budget.body.id}`)
      .query({ at: '2026-03-10' })
      .set(...h.auth())
      .expect(200);
    expect(detail.body.status.periodStart.slice(0, 10)).toBe('2026-02-25');
    expect(detail.body.status.periodEnd.slice(0, 10)).toBe('2026-03-24');
  });

  // ---------- TEST 4 — CUSTOM jour 31, clamp en février ----------
  it('TEST 4 — CUSTOM, customStartDay=31, ancre en février (clampé au 28) : période [28 fév, 30 mars]', async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation P4');
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 3100, referencePeriod: 'mois', monthMode: 'personnalise', customStartDay: 31, startDate: '2020-01-01' })
      .expect(201);

    const detail = await http
      .get(`/variable-budgets/${budget.body.id}`)
      .query({ at: '2026-02-28' })
      .set(...h.auth())
      .expect(200);
    expect(detail.body.status.periodStart.slice(0, 10)).toBe('2026-02-28');
    expect(detail.body.status.periodEnd.slice(0, 10)).toBe('2026-03-30');
  });

  // ---------- TEST 5 — validation : customStartDay requis pour personnalise ----------
  it('TEST 5 — monthMode=personnalise sans customStartDay → 400, aucune création', async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation V5');
    await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 1000, referencePeriod: 'mois', monthMode: 'personnalise', startDate: '2020-01-01' })
      .expect(400);
  });

  // ---------- TEST 6 — navigation de période sous CUSTOM (réutilise le moteur Lot 4 inchangé) ----------
  it('TEST 6 — navigation vers la période précédente sous CUSTOM : periodNavigation.previousPeriodAt résout correctement la fenêtre attendue', async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation P6');
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 3100, referencePeriod: 'mois', monthMode: 'personnalise', customStartDay: 25, startDate: '2020-01-01' })
      .expect(201);

    const detail = await http
      .get(`/variable-budgets/${budget.body.id}`)
      .query({ at: '2026-03-10' })
      .set(...h.auth())
      .expect(200);
    const previousAt = detail.body.periodNavigation.previousPeriodAt as string;

    const previousDetail = await http
      .get(`/variable-budgets/${budget.body.id}`)
      .query({ at: previousAt })
      .set(...h.auth())
      .expect(200);
    expect(previousDetail.body.status.periodStart.slice(0, 10)).toBe('2026-01-25');
    expect(previousDetail.body.status.periodEnd.slice(0, 10)).toBe('2026-02-24');
  });

  // ---------- TEST 7 — financialClosingDaySnapshot posé lors d'une édition normale (pas seulement au changement de closingDay) ----------
  it("TEST 7 — édition normale (referenceAmount) d'un budget FINANCIAL : le segment fermé capture le closingDay live à cet instant, sans qu'aucune entrée d'historique visible ne mentionne closingDay", async () => {
    const h = await newHousehold();
    await http.patch('/households/settings').set(...h.auth()).send({ closingDay: 25 }).expect(200);
    const categoryId = await createCategory(h.auth, 'Alimentation F7');
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 3100, referencePeriod: 'mois', monthMode: 'financier', startDate: '2020-01-01' })
      .expect(201);
    const budgetId = budget.body.id as string;

    await http.patch(`/variable-budgets/${budgetId}`).set(...h.auth()).send({ referenceAmount: 3500 }).expect(200);

    const versions: any[] = await withHouseholdContext(h.householdId, (tx) =>
      tx.variableBudgetVersion.findMany({ where: { variableBudgetId: budgetId } }),
    );
    expect(versions).toHaveLength(1);
    expect(versions[0].financialClosingDaySnapshot).toBe(25); // capturé même si SEUL referenceAmount a changé

    const history = await http.get(`/variable-budgets/${budgetId}/history`).set(...h.auth()).expect(200);
    expect(history.body.some((e: any) => e.field === 'referenceAmount')).toBe(true);
    expect(history.body.some((e: any) => e.field === 'monthMode' || e.field === 'customStartDay')).toBe(false); // aucun changement réel de ces champs
  });

  // ---------- TEST 8 — changement de closingDay foyer : segment créé UNIQUEMENT pour les budgets FINANCIAL ----------
  it('TEST 8 — PATCH /households/settings closingDay : fige l’ancien closingDay pour tout budget FINANCIAL du foyer, jamais pour CALENDAR/CUSTOM, un seul `now` partagé', async () => {
    const h = await newHousehold();
    await http.patch('/households/settings').set(...h.auth()).send({ closingDay: 25 }).expect(200);
    const categoryId = await createCategory(h.auth, 'Alimentation F8');

    const financialBudget1 = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 1000, referencePeriod: 'mois', monthMode: 'financier', startDate: '2020-01-01' })
      .expect(201);
    const financialBudget2 = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 2000, referencePeriod: 'mois', monthMode: 'financier', startDate: '2020-01-01' })
      .expect(201);
    const calendarBudget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 500, referencePeriod: 'mois', startDate: '2020-01-01' })
      .expect(201);
    const customBudget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 700, referencePeriod: 'mois', monthMode: 'personnalise', customStartDay: 10, startDate: '2020-01-01' })
      .expect(201);

    await http.patch('/households/settings').set(...h.auth()).send({ closingDay: 10 }).expect(200);

    const [v1, v2, vCal, vCustom]: any[][] = await withHouseholdContext(h.householdId, (tx) =>
      Promise.all([
        tx.variableBudgetVersion.findMany({ where: { variableBudgetId: financialBudget1.body.id } }),
        tx.variableBudgetVersion.findMany({ where: { variableBudgetId: financialBudget2.body.id } }),
        tx.variableBudgetVersion.findMany({ where: { variableBudgetId: calendarBudget.body.id } }),
        tx.variableBudgetVersion.findMany({ where: { variableBudgetId: customBudget.body.id } }),
      ]),
    );
    expect(v1).toHaveLength(1);
    expect(v2).toHaveLength(1);
    expect(v1[0].financialClosingDaySnapshot).toBe(25);
    expect(v2[0].financialClosingDaySnapshot).toBe(25);
    expect(vCal).toHaveLength(0); // jamais impacté (monthMode≠financier)
    expect(vCustom).toHaveLength(0); // jamais impacté (monthMode≠financier)
    // Même frontière temporelle pour les deux budgets FINANCIAL impactés (un seul `now`).
    expect(v1[0].validTo.getTime()).toBe(v2[0].validTo.getTime());
  });

  // ---------- TEST 9 — non-rétroactivité : la période déjà close avant le changement reste résolue sous l'ancien closingDay ----------
  it('TEST 9 — après un changement de closingDay, une période passée (déjà consultée sous l’ancien closingDay) reste résolue avec ce même ancien closingDay, jamais le nouveau', async () => {
    const h = await newHousehold();
    await http.patch('/households/settings').set(...h.auth()).send({ closingDay: 25 }).expect(200);
    const categoryId = await createCategory(h.auth, 'Alimentation F9');
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 3100, referencePeriod: 'mois', monthMode: 'financier', startDate: '2020-01-01' })
      .expect(201);
    const budgetId = budget.body.id as string;

    // Période "mars" sous closingDay=25 : 26 février → 25 mars — volontairement close
    // par rapport à "maintenant" (même convention que les autres tests de ce fichier).
    const beforeChange = await http.get(`/variable-budgets/${budgetId}`).query({ at: '2026-03-10' }).set(...h.auth()).expect(200);
    expect(beforeChange.body.status.periodStart.slice(0, 10)).toBe('2026-02-26');
    expect(beforeChange.body.status.periodEnd.slice(0, 10)).toBe('2026-03-25');

    await http.patch('/households/settings').set(...h.auth()).send({ closingDay: 10 }).expect(200);

    // Même `at` passé, relu APRÈS le changement de closingDay : borne identique
    // (résolue via le segment figé, jamais recalculée sous le nouveau closingDay=10).
    const afterChange = await http.get(`/variable-budgets/${budgetId}`).query({ at: '2026-03-10' }).set(...h.auth()).expect(200);
    expect(afterChange.body.status.periodStart.slice(0, 10)).toBe('2026-02-26');
    expect(afterChange.body.status.periodEnd.slice(0, 10)).toBe('2026-03-25');
  });

  // ---------- TEST 10 — invariant : segment FINANCIAL incohérent (snapshot manquant) → erreur explicite, jamais un repli silencieux ----------
  it('TEST 10 — segment FINANCIAL avec financialClosingDaySnapshot=null (donnée incohérente simulée) : GET échoue explicitement (500), jamais un repli silencieux vers le closingDay live', async () => {
    const h = await newHousehold();
    await http.patch('/households/settings').set(...h.auth()).send({ closingDay: 25 }).expect(200);
    const categoryId = await createCategory(h.auth, 'Alimentation F10');
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 1000, referencePeriod: 'mois', monthMode: 'financier', startDate: '2020-01-01' })
      .expect(201);
    const budgetId = budget.body.id as string;

    // Déclenche un premier segment normal (financialClosingDaySnapshot=25 correct).
    await http.patch(`/variable-budgets/${budgetId}`).set(...h.auth()).send({ referenceAmount: 1200 }).expect(200);

    // Corrompt directement ce segment en base pour simuler une donnée incohérente
    // (jamais atteignable via l'API — uniquement pour prouver que l'invariant est
    // bien vérifié à la lecture, pas seulement à l'écriture).
    await withHouseholdContext(h.householdId, (tx) =>
      tx.variableBudgetVersion.updateMany({ where: { variableBudgetId: budgetId }, data: { financialClosingDaySnapshot: null } }),
    );

    const versions: any[] = await withHouseholdContext(h.householdId, (tx) =>
      tx.variableBudgetVersion.findMany({ where: { variableBudgetId: budgetId } }),
    );
    // Milieu exact de [validFrom, validTo) — garanti à l'intérieur du segment
    // quelle que soit sa durée réelle (le PATCH précédent peut avoir pris <1s).
    const midpoint = (versions[0].validFrom.getTime() + versions[0].validTo.getTime()) / 2;
    const atInsideCorruptedSegment = new Date(midpoint).toISOString();

    await http.get(`/variable-budgets/${budgetId}`).query({ at: atInsideCorruptedSegment }).set(...h.auth()).expect(500);
  });
});
