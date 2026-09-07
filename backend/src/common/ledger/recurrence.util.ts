/**
 * Moteur de récurrence commun Revenus + Charges (Lot 11, §1 refonte UX). Une
 * seule fonction pure calcule les dates d'occurrence à partir d'une ancre —
 * réutilisée à l'identique par ensureIncomeOccurrencesUntil (income.service)
 * et ensureChargeDeadlinesUntil (charge-plans.service), jamais deux moteurs
 * séparés. Dates manipulées en UTC "date pure" (minuit UTC), même convention
 * que variable-budget.util.ts.
 *
 * Règle jour 29/30/31 (verrouillée avec l'utilisateur) :
 * date_du_mois_cible = min(jour_d_ancrage, nombre_de_jours_du_mois_cible),
 * recalculée INDÉPENDAMMENT pour chaque occurrence à partir de l'ancre
 * d'origine — jamais en ajoutant "+1 mois" à une date déjà arrondie (ce qui
 * dériverait : ancre 31 → janvier 31 → si on répétait +1 mois sur 31 on
 * obtiendrait un débordement ; le calcul repart toujours de l'ancre réelle).
 */

export type RecurrenceRule = 'hebdomadaire' | 'mensuel' | 'trimestriel' | 'semestriel' | 'annuel' | 'ponctuel';

const MONTH_STEP: Partial<Record<RecurrenceRule, number>> = {
  mensuel: 1,
  trimestriel: 3,
  semestriel: 6,
  annuel: 12,
};

/**
 * Plafond de sécurité (§16) — exclut toute génération non bornée quel que soit
 * l'horizon demandé. Relevé à 320 (Projection mensuelle, Round 4 §3/§19) : la
 * projection doit fonctionner jusqu'à 60 mois, soit ~261 occurrences pour une
 * récurrence hebdomadaire (le cas le plus dense) — 60 aurait tronqué silencieusement
 * toute récurrence hebdomadaire au-delà d'environ 14 mois. Mensuel/trimestriel/
 * semestriel/annuel restent très en-dessous de ce plafond sur 60 mois (≤60
 * occurrences) : ce relèvement ne change leur comportement sur aucun horizon existant.
 */
export const MAX_GENERATED_OCCURRENCES = 320;

export function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/**
 * Ajoute `monthsToAdd` mois calendaires à `anchor`, avec la règle de
 * clampage jour 29/30/31 — jamais un décalage cumulatif (repart toujours du
 * jour de l'ancre d'origine, pas du résultat du pas précédent).
 */
function addMonthsClamped(anchor: Date, monthsToAdd: number): Date {
  const anchorDay = anchor.getUTCDate();
  const totalMonth = anchor.getUTCMonth() + monthsToAdd;
  const targetYear = anchor.getUTCFullYear() + Math.floor(totalMonth / 12);
  const targetMonthIndex0 = ((totalMonth % 12) + 12) % 12;
  const day = Math.min(anchorDay, daysInMonth(targetYear, targetMonthIndex0));
  return new Date(Date.UTC(targetYear, targetMonthIndex0, day));
}

/**
 * Toutes les dates d'occurrence de `rule` ancrées sur `anchorDate`, comprises
 * dans [rangeStart, rangeEnd] inclus. `ponctuel` ne produit jamais de
 * génération automatique (une seule occurrence, déjà créée manuellement) —
 * retourne toujours un tableau vide, jamais l'ancre elle-même en double.
 */
export function occurrenceDatesInRange(rule: RecurrenceRule, anchorDate: Date, rangeStart: Date, rangeEnd: Date): Date[] {
  const anchor = toUtcMidnight(anchorDate);
  const start = toUtcMidnight(rangeStart);
  const end = toUtcMidnight(rangeEnd);
  if (rule === 'ponctuel') return [];
  if (end.getTime() < start.getTime()) return [];

  const dates: Date[] = [];

  if (rule === 'hebdomadaire') {
    // Point de départ estimé (§16 — jamais un balayage k=0..N si `start` est loin de
    // l'ancre) : reculé d'une semaine par prudence, puis balayage linéaire normal.
    const approxK = Math.max(0, Math.floor((start.getTime() - anchor.getTime()) / (7 * 86400000)) - 1);
    let k = approxK;
    while (dates.length < MAX_GENERATED_OCCURRENCES) {
      const d = new Date(anchor.getTime() + k * 7 * 86400000);
      if (d.getTime() > end.getTime()) break;
      if (d.getTime() >= start.getTime()) dates.push(d);
      k += 1;
      if (k - approxK > MAX_GENERATED_OCCURRENCES) break; // garde-fou absolu, même si aucune date ne matchait encore
    }
    return dates;
  }

  const monthStep = MONTH_STEP[rule];
  if (!monthStep) return [];
  const approxMonthsDiff =
    (start.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (start.getUTCMonth() - anchor.getUTCMonth());
  const approxK = Math.max(0, Math.floor(approxMonthsDiff / monthStep) - 1);
  let k = approxK;
  while (dates.length < MAX_GENERATED_OCCURRENCES) {
    const d = addMonthsClamped(anchor, k * monthStep);
    if (d.getTime() > end.getTime()) break;
    if (d.getTime() >= start.getTime()) dates.push(d);
    k += 1;
    if (k - approxK > MAX_GENERATED_OCCURRENCES) break; // garde-fou absolu
  }
  return dates;
}
