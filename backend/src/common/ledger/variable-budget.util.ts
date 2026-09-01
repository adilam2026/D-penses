/**
 * Moteur de calcul des budgets variables (docs/02-modele-metier.md §E.4, G.7/G.8,
 * RG-098/RG-099/RG-024bis). Toutes les dates sont manipulées en UTC "date pure"
 * (minuit UTC) pour correspondre aux colonnes Postgres `@db.Date` — jamais de
 * fuseau horaire local qui décalerait un jour de semaine/mois.
 *
 * Source de vérité unique : ces fonctions sont les seules à implémenter le
 * prorata de semaine/mois réel et les trois formules G.8 — jamais recopiées
 * ailleurs (§9/§12 de la demande Lot 3).
 */

export type ReferencePeriod = 'semaine' | 'mois';
export type ProjectionMode = 'contractuel' | 'rythme_reel' | 'prudent_max';

export interface PeriodWindow {
  start: Date; // minuit UTC, inclus
  end: Date; // minuit UTC, inclus
}

export interface BudgetLike {
  referenceAmount: number;
  referencePeriod: ReferencePeriod;
  weekStartDay: number; // 1=lundi..7=dimanche
  startDate: Date;
  endDate: Date | null;
}

function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDaysUTC(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function daysInMonthUTC(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/** Nombre de jours de a à b inclus (a et b minuit UTC, a ≤ b). */
function diffDaysInclusive(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** RG-098 : semaine calendaire réelle, du week_start_day au 6e jour suivant. */
function startOfWeekUTC(date: Date, weekStartDay: number): Date {
  const jsDay = date.getUTCDay(); // 0..6, 0=dimanche
  const isoDay = jsDay === 0 ? 7 : jsDay; // 1..7, lundi=1..dimanche=7
  const diff = (isoDay - weekStartDay + 7) % 7;
  return addDaysUTC(date, -diff);
}

/** Période calendaire (semaine ou mois réel) contenant `anchor` — jamais un raccourci arbitraire. */
export function nominalPeriod(referencePeriod: ReferencePeriod, weekStartDay: number, anchor: Date): PeriodWindow {
  const a = toUtcMidnight(anchor);
  if (referencePeriod === 'semaine') {
    const start = startOfWeekUTC(a, weekStartDay);
    return { start, end: addDaysUTC(start, 6) };
  }
  const start = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1));
  const end = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), daysInMonthUTC(a.getUTCFullYear(), a.getUTCMonth())));
  return { start, end };
}

/**
 * G.7 — Montant du budget pour une fenêtre arbitraire [windowStart, windowEnd].
 * Une semaine/mois calendaire entièrement comprise dans la fenêtre (et dans les
 * bornes start_date/end_date du budget) vaut reference_amount en entier ; seule
 * une période partielle (bord de fenêtre, ou tout début/fin du budget) est
 * proratée au nombre réel de jours qu'elle y occupe.
 */
export function budgetAmountForWindow(budget: BudgetLike, windowStart: Date, windowEnd: Date): number {
  const effStart = maxDate(toUtcMidnight(windowStart), toUtcMidnight(budget.startDate));
  const effEnd = budget.endDate ? minDate(toUtcMidnight(windowEnd), toUtcMidnight(budget.endDate)) : toUtcMidnight(windowEnd);
  if (effStart.getTime() > effEnd.getTime()) return 0;

  let total = 0;
  let cursor = effStart;
  while (cursor.getTime() <= effEnd.getTime()) {
    const period = nominalPeriod(budget.referencePeriod, budget.weekStartDay, cursor);
    const overlapStart = maxDate(period.start, effStart);
    const overlapEnd = minDate(period.end, effEnd);
    const overlapDays = diffDaysInclusive(overlapStart, overlapEnd);
    const periodTotalDays = diffDaysInclusive(period.start, period.end);

    total += overlapDays >= periodTotalDays ? budget.referenceAmount : (budget.referenceAmount / periodTotalDays) * overlapDays;
    cursor = addDaysUTC(period.end, 1);
  }
  return round2(total);
}

