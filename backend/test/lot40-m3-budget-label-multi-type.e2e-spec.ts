import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Tests M3 (TXT réf. §M3) — libellé libre, plusieurs CategoryType par budget,
 * navigation réelle dans les périodes antérieures (pas seulement l'historique
 * des modifications), seuils d'alerte 60/75/90/100/>100% (§8 dimension B, moteur
 * backend partagé — jamais un calcul mobile), non-régression M4.
 */
describe('M3 — Libellé, multi-CategoryType, historique de périodes, non-régression M4 (e2e)', () => {
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
    const token = await signupVerified(http, mailer, `lot40+${run}+${seq}@example.com`, 'password123', 'L40', 'T');
    const household = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer Lot40 ${seq}` }).expect(201);
    const accessToken = household.body.accessToken as string;
    const householdId = household.body.household.id as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth, householdId };
  }

  /** Accès direct DB (bypass RLS via SET LOCAL, même pattern que lot32.e2e-spec.ts)
   *  — uniquement pour simuler des segments d'historique réellement distribués
   *  dans le temps (un test e2e ne peut pas attendre plusieurs semaines réelles
   *  entre deux PATCH pour obtenir 2 configurations passées différentes). */
  async function withHouseholdContext<T>(householdId: string, fn: (tx: any) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_household_id', ${householdId}, true)`;
      return fn(tx);
    });
  }

  async function createAccount(auth: () => [string, string], initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name: 'Compte', type: 'courant', initialBalance, includeInOperationalTreasury: true }).expect(201);
    return res.body.id as string;
  }

  async function createCategory(auth: () => [string, string], name: string) {
    const res = await http.post('/categories').set(...auth()).send({ name, kind: 'expense' }).expect(201);
    return res.body.id as string;
  }

  async function createCategoryType(auth: () => [string, string], categoryId: string, name: string) {
    const res = await http.post(`/categories/${categoryId}/types`).set(...auth()).send({ name }).expect(201);
    return res.body.id as string;
  }

  async function createBudget(auth: () => [string, string], body: Record<string, unknown>) {
    const res = await http.post('/variable-budgets').set(...auth()).send(body).expect(201);
    return res.body as { id: string; label: string; categoryTypeId: string | null; categoryTypeIds: string[]; overlapWarning: string[] | null };
  }

  // ---------- TEST 1 — label omis à la création : défaut = category.name (compat WEB standby) ----------
  it("TEST 1 — un budget créé sans label reçoit category.name par défaut (comportement historique préservé)", async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation M3-1');
    const budget = await createBudget(h.auth, { categoryId, referenceAmount: 1000, referencePeriod: 'mois', startDate: '2020-01-01' });
    expect(budget.label).toBe('Alimentation M3-1');
  });

  // ---------- TEST 2 — label explicite, distinct de la catégorie ----------
  it('TEST 2 — un label explicite est conservé tel quel, distinct du nom de la catégorie', async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation M3-2');
    const budget = await createBudget(h.auth, {
      label: 'Courses',
      categoryId,
      referenceAmount: 1000,
      referencePeriod: 'mois',
      startDate: '2020-01-01',
    });
    expect(budget.label).toBe('Courses');

    const detail = await http.get(`/variable-budgets/${budget.id}`).set(...h.auth()).expect(200);
    expect(detail.body.label).toBe('Courses');
    expect(detail.body.category.name).toBe('Alimentation M3-2');
  });

  // ---------- TEST 3 — renommer le label n'ouvre jamais un segment d'historique ----------
  it("TEST 3 — modifier uniquement le label ne crée aucune entrée d'historique (jamais versionné)", async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation M3-3');
    const budget = await createBudget(h.auth, {
      label: 'Courses',
      categoryId,
      referenceAmount: 1000,
      referencePeriod: 'mois',
      startDate: '2020-01-01',
    });

    await http.patch(`/variable-budgets/${budget.id}`).set(...h.auth()).send({ label: 'Courses hebdo' }).expect(200);

    const history = await http.get(`/variable-budgets/${budget.id}/history`).set(...h.auth()).expect(200);
    expect(history.body).toEqual([]);

    const detail = await http.get(`/variable-budgets/${budget.id}`).set(...h.auth()).expect(200);
    expect(detail.body.label).toBe('Courses hebdo');
    // Un renommage seul n'est jamais une "modification" au sens de la fiche (§7).
    expect(detail.body.initialValues).toBeNull();
    expect(detail.body.adjustedValues).toBeNull();
  });

  // ---------- TEST 4 — un budget suit PLUSIEURS CategoryType, chacun matche indépendamment ----------
  it('TEST 4 — un budget avec categoryTypeIds=[t1,t2] rattache automatiquement une dépense de t1 OU de t2', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const categoryId = await createCategory(h.auth, 'Alimentation M3-4');
    const t1 = await createCategoryType(h.auth, categoryId, 'Supermarché M3-4');
    const t2 = await createCategoryType(h.auth, categoryId, 'Marché M3-4');
    const budget = await createBudget(h.auth, {
      label: 'Courses',
      categoryId,
      categoryTypeIds: [t1, t2],
      referenceAmount: 2000,
      referencePeriod: 'mois',
      startDate: '2020-01-01',
    });
    expect(budget.categoryTypeIds.sort()).toEqual([t1, t2].sort());
    expect(budget.categoryTypeId).toBeNull(); // colonne singulière : null dès que >1 type suivi

    const e1 = await http.post('/expenses').set(...h.auth()).send({ amount: 100, accountId, categoryId, categoryTypeId: t1 }).expect(201);
    expect(e1.body.expense.variableBudgetId).toBe(budget.id);

    const e2 = await http.post('/expenses').set(...h.auth()).send({ amount: 80, accountId, categoryId, categoryTypeId: t2 }).expect(201);
    expect(e2.body.expense.variableBudgetId).toBe(budget.id);

    const detail = await http.get(`/variable-budgets/${budget.id}`).set(...h.auth()).expect(200);
    expect(detail.body.status.consommeADate).toBe(180); // les deux dépenses comptent dans le MÊME budget
  });

  // ---------- TEST 5 — categoryTypeIds=[] explicite équivaut au scope catégorie entière ----------
  it('TEST 5 — categoryTypeIds=[] explicite scope le budget à toute la catégorie (comme omis)', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const categoryId = await createCategory(h.auth, 'Alimentation M3-5');
    const budget = await createBudget(h.auth, {
      label: 'Courses',
      categoryId,
      categoryTypeIds: [],
      referenceAmount: 1000,
      referencePeriod: 'mois',
      startDate: '2020-01-01',
    });
    expect(budget.categoryTypeIds).toEqual([]);

    const expense = await http.post('/expenses').set(...h.auth()).send({ amount: 150, accountId, categoryId }).expect(201);
    expect(expense.body.expense.variableBudgetId).toBe(budget.id);
  });

  // ---------- TEST 6 — ambiguïté vraie entre deux budgets multi-types jamais résolue arbitrairement ----------
  it('TEST 6 — deux budgets suivant tous deux le même CategoryType précis signalent une ambiguïté (409), jamais un choix arbitraire', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const categoryId = await createCategory(h.auth, 'Alimentation M3-6');
    const shared = await createCategoryType(h.auth, categoryId, 'Type partagé M3-6');
    const other1 = await createCategoryType(h.auth, categoryId, 'Autre1 M3-6');
    const other2 = await createCategoryType(h.auth, categoryId, 'Autre2 M3-6');
    const budgetA = await createBudget(h.auth, {
      label: 'Budget A',
      categoryId,
      categoryTypeIds: [shared, other1],
      referenceAmount: 1000,
      referencePeriod: 'mois',
      startDate: '2020-01-01',
    });
    const budgetB = await createBudget(h.auth, {
      label: 'Budget B',
      categoryId,
      categoryTypeIds: [shared, other2],
      referenceAmount: 1500,
      referencePeriod: 'mois',
      startDate: '2020-01-01',
    });
    expect(budgetA.id).not.toBe(budgetB.id);

    const res = await http.post('/expenses').set(...h.auth()).send({ amount: 100, accountId, categoryId, categoryTypeId: shared }).expect(409);
    expect(res.body.candidates).toHaveLength(2);

    // La désambiguïsation explicite (variableBudgetId) reste toujours possible et déterministe.
    const explicit = await http
      .post('/expenses')
      .set(...h.auth())
      .send({ amount: 100, accountId, categoryId, categoryTypeId: shared, variableBudgetId: budgetA.id })
      .expect(201);
    expect(explicit.body.expense.variableBudgetId).toBe(budgetA.id);
  });

  // ---------- TEST 7 — historique de périodes : une dépense passée reste classée sur son budget d'origine ----------
  it("TEST 7 — retirer un CategoryType du jeu suivi par un budget ne reclasse jamais une BudgetExpense déjà enregistrée", async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const categoryId = await createCategory(h.auth, 'Alimentation M3-7');
    const t1 = await createCategoryType(h.auth, categoryId, 'Type M3-7');
    const budget = await createBudget(h.auth, {
      label: 'Courses',
      categoryId,
      categoryTypeIds: [t1],
      referenceAmount: 1000,
      referencePeriod: 'mois',
      startDate: '2020-01-01',
    });

    const expense = await http.post('/expenses').set(...h.auth()).send({ amount: 200, accountId, categoryId, categoryTypeId: t1 }).expect(201);
    expect(expense.body.expense.variableBudgetId).toBe(budget.id);

    // Retire t1 du jeu suivi (repasse le budget à toute la catégorie) — état COURANT jamais versionné.
    await http.patch(`/variable-budgets/${budget.id}`).set(...h.auth()).send({ categoryTypeIds: [] }).expect(200);

    // La consommation déjà enregistrée reste intégralement rattachée à ce budget (jamais recalculée).
    const detail = await http.get(`/variable-budgets/${budget.id}`).set(...h.auth()).expect(200);
    expect(detail.body.status.consommeADate).toBe(200);
    expect(detail.body.categoryTypeIds).toEqual([]);
  });

  // ---------- TEST 8 — les figures de la fiche restent non plafonnées au-delà de 100% (base des seuils mobile) ----------
  it('TEST 8 — un dépassement réel reste visible : consumptionRatio > 1 et budgetContractuelRestant négatif (jamais masqués)', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const categoryId = await createCategory(h.auth, 'Alimentation M3-8');
    const budget = await createBudget(h.auth, {
      label: 'Courses',
      categoryId,
      referenceAmount: 1000,
      referencePeriod: 'mois',
      startDate: '2020-01-01',
    });

    // Le dépassement n'est jamais bloqué (§8 : jamais bloquant une transaction).
    await http.post('/expenses').set(...h.auth()).send({ amount: 1300, accountId, categoryId }).expect(201);

    const detail = await http.get(`/variable-budgets/${budget.id}`).set(...h.auth()).expect(200);
    expect(detail.body.status.consumptionRatio).toBeGreaterThan(1);
    expect(detail.body.status.budgetContractuelRestant).toBeLessThan(0);
    expect(detail.body.status.budgetContractuelRestant).toBe(-300);
    // §8 (dimension B) — état de seuil fourni par le moteur backend partagé,
    // jamais recalculé côté client (mobile ET web consomment ce même champ).
    expect(detail.body.status.thresholdLevel).toBe('depasse');
    expect(detail.body.status.exceededAmount).toBe(300);
  });

  // ---------- TEST 8bis — seuils 60/75/90/100/>100 : paliers exacts, 100% distinct de 90–<100% ET de >100% ----------
  it("TEST 8bis — thresholdLevel/exceededAmount reflètent exactement les paliers, avec 100% EXACT ('atteint') comme état propre, jamais confondu (jamais un calcul mobile)", async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const categoryId = await createCategory(h.auth, 'Alimentation M3-8bis');
    const budget = await createBudget(h.auth, {
      label: 'Courses',
      categoryId,
      referenceAmount: 1000,
      referencePeriod: 'mois',
      startDate: '2020-01-01',
    });

    async function detail() {
      return http.get(`/variable-budgets/${budget.id}`).set(...h.auth()).expect(200);
    }

    // 59% — sous le premier palier.
    await http.post('/expenses').set(...h.auth()).send({ amount: 590, accountId, categoryId }).expect(201);
    expect((await detail()).body.status.thresholdLevel).toBe('sous_60');
    expect((await detail()).body.status.exceededAmount).toBe(0);

    // → 65% (60% atteint).
    await http.post('/expenses').set(...h.auth()).send({ amount: 60, accountId, categoryId }).expect(201);
    expect((await detail()).body.status.thresholdLevel).toBe('entre_60_75');

    // → 80% (75% atteint).
    await http.post('/expenses').set(...h.auth()).send({ amount: 150, accountId, categoryId }).expect(201);
    expect((await detail()).body.status.thresholdLevel).toBe('entre_75_90');

    // → 95% (90% atteint).
    await http.post('/expenses').set(...h.auth()).send({ amount: 150, accountId, categoryId }).expect(201);
    expect((await detail()).body.status.thresholdLevel).toBe('entre_90_100');

    // → 99% : reste dans 90–<100%, jamais confondu avec 100% exact (règle explicite).
    await http.post('/expenses').set(...h.auth()).send({ amount: 40, accountId, categoryId }).expect(201);
    let d = await detail();
    expect(d.body.status.thresholdLevel).toBe('entre_90_100');
    expect(d.body.status.exceededAmount).toBe(0);

    // → 100% EXACT : état propre 'atteint', distinct de 90–<100% ET de >100% (§8).
    await http.post('/expenses').set(...h.auth()).send({ amount: 10, accountId, categoryId }).expect(201);
    d = await detail();
    expect(d.body.status.thresholdLevel).toBe('atteint');
    expect(d.body.status.exceededAmount).toBe(0); // jamais un montant >0 tant qu'il n'y a pas de dépassement réel

    // → 110% (dépassé de 100 DH).
    await http.post('/expenses').set(...h.auth()).send({ amount: 100, accountId, categoryId }).expect(201);
    d = await detail();
    expect(d.body.status.thresholdLevel).toBe('depasse');
    expect(d.body.status.exceededAmount).toBe(100);

    // Jamais fusionné avec healthStatus (dimension A, distincte, WEB standby) : les deux
    // champs coexistent sans jamais s'écraser l'un l'autre.
    expect(d.body.status.healthStatus).toBe('depasse');
  });

  // ---------- TEST 9 — non-régression M4 : un budget multi-types reste hors "engagements connus" ----------
  it("TEST 9 — non-régression M4 : un budget avec categoryTypeIds n'entre jamais dans fin_periode_engagements_connus", async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 15000);
    const categoryId = await createCategory(h.auth, 'Alimentation M3-9');
    const t1 = await createCategoryType(h.auth, categoryId, 'Type M3-9');
    await createBudget(h.auth, {
      label: 'Courses',
      categoryId,
      categoryTypeIds: [t1],
      referenceAmount: 6000,
      referencePeriod: 'mois',
      startDate: '2020-01-01',
      includeInPrudentProjection: true,
    });

    const projection = await http.get('/projection').set(...h.auth()).query({ at: '2030-06-02', to: '2030-06-30' }).expect(200);
    // Aucun engagement réel n'a été créé (aucune Deadline) : engagements connus = solde actuel,
    // le budget (même multi-types, même non consommé) ne doit jamais s'y soustraire (bug M4 corrigé).
    expect(projection.body.opening_physical_treasury).toBe(15000);
    expect(projection.body.closing_physical_treasury).toBe(15000);
    // Le restant du budget (6000, non consommé) se retrouve exclusivement dans le niveau prudent.
    expect(projection.body.fin_periode_prudente).toBe(9000);
  });

  // ---------- TEST 10 — compatibilité ascendante : categoryTypeId singulier toujours accepté ----------
  it('TEST 10 — categoryTypeId (singulier, compatibilité ascendante) crée un jeu categoryTypeIds à un seul élément', async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation M3-10');
    const typeId = await createCategoryType(h.auth, categoryId, 'Type M3-10');
    const budget = await createBudget(h.auth, {
      label: 'Courses',
      categoryId,
      categoryTypeId: typeId,
      referenceAmount: 1000,
      referencePeriod: 'mois',
      startDate: '2020-01-01',
    });
    expect(budget.categoryTypeId).toBe(typeId);
    expect(budget.categoryTypeIds).toEqual([typeId]);
  });

  // =========================================================
  // Navigation RÉELLE dans les périodes antérieures (pas seulement l'historique
  // des modifications) — TXT §M3 : période actuelle, période précédente,
  // historique des périodes antérieures (2+ sauts), chacune avec SA propre
  // configuration effective (plafond), sa consommation, son reste/dépassement
  // et SES transactions — jamais recalculée avec la configuration actuelle.
  // Moteur déjà existant (Lot 4, detailOnTx/resolveEffectiveConfig) : ces tests
  // valident qu'il reste intact après M3 avec de VRAIES configurations passées
  // distinctes (impossible à obtenir avec un simple PATCH immédiat en test —
  // d'où l'insertion directe de segments VariableBudgetVersion réellement
  // distribués dans le temps, même pattern que lot32.e2e-spec.ts).
  // =========================================================

  // ---------- TEST 11 — hebdomadaire : 2 sauts en arrière, 3 configurations distinctes ----------
  it('TEST 11 — navigation hebdomadaire sur 2 périodes antérieures : chaque période affiche SA date/plafond/consommation/transactions propres', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const categoryId = await createCategory(h.auth, 'Alimentation M3-11');

    // Semaine A (07–13 janv. 2024, plafond historique 700) → Semaine B (15–21 janv.,
    // plafond 900) → Semaine C (22–28 janv., plafond COURANT 1100). Dates dans le
    // passé réel (jamais de dérive) — weekStartDay=1 (lundi), comme le TXT.
    const budget = await createBudget(h.auth, {
      label: 'Courses',
      categoryId,
      referenceAmount: 1100,
      referencePeriod: 'semaine',
      weekStartDay: 1,
      startDate: '2020-01-01',
    });

    await withHouseholdContext(h.householdId, async (tx) => {
      await tx.variableBudgetVersion.createMany({
        data: [
          {
            variableBudgetId: budget.id,
            referenceAmount: 700,
            referencePeriod: 'semaine',
            categoryId,
            categoryTypeId: null,
            weekStartDay: 1,
            monthMode: 'calendaire',
            customStartDay: null,
            includeInPrudentProjection: true,
            endDate: null,
            validFrom: new Date('2020-01-01T00:00:00.000Z'),
            validTo: new Date('2024-01-15T00:00:00.000Z'), // début semaine B
          },
          {
            variableBudgetId: budget.id,
            referenceAmount: 900,
            referencePeriod: 'semaine',
            categoryId,
            categoryTypeId: null,
            weekStartDay: 1,
            monthMode: 'calendaire',
            customStartDay: null,
            includeInPrudentProjection: true,
            endDate: null,
            validFrom: new Date('2024-01-15T00:00:00.000Z'),
            validTo: new Date('2024-01-22T00:00:00.000Z'), // début semaine C (= config vivante 1100)
          },
        ],
      });
    });

    // Dépenses réelles, une par semaine passée, jamais mélangées.
    await http.post('/expenses').set(...h.auth()).send({ amount: 200, accountId, categoryId, spentDate: '2024-01-10' }).expect(201); // semaine A
    await http.post('/expenses').set(...h.auth()).send({ amount: 350, accountId, categoryId, spentDate: '2024-01-16' }).expect(201); // semaine B

    // Semaine C (config vivante).
    const weekC = await http.get(`/variable-budgets/${budget.id}`).set(...h.auth()).query({ at: '2024-01-24' }).expect(200);
    expect(weekC.body.status.periodStart.slice(0, 10)).toBe('2024-01-22');
    expect(weekC.body.status.periodEnd.slice(0, 10)).toBe('2024-01-28');
    expect(weekC.body.status.budgetPeriode).toBe(1100);
    expect(weekC.body.status.consommeADate).toBe(0);

    // 1er saut : semaine précédente (B).
    const weekB = await http
      .get(`/variable-budgets/${budget.id}`)
      .set(...h.auth())
      .query({ at: weekC.body.periodNavigation.previousPeriodAt })
      .expect(200);
    expect(weekB.body.status.periodStart.slice(0, 10)).toBe('2024-01-15');
    expect(weekB.body.status.periodEnd.slice(0, 10)).toBe('2024-01-21');
    expect(weekB.body.status.budgetPeriode).toBe(900); // jamais 1100 (la config vivante)
    expect(weekB.body.status.consommeADate).toBe(350);
    expect(weekB.body.history).toHaveLength(1);
    expect(weekB.body.history[0].amount).toBe(350);
    expect(weekB.body.periodNavigation.isCurrentPeriod).toBe(false);

    // 2e saut : historique des périodes antérieures (A), depuis la période B.
    const weekA = await http
      .get(`/variable-budgets/${budget.id}`)
      .set(...h.auth())
      .query({ at: weekB.body.periodNavigation.previousPeriodAt })
      .expect(200);
    expect(weekA.body.status.periodStart.slice(0, 10)).toBe('2024-01-08');
    expect(weekA.body.status.periodEnd.slice(0, 10)).toBe('2024-01-14');
    expect(weekA.body.status.budgetPeriode).toBe(700); // jamais 900 ni 1100
    expect(weekA.body.status.consommeADate).toBe(200);
    expect(weekA.body.history).toHaveLength(1);
    expect(weekA.body.history[0].amount).toBe(200);

    // Navigation avant depuis A ramène exactement à B (symétrie prev/next).
    const backToB = await http
      .get(`/variable-budgets/${budget.id}`)
      .set(...h.auth())
      .query({ at: weekA.body.periodNavigation.nextPeriodAt })
      .expect(200);
    expect(backToB.body.status.periodStart.slice(0, 10)).toBe('2024-01-15');
    expect(backToB.body.status.budgetPeriode).toBe(900);
  });

  // ---------- TEST 12 — mensuel financier : 2 sauts en arrière, dates "26 → 25" exactes du TXT ----------
  it('TEST 12 — navigation mensuelle financière (closingDay=25) sur 2 périodes antérieures : 26 août–25 sept puis 26 juil–25 août, chacune avec sa config propre', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    await http.patch('/households/settings').set(...h.auth()).send({ closingDay: 25 }).expect(200);
    const categoryId = await createCategory(h.auth, 'Alimentation M3-12');

    // Période juillet (26 juil–25 août 2024, plafond historique 2500) → période août
    // (26 août–25 sept, plafond 2900) → période septembre (26 sept–25 oct, config VIVANTE 3300).
    const budget = await createBudget(h.auth, {
      label: 'Courses',
      categoryId,
      referenceAmount: 3300,
      referencePeriod: 'mois',
      monthMode: 'financier',
      startDate: '2020-01-01',
    });

    await withHouseholdContext(h.householdId, async (tx) => {
      await tx.variableBudgetVersion.createMany({
        data: [
          {
            variableBudgetId: budget.id,
            referenceAmount: 2500,
            referencePeriod: 'mois',
            categoryId,
            categoryTypeId: null,
            weekStartDay: 1,
            monthMode: 'financier',
            customStartDay: null,
            includeInPrudentProjection: true,
            endDate: null,
            financialClosingDaySnapshot: 25,
            validFrom: new Date('2020-01-01T00:00:00.000Z'),
            validTo: new Date('2024-08-26T00:00:00.000Z'), // début période août
          },
          {
            variableBudgetId: budget.id,
            referenceAmount: 2900,
            referencePeriod: 'mois',
            categoryId,
            categoryTypeId: null,
            weekStartDay: 1,
            monthMode: 'financier',
            customStartDay: null,
            includeInPrudentProjection: true,
            endDate: null,
            financialClosingDaySnapshot: 25,
            validFrom: new Date('2024-08-26T00:00:00.000Z'),
            validTo: new Date('2024-09-26T00:00:00.000Z'), // début période septembre (= config vivante 3300)
          },
        ],
      });
    });

    await http.post('/expenses').set(...h.auth()).send({ amount: 250, accountId, categoryId, spentDate: '2024-08-05' }).expect(201); // période juillet
    await http.post('/expenses').set(...h.auth()).send({ amount: 400, accountId, categoryId, spentDate: '2024-09-10' }).expect(201); // période août

    // Période septembre (config vivante).
    const septPeriod = await http.get(`/variable-budgets/${budget.id}`).set(...h.auth()).query({ at: '2024-10-05' }).expect(200);
    expect(septPeriod.body.status.periodStart.slice(0, 10)).toBe('2024-09-26');
    expect(septPeriod.body.status.periodEnd.slice(0, 10)).toBe('2024-10-25');
    expect(septPeriod.body.status.budgetPeriode).toBe(3300);

    // 1er saut : « 26 août–25 sept ».
    const augPeriod = await http
      .get(`/variable-budgets/${budget.id}`)
      .set(...h.auth())
      .query({ at: septPeriod.body.periodNavigation.previousPeriodAt })
      .expect(200);
    expect(augPeriod.body.status.periodStart.slice(0, 10)).toBe('2024-08-26');
    expect(augPeriod.body.status.periodEnd.slice(0, 10)).toBe('2024-09-25');
    expect(augPeriod.body.status.budgetPeriode).toBe(2900);
    expect(augPeriod.body.status.consommeADate).toBe(400);
    expect(augPeriod.body.history).toHaveLength(1);
    expect(augPeriod.body.history[0].amount).toBe(400);

    // 2e saut (historique) : « 26 juil–25 août ».
    const julPeriod = await http
      .get(`/variable-budgets/${budget.id}`)
      .set(...h.auth())
      .query({ at: augPeriod.body.periodNavigation.previousPeriodAt })
      .expect(200);
    expect(julPeriod.body.status.periodStart.slice(0, 10)).toBe('2024-07-26');
    expect(julPeriod.body.status.periodEnd.slice(0, 10)).toBe('2024-08-25');
    expect(julPeriod.body.status.budgetPeriode).toBe(2500); // jamais 2900 ni 3300
    expect(julPeriod.body.status.consommeADate).toBe(250);
    expect(julPeriod.body.history).toHaveLength(1);
    expect(julPeriod.body.history[0].amount).toBe(250);
  });
});
