import {
  addDaysUTC,
  BudgetLike,
  budgetAmountForWindow,
  budgetHealthStatus,
  computeBudgetPeriodStatus,
  FinancialClosingDaySnapshotMissingError,
  getCurrentPeriodWindow,
  MonthMode,
  nominalPeriod,
  periodEndExclusive,
  resolveEffectiveConfig,
  resolveFinancialClosingDay,
  VersionedSnapshot,
} from './variable-budget.util';

/**
 * Tests unitaires purs du moteur de calcul des budgets variables (Lot 3, §19).
 * Ancrés sur la semaine du 31 août (lundi) au 6 septembre 2026 (dimanche),
 * exactement l'exemple du document 02/§13 de la demande.
 */
describe('variable-budget.util — moteur de calcul (Lot 3)', () => {
  const monday = new Date(Date.UTC(2026, 7, 31)); // 2026-08-31, lundi
  const sunday = new Date(Date.UTC(2026, 8, 6)); // 2026-09-06, dimanche
  const wednesday = new Date(Date.UTC(2026, 8, 2)); // 2026-09-02

  const weeklyBudget: BudgetLike = {
    referenceAmount: 1500,
    referencePeriod: 'semaine',
    weekStartDay: 1, // lundi
    monthMode: 'calendaire',
    financialClosingDay: null,
    customStartDay: null,
    startDate: new Date(Date.UTC(2020, 0, 1)),
    endDate: null,
  };

  it('TEST 3 — une semaine complète (lundi→dimanche) vaut exactement reference_amount', () => {
    expect(budgetAmountForWindow(weeklyBudget, monday, sunday)).toBe(1500);
  });

  it("TEST 4 — une fenêtre de 4 jours d'une semaine vaut reference_amount × 4/7", () => {
    const thursday = new Date(Date.UTC(2026, 8, 3));
    const expected = Math.round(((1500 / 7) * 4) * 100) / 100;
    expect(budgetAmountForWindow(weeklyBudget, monday, thursday)).toBeCloseTo(expected, 2);
    expect(budgetAmountForWindow(weeklyBudget, monday, thursday)).not.toBe(1500); // jamais la totalité pour une semaine partielle
  });

  it('TEST 5 — budget mensuel : février (28j), avril (30j) et janvier (31j) valent chacun reference_amount en entier', () => {
    const monthlyBudget: BudgetLike = { ...weeklyBudget, referencePeriod: 'mois', referenceAmount: 3000 };

    const feb2026Start = new Date(Date.UTC(2026, 1, 1));
    const feb2026End = new Date(Date.UTC(2026, 1, 28)); // 2026 non bissextile → 28 jours
    expect(budgetAmountForWindow(monthlyBudget, feb2026Start, feb2026End)).toBe(3000);

    const apr2026Start = new Date(Date.UTC(2026, 3, 1));
    const apr2026End = new Date(Date.UTC(2026, 3, 30));
    expect(budgetAmountForWindow(monthlyBudget, apr2026Start, apr2026End)).toBe(3000);

    const jan2026Start = new Date(Date.UTC(2026, 0, 1));
    const jan2026End = new Date(Date.UTC(2026, 0, 31));
    expect(budgetAmountForWindow(monthlyBudget, jan2026Start, jan2026End)).toBe(3000);

    // Jamais 1 mois = 30 jours arbitraire : une fenêtre de seulement 20 jours de janvier proratise sur 31, pas 30.
    const jan2026Partial = new Date(Date.UTC(2026, 0, 20));
    const expectedPartial = Math.round(((3000 / 31) * 20) * 100) / 100;
    expect(budgetAmountForWindow(monthlyBudget, jan2026Start, jan2026Partial)).toBeCloseTo(expectedPartial, 2);
  });

  it("TEST 6 — budget=1500, consommé=600 → Budget_contractuel_restant=900", () => {
    const status = computeBudgetPeriodStatus(weeklyBudget, monday, 600, 'prudent_max');
    expect(status.budgetPeriode).toBe(1500);
    expect(status.budgetContractuelRestant).toBe(900);
  });

  it('TEST 7 — prévision au rythme actuel : formule exacte sur un cas déterministe (exemple §13)', () => {
    // Mercredi soir, 3 jours écoulés (lundi, mardi, mercredi) dans la semaine, consommé = 1000.
    const status = computeBudgetPeriodStatus(weeklyBudget, wednesday, 1000, 'rythme_reel');
    const rythmeProjete = (1000 / 3) * 7;
    const expectedRestant = Math.round((rythmeProjete - 1000) * 100) / 100;
    expect(status.budgetContractuelRestant).toBe(500); // 1500 - 1000
    expect(status.previsionRythmeRestant).toBeCloseTo(expectedRestant, 2);
    expect(status.previsionRythmeRestant).toBeCloseTo(1333.33, 2);
  });

  it('TEST 8 — prudent_max : contractuel=900, rythme=1100 → Projection_prudente_restante=1100', () => {
    // consommé tel que budgetContractuelRestant = 1500-600=900 ; on choisit jours_écoulés pour rythme=1100.
    // rythme_restant = (consommé/j)*7 - consommé = 1100 avec consommé=600 ⇒ résoudre j.
    // (600/j)*7 - 600 = 1100 ⇒ 4200/j = 1700 ⇒ j = 4200/1700 ≈ 2.47 — on préfère un cas exact ci-dessous.
    const status = computeBudgetPeriodStatus(weeklyBudget, monday, 600, 'prudent_max');
    // Au jour 1 (lundi, jours_écoulés=1) : rythme_projeté = 600/1*7 = 4200, restant = 3600 → prudent_max = max(900,3600,0) = 3600.
    expect(status.budgetContractuelRestant).toBe(900);
    expect(status.projectionPrudenteRestante).toBeGreaterThanOrEqual(status.budgetContractuelRestant);
    expect(status.projectionPrudenteRestante).toBe(Math.max(status.budgetContractuelRestant, status.previsionRythmeRestant, 0));
  });

  it('TEST 8bis — prudent_max explicite : rythme > contractuel → la projection retient le rythme', () => {
    // 7 jours écoulés (dimanche = dernier jour), consommé=100 ⇒ rythme_projeté = (100/7)*7 = 100, restant=1400 < contractuel(1400)... choisir un cas net :
    // jours_écoulés=2, consommé=200 ⇒ rythme_projeté=(200/2)*7=700, rythme_restant=500 ; contractuel=1500-200=1300 → prudent_max=1300 (pas ce cas).
    // Cas voulu (rythme > contractuel) : jours_écoulés=1, consommé=900 ⇒ rythme_projeté=(900/1)*7=6300, rythme_restant=5400 ; contractuel=1500-900=600 → prudent_max=5400.
    const status = computeBudgetPeriodStatus(weeklyBudget, monday, 900, 'prudent_max');
    expect(status.budgetContractuelRestant).toBe(600);
    expect(status.previsionRythmeRestant).toBe(5400);
    expect(status.projectionPrudenteRestante).toBe(5400); // rythme > contractuel → RG-024bis retient le rythme
  });

  it('TEST 9 — prudent_max explicite : contractuel > rythme → la projection retient le contractuel', () => {
    // jours_écoulés=7 (dimanche), consommé=100 ⇒ rythme_projeté=(100/7)*7=100, rythme_restant=1400 ; contractuel=1500-100=1400 (égal, non concluant).
    // Cas net : jours_écoulés=7, consommé=400 ⇒ rythme_projeté=(400/7)*7=400, rythme_restant=1100 ; contractuel=1500-400=1100 (égal aussi car j=total).
    // Avec jours_écoulés < total et rythme plus bas : jours_écoulés=3, consommé=300 ⇒ rythme_projeté=(300/3)*7=700, restant=400 ; contractuel=1500-300=1200 → contractuel > rythme.
    const status = computeBudgetPeriodStatus(weeklyBudget, wednesday, 300, 'prudent_max');
    expect(status.budgetContractuelRestant).toBe(1200);
    expect(status.previsionRythmeRestant).toBe(400);
    expect(status.projectionPrudenteRestante).toBe(1200); // contractuel > rythme → RG-024bis retient le contractuel
  });

  it("TEST 10 — le consommé n'apparaît jamais deux fois dans Projection_prudente_restante (IF-13)", () => {
    const status = computeBudgetPeriodStatus(weeklyBudget, wednesday, 1000, 'prudent_max');
    // Chaque formule (G.8) ne soustrait le consommé qu'une seule fois : ni budget_contractuel_restant
    // ni prévision_rythme_restant ne doivent rester égaux au budget brut une fois du consommé enregistré.
    expect(status.budgetContractuelRestant).toBeLessThan(status.budgetPeriode);
    expect(status.budgetContractuelRestant).toBe(status.budgetPeriode - status.consommeADate);
    // La projection prudente reste exactement le max des deux restants (RG-024bis) — jamais
    // reconstruite en réadditionnant le consommé (qui a déjà réduit la trésorerie via BudgetExpense).
    expect(status.projectionPrudenteRestante).toBe(Math.max(status.budgetContractuelRestant, status.previsionRythmeRestant, 0));
  });

  it('cas particulier §11 — jours_écoulés borné à ≥1, jamais NaN/Infinity, même sur une fenêtre à un seul jour', () => {
    const singleDayBudget: BudgetLike = { ...weeklyBudget, startDate: sunday };
    const status = computeBudgetPeriodStatus(singleDayBudget, sunday, 0, 'prudent_max');
    expect(Number.isFinite(status.previsionRythmeRestant)).toBe(true);
    expect(Number.isFinite(status.projectionPrudenteRestante)).toBe(true);
  });

  it("cas particulier §11 — start_date du budget dans le futur : aucun crash, aucun NaN/Infinity", () => {
    // budget.start_date tombe après la fin de la semaine nominale de "today" : periodStart > periodEnd,
    // jours_écoulés brut serait négatif — doit rester déterministe (borné à 1) sans jamais planter.
    const futureBudget: BudgetLike = { ...weeklyBudget, startDate: new Date(Date.UTC(2026, 8, 20)) };
    const status = computeBudgetPeriodStatus(futureBudget, monday, 0, 'prudent_max');
    expect(status.budgetPeriode).toBe(0); // fenêtre vide (le budget n'a pas encore commencé)
    expect(Number.isFinite(status.previsionRythmeRestant)).toBe(true);
    expect(Number.isNaN(status.previsionRythmeRestant)).toBe(false);
    expect(Number.isFinite(status.projectionPrudenteRestante)).toBe(true);
  });

  it('nominalPeriod — la semaine du 31 août au 6 septembre 2026 est bien identifiée (doc02 §13)', () => {
    const period = nominalPeriod({ referencePeriod: 'semaine', weekStartDay: 1, monthMode: 'calendaire', financialClosingDay: null, customStartDay: null }, wednesday);
    expect(period.start.toISOString().slice(0, 10)).toBe('2026-08-31');
    expect(period.end.toISOString().slice(0, 10)).toBe('2026-09-06');
  });

  it('budgetHealthStatus — sous_budget / proche_limite / dépassé', () => {
    expect(budgetHealthStatus(100, 1500)).toBe('sous_budget');
    expect(budgetHealthStatus(1300, 1500)).toBe('proche_limite');
    expect(budgetHealthStatus(1600, 1500)).toBe('depasse');
  });

  // ---------- Lot 3 — alerte de rythme (% consommé vs % période écoulée) ----------

  it('TEST 11 — rythmeAlerte=true : % consommé (66,7%) dépasse % période écoulée (42,9%)', () => {
    // Mercredi = 3 jours écoulés sur 7 ; consommé=1000 sur budget_période=1500.
    // consumptionRatio/elapsedRatio sont arrondis à 2 décimales (round2, cohérent
    // avec le reste des champs de BudgetPeriodStatus) — précision de comparaison ajustée en conséquence.
    const status = computeBudgetPeriodStatus(weeklyBudget, wednesday, 1000, 'prudent_max');
    expect(status.consumptionRatio).toBeCloseTo(1000 / 1500, 2);
    expect(status.elapsedRatio).toBeCloseTo(3 / 7, 2);
    expect(status.rythmeAlerte).toBe(true);
  });

  it("TEST 12 — rythmeAlerte=false : % consommé (13,3%) reste sous % période écoulée (42,9%)", () => {
    const status = computeBudgetPeriodStatus(weeklyBudget, wednesday, 200, 'prudent_max');
    expect(status.consumptionRatio).toBeCloseTo(200 / 1500, 2);
    expect(status.elapsedRatio).toBeCloseTo(3 / 7, 2);
    expect(status.rythmeAlerte).toBe(false);
  });

  it('TEST 13 — égalité stricte (consumptionRatio === elapsedRatio) : rythmeAlerte reste false (comparaison strictement >)', () => {
    // Mardi = 2 jours écoulés sur 7 ; budget_période=1400, consommé=400 ⇒ 400/1400 = 2/7 exactement.
    const equalPaceBudget: BudgetLike = { ...weeklyBudget, referenceAmount: 1400 };
    const tuesday = new Date(Date.UTC(2026, 8, 1));
    const status = computeBudgetPeriodStatus(equalPaceBudget, tuesday, 400, 'prudent_max');
    expect(status.consumptionRatio).toBe(status.elapsedRatio);
    expect(status.rythmeAlerte).toBe(false);
  });

  it("TEST 14 — protection division par zéro : budget_période=0 (start_date futur) → ratios finis, jamais NaN/Infinity, rythmeAlerte=false", () => {
    const futureBudget: BudgetLike = { ...weeklyBudget, startDate: new Date(Date.UTC(2026, 8, 20)) };
    const status = computeBudgetPeriodStatus(futureBudget, monday, 0, 'prudent_max');
    expect(status.budgetPeriode).toBe(0);
    expect(Number.isFinite(status.consumptionRatio)).toBe(true);
    expect(Number.isFinite(status.elapsedRatio)).toBe(true);
    expect(status.consumptionRatio).toBe(0);
    expect(status.rythmeAlerte).toBe(false);
  });

  it('TEST 15 — elapsedRatio toujours dans [0,1] (joursEcoules déjà borné à [1, nominalTotalDays])', () => {
    const status = computeBudgetPeriodStatus(weeklyBudget, sunday, 500, 'prudent_max'); // dernier jour de la période
    expect(status.elapsedRatio).toBeGreaterThan(0);
    expect(status.elapsedRatio).toBeLessThanOrEqual(1);
  });

  it("TEST 16 — dépassement réel du budget_période : consumptionRatio n'est jamais plafonné à 1 (jamais masqué), rythmeAlerte=true", () => {
    const status = computeBudgetPeriodStatus(weeklyBudget, sunday, 2250, 'prudent_max'); // 150% du budget, dernier jour (elapsedRatio=1)
    expect(status.consumptionRatio).toBeCloseTo(1.5, 4);
    expect(status.elapsedRatio).toBe(1);
    expect(status.rythmeAlerte).toBe(true); // 1.5 > 1, jamais caché par un plafonnage artificiel à 1
  });
});

