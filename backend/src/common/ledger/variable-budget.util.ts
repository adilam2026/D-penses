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

import { clampClosingDay, daysInMonth, getFinancialPeriodBounds, getFinancialPeriodOf } from './financial-period.util';

export type ReferencePeriod = 'semaine' | 'mois';
export type ProjectionMode = 'contractuel' | 'rythme_reel' | 'prudent_max';

/**
 * Lot 6 — mode du mois pour referencePeriod='mois' (inerte pour 'semaine', même
 * convention que weekStartDay inerte pour 'mois'). "financier" réutilise
 * EXCLUSIVEMENT le moteur R6.3 (financial-period.util.ts) — jamais une seconde
 * définition du "mois financier" dans l'application (closingDay=25 => 26 août →
 * 25 septembre, identique à Home/Projection). "personnalise" a sa propre
 * convention, basée sur un jour de DÉPART (customStartDay=25 => 25 août →
 * 24 septembre) — volontairement différente de "financier" (jour de clôture),
 * jamais confondues.
 */
export type MonthMode = 'calendaire' | 'financier' | 'personnalise';

export interface PeriodWindow {
  start: Date; // minuit UTC, inclus
  end: Date; // minuit UTC, inclus
}

export interface BudgetLike {
  referenceAmount: number;
  referencePeriod: ReferencePeriod;
  weekStartDay: number; // 1=lundi..7=dimanche
  monthMode: MonthMode;
  // Résolus par l'appelant AVANT construction de ce BudgetLike — ce moteur pur
  // ne lit jamais HouseholdSettings/DB lui-même (cf. resolveEffectiveConfig,
  // même principe). financialClosingDay n'a de sens que si monthMode='financier'
  // (sinon toujours null) ; customStartDay que si monthMode='personnalise'.
  financialClosingDay: number | null;
  customStartDay: number | null;
  startDate: Date;
  endDate: Date | null;
}