/** Fenêtre de la période courante (contenant `today`), clippée par start_date/end_date du budget. */
export function getCurrentPeriodWindow(budget: BudgetLike, today: Date): PeriodWindow {
  const t = toUtcMidnight(today);
  const nominal = nominalPeriod(budget.referencePeriod, budget.weekStartDay, t);
  const start = maxDate(nominal.start, toUtcMidnight(budget.startDate));
  const end = budget.endDate ? minDate(nominal.end, toUtcMidnight(budget.endDate)) : nominal.end;
  return { start, end };
}

export interface BudgetPeriodStatus {
  periodStart: Date;
  periodEnd: Date;
  budgetPeriode: number; // budget_période (RG-098/RG-022), déjà proraté si le budget démarre/finit en cours de période
  consommeADate: number;
  budgetContractuelRestant: number; // G.8
  rythmeProjete: number; // G.8 — « Projection au rythme actuel » (§13), total projeté sur la période
  previsionRythmeRestant: number; // G.8
  projectionPrudenteRestante: number; // RG-024bis, dépend du mode foyer
}

/**
 * Statut de la période courante (contenant `today`) — §9 à §12 de la demande.
 * `consommeADate` doit être fourni par l'appelant (somme des BudgetExpense
 * réelles de la période, jamais recalculée ici ni dupliquée depuis LedgerEntry).
 */
export function computeBudgetPeriodStatus(
  budget: BudgetLike,
  today: Date,
  consommeADate: number,
  mode: ProjectionMode = 'prudent_max',
): BudgetPeriodStatus {
  const t = toUtcMidnight(today);
  const nominal = nominalPeriod(budget.referencePeriod, budget.weekStartDay, t);
  const periodStart = maxDate(nominal.start, toUtcMidnight(budget.startDate));
  const periodEnd = budget.endDate ? minDate(nominal.end, toUtcMidnight(budget.endDate)) : nominal.end;

  const budgetPeriode = budgetAmountForWindow(budget, periodStart, periodEnd);
  const budgetContractuelRestant = round2(budgetPeriode - consommeADate);

  // G.8 : jours_totaux_période = durée nominale de la période (7 ou jours du mois),
  // jamais réduite par un début/fin de budget en cours de période. jours_écoulés est
  // borné à [1, jours_totaux_période] : jamais 0/négatif, jamais de NaN/Infinity (§11).
  const nominalTotalDays = diffDaysInclusive(nominal.start, nominal.end);
  const rawElapsed = diffDaysInclusive(periodStart, minDate(t, periodEnd));
  const joursEcoules = Math.min(Math.max(rawElapsed, 1), nominalTotalDays);

  const rythmeProjete = (consommeADate / joursEcoules) * nominalTotalDays;
  const previsionRythmeRestant = round2(rythmeProjete - consommeADate);

  let projectionPrudenteRestante: number;
  if (mode === 'contractuel') {
    projectionPrudenteRestante = Math.max(budgetContractuelRestant, 0);
  } else if (mode === 'rythme_reel') {
    projectionPrudenteRestante = Math.max(previsionRythmeRestant, 0);
  } else {
    projectionPrudenteRestante = Math.max(budgetContractuelRestant, previsionRythmeRestant, 0); // RG-024bis
  }

  return {
    periodStart,
    periodEnd,
    budgetPeriode,
    consommeADate: round2(consommeADate),
    budgetContractuelRestant,
    rythmeProjete: round2(rythmeProjete), // « Projection au rythme actuel » (§13) — total projeté, distinct du restant
    previsionRythmeRestant,
    projectionPrudenteRestante: round2(projectionPrudenteRestante),
  };
}

export type BudgetHealthStatus = 'sous_budget' | 'proche_limite' | 'depasse';

/** Statut continu d'affichage (docs/02 §F.3) — jamais stocké, toujours calculé. */
export function budgetHealthStatus(consommeADate: number, budgetPeriode: number): BudgetHealthStatus {
  if (budgetPeriode <= 0) return consommeADate > 0 ? 'depasse' : 'sous_budget';
  const ratio = consommeADate / budgetPeriode;
  if (ratio >= 1) return 'depasse';
  if (ratio >= 0.8) return 'proche_limite';
  return 'sous_budget';
}