/**
 * Lot 4 — résolution pure de la configuration effective à une date (versionnement
 * par instantané complet). Convention temporelle SEMI-OUVERTE partout : périodes
 * [periodStart, periodEndExclusive) et segments [validFrom, validTo) — une
 * modification effective EXACTEMENT à la borne de sortie d'une période appartient
 * à la période SUIVANTE, jamais à celle qui se termine (cf. doc en tête de
 * resolveEffectiveConfig dans variable-budget.util.ts).
 */
describe('variable-budget.util — resolveEffectiveConfig / periodEndExclusive (Lot 4)', () => {
  const monday = new Date(Date.UTC(2026, 7, 31)); // 2026-08-31, lundi — semaine 1
  const sunday = new Date(Date.UTC(2026, 8, 6)); // 2026-09-06, dimanche — fin semaine 1
  const nextMonday = new Date(Date.UTC(2026, 8, 7)); // 2026-09-07, lundi — début semaine 2

  const weeklyBudget: BudgetLike = {
    referenceAmount: 1500,
    referencePeriod: 'semaine',
    weekStartDay: 1,
    monthMode: 'calendaire',
    financialClosingDay: null,
    customStartDay: null,
    startDate: new Date(Date.UTC(2020, 0, 1)),
    endDate: null,
  };

  function snapshot(referenceAmount: number, validFrom: Date, validTo: Date): VersionedSnapshot {
    return {
      referenceAmount,
      referencePeriod: 'semaine',
      categoryId: 'cat-1',
      categoryTypeId: null,
      weekStartDay: 1,
      monthMode: 'calendaire',
      customStartDay: null,
      includeInPrudentProjection: true,
      endDate: null,
      validFrom,
      validTo,
      financialClosingDaySnapshot: null,
    };
  }

  function liveConfigFrom(referenceAmount: number) {
    return {
      referenceAmount,
      referencePeriod: 'semaine' as const,
      categoryId: 'cat-1',
      categoryTypeId: null as string | null,
      weekStartDay: 1,
      monthMode: 'calendaire' as const,
      customStartDay: null as number | null,
      includeInPrudentProjection: true,
      endDate: null as Date | null,
    };
  }

  it('periodEndExclusive — minuit UTC du jour suivant periodEnd (borne de sortie réelle)', () => {
    expect(periodEndExclusive(sunday).getTime()).toBe(nextMonday.getTime());
  });

  it('resolveEffectiveConfig — aucune version connue : retombe systématiquement sur la ligne vivante', () => {
    const live = liveConfigFrom(1500);
    expect(resolveEffectiveConfig([], live, monday)).toBe(live);
    expect(resolveEffectiveConfig([], live, new Date())).toBe(live);
  });

  it('resolveEffectiveConfig — un segment clos couvrant `at` est retenu plutôt que la ligne vivante', () => {
    const live = liveConfigFrom(1800);
    const closed = snapshot(1000, new Date(Date.UTC(2020, 0, 1)), sunday);
    const result = resolveEffectiveConfig([closed], live, monday);
    expect(result).toBe(closed);
    expect((result as VersionedSnapshot).referenceAmount).toBe(1000);
  });

  it("resolveEffectiveConfig — `at` antérieur au premier segment connu : extrapole la plus ANCIENNE valeur connue, jamais la ligne vivante (cas standard d'un startDate très antérieur à la création du budget — sinon une modification du jour changerait rétroactivement une période ancienne)", () => {
    const live = liveConfigFrom(1800); // valeur après une modification ultérieure
    const closed = snapshot(1000, monday, sunday); // plus ancien segment connu
    const beforeEverything = new Date(Date.UTC(2000, 0, 1));
    const result = resolveEffectiveConfig([closed], live, beforeEverything);
    expect(result).toBe(closed);
    expect((result as VersionedSnapshot).referenceAmount).toBe(1000);
  });

  // ---------- TEST DE FRONTIÈRE (obligatoire) ----------
  // Budget A actif jusqu'à exactement periodEndExclusive(semaine 1) = début
  // exact de la semaine 2. Une modification devient effective à CET instant
  // précis. Vérifie : consultation de la période précédente → ancienne valeur ;
  // consultation de la période suivante → nouvelle valeur.
  it('TEST DE FRONTIÈRE — une modification effective exactement à la borne de sortie de période appartient à la période SUIVANTE, jamais à celle qui se termine', () => {
    const boundaryInstant = periodEndExclusive(sunday); // = nextMonday, exactement
    const live = liveConfigFrom(1800); // valeur en vigueur depuis boundaryInstant (semaine 2)
    const closedWeek1 = snapshot(1000, new Date(Date.UTC(2020, 0, 1)), boundaryInstant); // valeur de la semaine 1

    // Dernier instant réellement inclus dans la semaine 1 (periodEndExclusive - 1ms) → ancienne valeur.
    const lastInstantOfWeek1 = new Date(boundaryInstant.getTime() - 1);
    const resolvedForWeek1 = resolveEffectiveConfig([closedWeek1], live, lastInstantOfWeek1);
    expect((resolvedForWeek1 as VersionedSnapshot).referenceAmount).toBe(1000);

    // Exactement à la borne (= premier instant de la semaine 2) → nouvelle valeur,
    // jamais l'ancienne : la modification appartient à la période SUIVANTE.
    const resolvedAtBoundary = resolveEffectiveConfig([closedWeek1], live, boundaryInstant);
    expect(resolvedAtBoundary).toBe(live);
    expect((resolvedAtBoundary as ReturnType<typeof liveConfigFrom>).referenceAmount).toBe(1800);

    // Reproduit avec le moteur de période complet (getCurrentPeriodWindow) : la
    // semaine 1 vue depuis un jour quelconque en son sein résout bien l'ancienne
    // valeur au dernier instant inclus ; la semaine 2 (dont periodStart == boundaryInstant
    // exactement) résout bien la nouvelle valeur dès son tout premier instant.
    const week1Window = getCurrentPeriodWindow(weeklyBudget, monday);
    expect(periodEndExclusive(week1Window.end).getTime()).toBe(boundaryInstant.getTime());
    const week2Window = getCurrentPeriodWindow(weeklyBudget, nextMonday);
    expect(week2Window.start.getTime()).toBe(boundaryInstant.getTime());
    const resolvedAtWeek2Start = resolveEffectiveConfig([closedWeek1], live, week2Window.start);
    expect(resolvedAtWeek2Start).toBe(live);
  });
});