function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDaysUTC(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
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

/**
 * Lot 6 — période "personnalise" : démarre au customStartDay clampé du mois
 * (dernier jour réel si le mois est plus court, ex. 31 → 28/29 en février),
 * se termine la veille du prochain départ clampé. Construction "prochain départ
 * moins un jour" : pavage contigu par construction, quel que soit le clamp,
 * jamais de dérive cumulative (cf. variable-budget.util.spec.ts, test de
 * contiguïté via periodEndExclusive). Convention DIFFÉRENTE de "financier"
 * (jour de départ, pas de clôture) — volontairement, jamais unifiées.
 */
function customMonthPeriod(anchor: Date, customStartDay: number): PeriodWindow {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  const day = anchor.getUTCDate();
  const clampedThisMonth = clampClosingDay(customStartDay, y, m);

  // Le mois où démarre la période contenant `anchor` : ce mois-ci si on est déjà
  // au jour de départ (clampé) ou après, sinon le mois précédent. Date.UTC(y, m-1, 1)
  // normalise nativement un débordement d'année (m=0 → décembre de y-1).
  const startsInThisMonth = day >= clampedThisMonth;
  const startMonthAnchor = startsInThisMonth ? new Date(Date.UTC(y, m, 1)) : new Date(Date.UTC(y, m - 1, 1));
  const sy = startMonthAnchor.getUTCFullYear();
  const sm = startMonthAnchor.getUTCMonth();
  const start = new Date(Date.UTC(sy, sm, clampClosingDay(customStartDay, sy, sm)));

  const nextMonthAnchor = new Date(Date.UTC(sy, sm + 1, 1));
  const ny = nextMonthAnchor.getUTCFullYear();
  const nm = nextMonthAnchor.getUTCMonth();
  const nextStart = new Date(Date.UTC(ny, nm, clampClosingDay(customStartDay, ny, nm)));

  return { start, end: addDaysUTC(nextStart, -1) };
}

/** Période calendaire (semaine ou mois réel) contenant `anchor` — jamais un raccourci arbitraire. */
export function nominalPeriod(
  budget: Pick<BudgetLike, 'referencePeriod' | 'weekStartDay' | 'monthMode' | 'financialClosingDay' | 'customStartDay'>,
  anchor: Date,
): PeriodWindow {
  const a = toUtcMidnight(anchor);
  if (budget.referencePeriod === 'semaine') {
    const start = startOfWeekUTC(a, budget.weekStartDay);
    return { start, end: addDaysUTC(start, 6) };
  }
  if (budget.monthMode === 'financier' && budget.financialClosingDay != null) {
    // Lot 6 — AUCUNE nouvelle définition : réutilise tel quel le moteur R6.3
    // déjà utilisé par Home/Projection pour le "mois financier" du foyer.
    const key = getFinancialPeriodOf(a, budget.financialClosingDay);
    return getFinancialPeriodBounds(key.year, key.monthIndex0, budget.financialClosingDay);
  }
  if (budget.monthMode === 'personnalise' && budget.customStartDay != null) {
    return customMonthPeriod(a, budget.customStartDay);
  }
  // calendaire (défaut) — comportement civil historique, strictement inchangé.
  const start = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1));
  const end = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), daysInMonth(a.getUTCFullYear(), a.getUTCMonth())));
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
    const period = nominalPeriod(budget, cursor);
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
  const nominal = nominalPeriod(budget, t);
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
  // Lot 3 — alerte de rythme : % consommé vs % de période écoulée (jamais
  // previsionRythmeRestant/rythmeProjete, qui restent des indicateurs informatifs
  // distincts). Protégés division par zéro ; consumptionRatio n'est PAS borné à 1
  // (un dépassement réel doit rester visible, jamais masqué par un plafonnage
  // artificiel) ; elapsedRatio reste toujours dans [0,1] (joursEcoules déjà
  // borné à [1, nominalTotalDays] ci-dessous, §11).
  consumptionRatio: number;
  elapsedRatio: number;
  rythmeAlerte: boolean; // consumptionRatio > elapsedRatio
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
  const nominal = nominalPeriod(budget, t);
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

  // Lot 3 — alerte de rythme (distincte de budgetHealthStatus, basé ratio consommé/plafond
  // seul) : consommé-vs-plafond comparé à écoulé-vs-période, jamais rythmeProjete/
  // previsionRythmeRestant (indicateurs informatifs, ne définissent pas l'alerte métier).
  // Réutilise budgetPeriode/consommeADate/joursEcoules/nominalTotalDays déjà calculés
  // ci-dessus — aucun nouveau moteur, aucune modification du calcul de fenêtre de période.
  const consumptionRatio = budgetPeriode > 0 ? consommeADate / budgetPeriode : consommeADate > 0 ? 1 : 0;
  const elapsedRatio = nominalTotalDays > 0 ? joursEcoules / nominalTotalDays : 0;
  const rythmeAlerte = consumptionRatio > elapsedRatio;

  return {
    periodStart,
    periodEnd,
    budgetPeriode,
    consommeADate: round2(consommeADate),
    budgetContractuelRestant,
    rythmeProjete: round2(rythmeProjete), // « Projection au rythme actuel » (§13) — total projeté, distinct du restant
    previsionRythmeRestant,
    projectionPrudenteRestante: round2(projectionPrudenteRestante),
    consumptionRatio: round2(consumptionRatio),
    elapsedRatio: round2(elapsedRatio),
    rythmeAlerte,
  };
}

export type BudgetHealthStatus = 'sous_budget' | 'proche_limite' | 'depasse';

/** Statut continu d'affichage (docs/02 §F.3) — jamais stocké, toujours calculé.
 *  Historique (80/100%, 3 valeurs) — consommé par le portail WEB-V4.4A en
 *  standby (BudgetsScreen.web.tsx/HomeScreen.web.tsx via budgetsLogic.ts) :
 *  jamais modifié ni retiré, jamais réutilisé pour M3 §8 dimension B ci-dessous
 *  (seuils distincts, cf. thresholdLevel). */
export function budgetHealthStatus(consommeADate: number, budgetPeriode: number): BudgetHealthStatus {
  if (budgetPeriode <= 0) return consommeADate > 0 ? 'depasse' : 'sous_budget';
  const ratio = consommeADate / budgetPeriode;
  if (ratio >= 1) return 'depasse';
  if (ratio >= 0.8) return 'proche_limite';
  return 'sous_budget';
}

