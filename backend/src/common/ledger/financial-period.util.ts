/**
 * R6.3 (points A/C/J) — moteur UNIQUE de « période financière » du foyer.
 *
 * Le jour de clôture (HouseholdSettings.closingDay, 1-31, foyer) est une
 * dimension purement ANALYTIQUE : il ne modifie JAMAIS une date réelle
 * (Payment.paidDate, IncomeOccurrence.actualDate, Deadline.dueDate,
 * AccountTransfer.plannedDate...). Il sert uniquement à déterminer, pour une
 * date réelle donnée, à quelle « période financière » (mois de clôture) elle
 * appartient — Home, Projection, et tout futur usage doivent réutiliser CE
 * SEUL moteur, jamais un recalcul parallèle (RG implicite point A).
 *
 * Convention (exemple clôture=25) : une période financière est nommée d'après
 * le mois civil où elle SE TERMINE. « Septembre 2026 » = 26/08/2026 →
 * 25/09/2026. Une date tombant le jour de clôture ou avant appartient à la
 * période qui se termine ce mois-ci ; après, à la période suivante :
 *   25/09 → Septembre · 26/09 → Octobre · 27/09 → Octobre.
 *
 * Mois courts (point C) : si closingDay vaut 29/30/31 et que le mois civil
 * n'a pas ce jour, la clôture EFFECTIVE de CE mois précis tombe sur son
 * dernier jour valide — jamais un décalage qui « dégraderait » la valeur
 * configurée pour les mois suivants (closingDay reste 31 en mémoire ; seul le
 * calcul du mois court le clampe, mois par mois, indépendamment des autres).
 */

export interface FinancialPeriodKey {
  year: number;
  monthIndex0: number; // 0 = janvier, comme Date.getUTCMonth()
}

export interface FinancialPeriodBounds {
  start: Date; // UTC minuit, jour suivant la clôture de la période précédente
  end: Date; // UTC minuit, jour de clôture (clampé) de cette période
}

export const MONTH_LABELS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

export const DEFAULT_CLOSING_DAY = 31;

function normalizePeriod(year: number, monthIndex0: number): FinancialPeriodKey {
  const y = year + Math.floor(monthIndex0 / 12);
  const m = ((monthIndex0 % 12) + 12) % 12;
  return { year: y, monthIndex0: m };
}

/** Nombre de jours réels du mois civil (year, monthIndex0). */
export function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/**
 * Clôture EFFECTIVE de ce mois précis : le jour configuré, ou le dernier jour
 * du mois s'il n'existe pas (mois court, point C) — jamais mémorisé, recalculé
 * à chaque appel pour que closingDay=31 revienne bien à 31 en mars après un
 * février clampé à 28/29.
 */
export function clampClosingDay(closingDay: number, year: number, monthIndex0: number): number {
  return Math.min(closingDay, daysInMonth(year, monthIndex0));
}

function periodEndDate(year: number, monthIndex0: number, closingDay: number): Date {
  const p = normalizePeriod(year, monthIndex0);
  const day = clampClosingDay(closingDay, p.year, p.monthIndex0);
  return new Date(Date.UTC(p.year, p.monthIndex0, day));
}

/** Bornes réelles [début, fin] (UTC minuit, inclusives) de la période (year, monthIndex0). */
export function getFinancialPeriodBounds(year: number, monthIndex0: number, closingDay: number): FinancialPeriodBounds {
  const end = periodEndDate(year, monthIndex0, closingDay);
  const prev = normalizePeriod(year, monthIndex0 - 1);
  const prevEnd = periodEndDate(prev.year, prev.monthIndex0, closingDay);
  const start = new Date(prevEnd.getTime() + 86400000);
  return { start, end };
}

/**
 * Période financière (nommée d'après son mois de fin) à laquelle appartient
 * une date réelle donnée. La date n'est jamais modifiée — uniquement classée.
 */
export function getFinancialPeriodOf(date: Date, closingDay: number): FinancialPeriodKey {
  const year = date.getUTCFullYear();
  const monthIndex0 = date.getUTCMonth();
  const day = date.getUTCDate();
  const effectiveClosing = clampClosingDay(closingDay, year, monthIndex0);
  if (day <= effectiveClosing) return { year, monthIndex0 };
  return normalizePeriod(year, monthIndex0 + 1);
}

/** Clé "YYYY-MM" — même format que le bucketing calendaire déjà utilisé partout ailleurs. */
export function financialPeriodKeyString(period: FinancialPeriodKey): string {
  return `${period.year}-${String(period.monthIndex0 + 1).padStart(2, '0')}`;
}

/** Raccourci : clé "YYYY-MM" de la période financière d'une date réelle. */
export function financialPeriodKeyOf(date: Date, closingDay: number): string {
  return financialPeriodKeyString(getFinancialPeriodOf(date, closingDay));
}

/** Libellé humain ("Septembre 2026") d'une période — jamais le mois civil de la date, le mois de clôture. */
export function financialPeriodLabel(period: FinancialPeriodKey): string {
  return `${MONTH_LABELS_FR[period.monthIndex0]} ${period.year}`;
}

/** Période décalée de `delta` mois financiers (peut être négatif). */
export function shiftFinancialPeriod(period: FinancialPeriodKey, delta: number): FinancialPeriodKey {
  return normalizePeriod(period.year, period.monthIndex0 + delta);
}
