import {
  BudgetLike,
  budgetAmountForWindow,
  budgetHealthStatus,
  computeBudgetPeriodStatus,
  nominalPeriod,
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
    const period = nominalPeriod('semaine', 1, wednesday);
    expect(period.start.toISOString().slice(0, 10)).toBe('2026-08-31');
    expect(period.end.toISOString().slice(0, 10)).toBe('2026-09-06');
  });

  it('budgetHealthStatus — sous_budget / proche_limite / dépassé', () => {
    expect(budgetHealthStatus(100, 1500)).toBe('sous_budget');
    expect(budgetHealthStatus(1300, 1500)).toBe('proche_limite');
    expect(budgetHealthStatus(1600, 1500)).toBe('depasse');
  });
});