// M3 §8 (dimension B — seuils absolus de consommation, distincts de la dimension
// A — rythme/rythmeAlerte, jamais fusionnés) — RÈGLE MÉTIER PARTAGÉE : calculée
// une seule fois ici (moteur commun), jamais recalculée côté mobile ni côté web
// (« Mobile et Web consomment les mêmes règles métier »). Le rendu (badge/
// couleur/texte) reste local à chaque client ; seul l'ÉTAT (quel palier, quel
// montant de dépassement) est une donnée serveur. consumptionRatio n'est jamais
// plafonné (cf. ci-dessus) : un dépassement réel produit toujours 'depasse',
// quelle que soit son ampleur. 100% exact est un état PROPRE ('atteint'),
// distinct de 90–<100% ET de >100% — jamais confondu avec l'un ou l'autre.
export type ThresholdLevel = 'sous_60' | 'entre_60_75' | 'entre_75_90' | 'entre_90_100' | 'atteint' | 'depasse';

export function consumptionThresholdLevel(consumptionRatio: number): ThresholdLevel {
  if (consumptionRatio > 1) return 'depasse';
  if (consumptionRatio === 1) return 'atteint';
  if (consumptionRatio >= 0.9) return 'entre_90_100';
  if (consumptionRatio >= 0.75) return 'entre_75_90';
  if (consumptionRatio >= 0.6) return 'entre_60_75';
  return 'sous_60';
}

/** §8 — montant de dépassement explicite ("Budget dépassé de X DH"), jamais
 *  seulement un pourcentage. budgetContractuelRestant est déjà négatif en cas
 *  de dépassement : ce montant en est l'opposé (0 si non dépassé). */
export function budgetExceededAmount(budgetContractuelRestant: number): number {
  return budgetContractuelRestant < 0 ? round2(-budgetContractuelRestant) : 0;
}

/**
 * Lot 4 — historique des modifications d'un budget (§1/§2/§3 de la demande).
 *
 * CONVENTION TEMPORELLE UNIQUE, appliquée partout dans ce lot : tout intervalle
 * est SEMI-OUVERT [début, fin) — la borne de fin n'appartient JAMAIS à
 * l'intervalle qu'elle clôt, elle appartient au suivant.
 *   - une période budgétaire est [periodStart, periodEndExclusive) — jamais
 *     [periodStart, periodEnd] (periodEnd, tel que renvoyé par nominalPeriod/
 *     getCurrentPeriodWindow, est minuit UTC du DERNIER jour de la période —
 *     donc un instant DANS cette période, pas sa borne de sortie) ;
 *   - un segment de versionnement (VariableBudgetVersion) est [validFrom, validTo) ;
 *   - les dépenses (BudgetExpense.spentDate) sont filtrées avec la même borne
 *     exclusive (déjà le cas historiquement via exclusiveEnd, cf. plus bas).
 *
 * Conséquence directe : une modification dont l'instant tombe EXACTEMENT sur
 * periodEndExclusive appartient à la période SUIVANTE, jamais à celle qui se
 * termine — c'est cette règle que resolveEffectiveConfig doit respecter pour
 * la valeur "finale/ajustée" d'une période (jamais interrogée à periodEnd lui-même,
 * qui n'est pas la vraie borne de sortie, mais au dernier instant strictement
 * avant periodEndExclusive).
 */

/** Borne de sortie EXCLUSIVE d'une période — le premier instant qui n'en fait
 *  plus partie (minuit UTC du jour suivant periodEnd). Même fonction que
 *  l'ancien VariableBudgetsService.exclusiveEnd, centralisée ici pour que le
 *  service et la résolution de version partagent une seule définition. */
export function periodEndExclusive(periodEnd: Date): Date {
  return new Date(periodEnd.getTime() + 86400000);
}

export interface VersionedSnapshot {
  referenceAmount: number;
  referencePeriod: ReferencePeriod;
  categoryId: string;
  categoryTypeId: string | null;
  weekStartDay: number;
  // Lot 6 — suivis au même titre que les champs ci-dessus (édités par
  // l'utilisateur via PATCH, diffés dans getHistory()).
  monthMode: MonthMode;
  customStartDay: number | null;
  includeInPrudentProjection: boolean;
  endDate: Date | null;
  validFrom: Date;
  validTo: Date;
  // Lot 6 — HORS des champs suivis ci-dessus : jamais éditable directement,
  // jamais diffé/affiché comme une "modification". Ancre technique uniquement,
  // cf. resolveFinancialClosingDay ci-dessous et le commentaire sur le modèle
  // Prisma VariableBudgetVersion.financialClosingDaySnapshot.
  financialClosingDaySnapshot: number | null;
}