/**
 * Lot 6 — modes mensuels CALENDAR/FINANCIAL/CUSTOM. Convention SEMI-OUVERTE
 * identique au reste du moteur : periodEnd reste inclusif (contrat historique
 * de PeriodWindow) et periodEndExclusive() est la seule vraie borne de sortie —
 * les tests de contiguïté ci-dessous vérifient explicitement
 * periodEndExclusive(période N) === periodStart(période N+1), jamais une
 * arithmétique de jours en clair (correction demandée avant implémentation).
 */
describe('variable-budget.util — modes mensuels CALENDAR/FINANCIAL/CUSTOM (Lot 6)', () => {
  function monthBudget(
    overrides: Partial<Pick<BudgetLike, 'monthMode' | 'financialClosingDay' | 'customStartDay'>>,
  ): Pick<BudgetLike, 'referencePeriod' | 'weekStartDay' | 'monthMode' | 'financialClosingDay' | 'customStartDay'> {
    return {
      referencePeriod: 'mois',
      weekStartDay: 1,
      monthMode: 'calendaire',
      financialClosingDay: null,
      customStartDay: null,
      ...overrides,
    };
  }

  it('CALENDAR — comportement civil historique strictement inchangé (1er → dernier jour du mois)', () => {
    const anchor = new Date(Date.UTC(2026, 8, 15)); // 15 septembre 2026
    const period = nominalPeriod(monthBudget({ monthMode: 'calendaire' }), anchor);
    expect(period.start.toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(period.end.toISOString().slice(0, 10)).toBe('2026-09-30');
  });

  it('FINANCIAL — closingDay=25 : réutilise EXACTEMENT le moteur R6.3 (26 août → 25 septembre), aucune redéfinition dans ce lot', () => {
    const anchor = new Date(Date.UTC(2026, 8, 10)); // 10 septembre, à l'intérieur de la période
    const period = nominalPeriod(monthBudget({ monthMode: 'financier', financialClosingDay: 25 }), anchor);
    expect(period.start.toISOString().slice(0, 10)).toBe('2026-08-26');
    expect(period.end.toISOString().slice(0, 10)).toBe('2026-09-25');
  });

  it('CUSTOM — customStartDay=25 : jour de DÉPART, convention volontairement différente de FINANCIAL (25 août → 24 septembre, jamais 26 août)', () => {
    const anchor = new Date(Date.UTC(2026, 8, 10));
    const period = nominalPeriod(monthBudget({ monthMode: 'personnalise', customStartDay: 25 }), anchor);
    expect(period.start.toISOString().slice(0, 10)).toBe('2026-08-25');
    expect(period.end.toISOString().slice(0, 10)).toBe('2026-09-24');
  });

  it("CUSTOM — customStartDay=31, ancre en février (clampé à 28, année non bissextile) : [28 fév, 30 mars] inclus == [28 fév, 31 mars) semi-ouvert (pas d'incohérence, cf. correction avant implémentation)", () => {
    const anchor = new Date(Date.UTC(2027, 1, 28)); // 28 février 2027
    const period = nominalPeriod(monthBudget({ monthMode: 'personnalise', customStartDay: 31 }), anchor);
    expect(period.start.toISOString().slice(0, 10)).toBe('2027-02-28');
    expect(period.end.toISOString().slice(0, 10)).toBe('2027-03-30'); // inclusif — contrat PeriodWindow historique
    expect(periodEndExclusive(period.end).toISOString().slice(0, 10)).toBe('2027-03-31'); // borne de sortie réelle
  });

  it("CUSTOM — jour de février bissextile (29) respecté, contiguïté avec janvier/mars sans dérive", () => {
    // 2028 est bissextile : clampedDay(customStartDay=29, février 2028) = 29 directement (pas de clamp).
    const janAnchor = new Date(Date.UTC(2028, 0, 29));
    const febAnchor = new Date(Date.UTC(2028, 1, 29));
    const janPeriod = nominalPeriod(monthBudget({ monthMode: 'personnalise', customStartDay: 29 }), janAnchor);
    const febPeriod = nominalPeriod(monthBudget({ monthMode: 'personnalise', customStartDay: 29 }), febAnchor);
    expect(janPeriod.start.toISOString().slice(0, 10)).toBe('2028-01-29');
    expect(febPeriod.start.toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(periodEndExclusive(janPeriod.end).getTime()).toBe(febPeriod.start.getTime());
  });

  it('CUSTOM — test de contiguïté sur 2 années complètes (incl. février bissextile 2028), jours 25/29/30/31 : periodEndExclusive(N) === periodStart(N+1), jamais un trou ni un chevauchement', () => {
    for (const day of [25, 29, 30, 31]) {
      let cursor = new Date(Date.UTC(2027, 0, 1));
      let previousEnd: Date | null = null;
      for (let i = 0; i < 24; i++) {
        const period = nominalPeriod(monthBudget({ monthMode: 'personnalise', customStartDay: day }), cursor);
        if (previousEnd) {
          expect(periodEndExclusive(previousEnd).getTime()).toBe(period.start.getTime());
        }
        previousEnd = period.end;
        cursor = addDaysUTC(period.end, 1);
      }
    }
  });

  it('FINANCIAL — test de contiguïté sur 2 années complètes (incl. février bissextile 2028), jours 25/29/30/31 : même garantie que CUSTOM, via le moteur R6.3 réutilisé', () => {
    for (const closingDay of [25, 29, 30, 31]) {
      let cursor = new Date(Date.UTC(2027, 0, 1));
      let previousEnd: Date | null = null;
      for (let i = 0; i < 24; i++) {
        const period = nominalPeriod(monthBudget({ monthMode: 'financier', financialClosingDay: closingDay }), cursor);
        if (previousEnd) {
          expect(periodEndExclusive(previousEnd).getTime()).toBe(period.start.getTime());
        }
        previousEnd = period.end;
        cursor = addDaysUTC(period.end, 1);
      }
    }
  });

  it('budgetAmountForWindow — prorata correct sur une fenêtre à cheval sur deux périodes CUSTOM', () => {
    const budget: BudgetLike = {
      referenceAmount: 3100,
      referencePeriod: 'mois',
      weekStartDay: 1,
      monthMode: 'personnalise',
      financialClosingDay: null,
      customStartDay: 25,
      startDate: new Date(Date.UTC(2020, 0, 1)),
      endDate: null,
    };
    // Fenêtre = du 25 août (début exact de période) au 3 septembre inclus (10 jours
    // sur les 31 jours de la période [25 août, 24 septembre]).
    const windowStart = new Date(Date.UTC(2026, 7, 25));
    const windowEnd = new Date(Date.UTC(2026, 8, 3));
    const amount = budgetAmountForWindow(budget, windowStart, windowEnd);
    expect(amount).toBeCloseTo((3100 / 31) * 10, 2);
  });
});

/**
 * Lot 6 — invariant resolveFinancialClosingDay : jamais de repli implicite vers
 * le closingDay live pour un segment historique FINANCIAL incomplet (correction
 * obligatoire avant implémentation).
 */
describe('resolveFinancialClosingDay (Lot 6)', () => {
  it("monthMode ≠ 'financier' → toujours null, quel que soit le snapshot ou le live", () => {
    expect(resolveFinancialClosingDay({ monthMode: 'calendaire' as MonthMode }, 25, 'ctx')).toBeNull();
    expect(resolveFinancialClosingDay({ monthMode: 'personnalise' as MonthMode, financialClosingDaySnapshot: 12 }, 25, 'ctx')).toBeNull();
  });

  it("ligne vivante (aucune clé financialClosingDaySnapshot dans l'objet résolu) → closingDay LIVE du foyer", () => {
    const live: { monthMode: MonthMode } = { monthMode: 'financier' };
    expect(resolveFinancialClosingDay(live, 12, 'ctx')).toBe(12);
  });

  it('segment figé AVEC financialClosingDaySnapshot renseigné → utilise le snapshot, JAMAIS le live (même si différent)', () => {
    const segment = { monthMode: 'financier' as MonthMode, financialClosingDaySnapshot: 25 };
    expect(resolveFinancialClosingDay(segment, 5, 'ctx')).toBe(25);
  });

  it('segment figé FINANCIAL avec financialClosingDaySnapshot=null → FinancialClosingDaySnapshotMissingError explicite, JAMAIS un repli silencieux vers le live', () => {
    const segment = { monthMode: 'financier' as MonthMode, financialClosingDaySnapshot: null };
    expect(() => resolveFinancialClosingDay(segment, 25, 'budget-test contexte')).toThrow(FinancialClosingDaySnapshotMissingError);
    expect(() => resolveFinancialClosingDay(segment, 25, 'budget-test contexte')).toThrow(/budget-test contexte/);
  });
});