/**
 * Résolution pure, sans dépendance DB, de la configuration effective d'un
 * budget à un instant précis `at`. `versions` = tous les segments CLOS déjà
 * connus pour ce budget (peu importe l'ordre) ; `liveConfig` = l'état vivant
 * actuel de VariableBudget.
 *
 * `at` doit être l'instant exact demandé — JAMAIS periodEnd directement pour
 * une résolution "de fin de période" : voir periodEndExclusive ci-dessus.
 * Pour resoudre la valeur finale/ajustée d'une période, appeler avec
 * `new Date(periodEndExclusive(periodEnd).getTime() - 1)` (dernier instant
 * réellement inclus dans la période, cf. VariableBudgetsService).
 *
 * Trois cas, du plus récent au plus ancien :
 *  1. `at` postérieur ou égal au dernier changement connu (ou aucun changement
 *     jamais enregistré) → la ligne vivante fait foi (période courante, ou
 *     budget jamais modifié).
 *  2. `at` couvert par un segment clos → ce segment fait foi (période passée
 *     déjà figée par une modification ultérieure).
 *  3. `at` ANTÉRIEUR au premier segment clos connu (ex. startDate très
 *     antérieure à la création du budget, cas standard — un budget "actif
 *     depuis 2020" créé aujourd'hui) → extrapole la plus ANCIENNE valeur
 *     CONNUE (le premier segment) plutôt que la ligne vivante : aucune trace
 *     antérieure à la création du budget n'existe, donc la meilleure
 *     information disponible reste la configuration en vigueur dès la
 *     création, jamais une valeur issue d'une modification qui n'existait pas
 *     encore à cet instant (sinon une modification faite aujourd'hui
 *     changerait rétroactivement l'interprétation d'une période ancienne
 *     couverte par un startDate passé — exactement ce que ce lot interdit).
 */
export function resolveEffectiveConfig<TVersion extends VersionedSnapshot, TLive>(
  versions: TVersion[],
  liveConfig: TLive,
  at: Date,
): TVersion | TLive {
  if (versions.length === 0) return liveConfig;
  const sorted = [...versions].sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
  const t = at.getTime();
  if (t < sorted[0].validFrom.getTime()) return sorted[0];
  const match = sorted.find((v) => v.validFrom.getTime() <= t && t < v.validTo.getTime());
  return match ?? liveConfig;
}

/**
 * Lot 6 — erreur d'invariant : un segment VariableBudgetVersion figé en
 * monthMode='financier' DOIT porter un financialClosingDaySnapshot non null
 * (posé à CHAQUE création de segment pour un tel budget, cf. VariableBudgetsService).
 * Un segment financier sans snapshot est une donnée incohérente — jamais
 * silencieusement comblée par le closingDay live, ce qui réintroduirait de la
 * rétroactivité (exactement ce que ce lot interdit).
 */
export class FinancialClosingDaySnapshotMissingError extends Error {
  constructor(context: string) {
    super(`Segment de budget monthMode=financier sans financialClosingDaySnapshot (donnée incohérente) — ${context}`);
    this.name = 'FinancialClosingDaySnapshotMissingError';
  }
}

/**
 * Résout le closingDay effectif à utiliser pour un `BudgetLike` déjà résolu
 * (`resolveEffectiveConfig`), SANS aucun repli implicite vers le closingDay live
 * pour un segment historique figé — voir FinancialClosingDaySnapshotMissingError.
 *
 *  - monthMode ≠ 'financier' → null (inerte).
 *  - `resolved` est la ligne vivante (pas de financialClosingDaySnapshot dans
 *    son type — jamais un segment figé) → closingDay live (source de vérité
 *    courante, cf. HouseholdSettings).
 *  - `resolved` est un segment figé (VersionedSnapshot) → OBLIGATOIREMENT
 *    resolved.financialClosingDaySnapshot ; lève FinancialClosingDaySnapshotMissingError
 *    si null (jamais de repli vers liveClosingDay).
 */
export function resolveFinancialClosingDay(
  resolved: { monthMode: MonthMode } & Partial<Pick<VersionedSnapshot, 'financialClosingDaySnapshot'>>,
  liveClosingDay: number,
  context: string,
): number | null {
  if (resolved.monthMode !== 'financier') return null;
  if (!('financialClosingDaySnapshot' in resolved)) return liveClosingDay; // ligne vivante
  if (resolved.financialClosingDaySnapshot == null) throw new FinancialClosingDaySnapshotMissingError(context);
  return resolved.financialClosingDaySnapshot;
}
