import { Prisma, RecurrenceFrequency } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

/** Horizon de génération (Checkpoint 3 §21) — jamais des années infinies, un an glissant seulement. */
export const RECURRENCE_HORIZON_MONTHS = 12;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pas en mois des fréquences mensuelles (jamais WEEKLY ni ONCE). */
const MONTH_STEP: Partial<Record<RecurrenceFrequency, number>> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  YEARLY: 12,
};

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Index absolu d'un mois (année × 12 + mois) — arithmétique de mois sans jour. */
function monthIndex(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

/** Jour `day` du mois d'index absolu `absMonth`, ou son dernier jour si `day` n'y existe pas. */
function clampedDate(absMonth: number, day: number): Date {
  const year = Math.floor(absMonth / 12);
  const month = absMonth - year * 12;
  return new Date(Date.UTC(year, month, Math.min(day, lastDayOfMonth(year, month))));
}

/**
 * Définition d'une série : `anchorDate` = point de départ de la version
 * courante (mois de l'occurrence n°0), `anchorDay` = jour métier d'origine
 * (1..31, à défaut le jour d'anchorDate).
 */
export interface SeriesSpec {
  anchorDate: Date;
  anchorDay?: number | null;
  frequency: RecurrenceFrequency;
}

export interface SeriesOccurrence {
  index: number;
  date: Date;
}

function anchorDayOf(spec: SeriesSpec): number {
  return spec.anchorDay ?? spec.anchorDate.getUTCDate();
}

/**
 * Date de l'occurrence n°k, calculée DIRECTEMENT depuis l'ancrage — jamais
 * depuis l'occurrence précédente. Fréquences mensuelles : jour d'origine dans
 * le mois (ancrage + k × pas), ou dernier jour de ce mois s'il n'existe pas
 * (31/01 → 28/02 → 31/03 → 30/04…). WEEKLY : ancrage + 7k jours. ONCE : seule
 * l'occurrence n°0 existe.
 */
export function occurrenceDate(spec: SeriesSpec, index: number): Date {
  const anchor = startOfUtcDay(spec.anchorDate);
  if (spec.frequency === 'WEEKLY') return new Date(anchor.getTime() + index * 7 * DAY_MS);
  if (spec.frequency === 'ONCE') return anchor;
  const step = MONTH_STEP[spec.frequency]!;
  return clampedDate(monthIndex(anchor) + index * step, anchorDayOf(spec));
}

/**
 * Occurrences (n°, date) de la série comprises dans [rangeStart, rangeEnd]
 * (bornes incluses). Le premier n° utile est calculé directement : aucune
 * itération depuis l'ancrage, même pour une plage très lointaine.
 */
export function computeOccurrences(spec: SeriesSpec, rangeStart: Date, rangeEnd: Date): SeriesOccurrence[] {
  const anchor = startOfUtcDay(spec.anchorDate);
  const start = startOfUtcDay(rangeStart);
  const end = startOfUtcDay(rangeEnd);
  if (end < anchor || end < start) return [];

  if (spec.frequency === 'ONCE') return anchor >= start ? [{ index: 0, date: anchor }] : [];

  let k: number;
  if (spec.frequency === 'WEEKLY') {
    k = Math.max(0, Math.floor((start.getTime() - anchor.getTime()) / (7 * DAY_MS)));
  } else {
    const step = MONTH_STEP[spec.frequency]!;
    k = Math.max(0, Math.floor((monthIndex(start) - monthIndex(anchor)) / step) - 1);
  }
  const result: SeriesOccurrence[] = [];
  for (let guard = 0; guard < 5000; guard++, k++) {
    const date = occurrenceDate(spec, k);
    if (date > end) break;
    if (date >= start) result.push({ index: k, date });
  }
  return result;
}

/** Dates seules (compatibilité) — mêmes règles que computeOccurrences. */
export function computeOccurrenceDates(anchorDate: Date, frequency: RecurrenceFrequency, rangeStart: Date, rangeEnd: Date, anchorDay?: number | null): Date[] {
  return computeOccurrences({ anchorDate, anchorDay, frequency }, rangeStart, rangeEnd).map((o) => o.date);
}

/**
 * ANCIEN calcul (avant ce lot), conservé uniquement pour rattacher les
 * occurrences déjà en base sans n° à leur n° logique, tant que la reprise
 * n'a pas été exécutée : chaque date dérivait de la PRÉCÉDENTE, et un jour
 * absent du mois cible débordait sur le mois suivant (31/01 → 03/03 → 03/04).
 */
export function legacyOccurrenceDates(anchorDate: Date, frequency: RecurrenceFrequency, until: Date): Date[] {
  const anchor = startOfUtcDay(anchorDate);
  const end = startOfUtcDay(until);
  if (frequency === 'ONCE') return anchor <= end ? [anchor] : [];
  const dates: Date[] = [];
  let cursor = anchor;
  for (let guard = 0; cursor <= end && guard < 5000; guard++) {
    dates.push(cursor);
    if (frequency === 'WEEKLY') {
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 7));
    } else {
      const step = MONTH_STEP[frequency]!;
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + step, cursor.getUTCDate()));
    }
  }
  return dates;
}

type RuleRow = Awaited<ReturnType<TxClient['recurrenceRule']['findMany']>>[number];

export function seriesSpecOf(rule: Pick<RuleRow, 'anchorDate' | 'anchorDay' | 'frequency'>): SeriesSpec {
  return { anchorDate: rule.anchorDate, anchorDay: rule.anchorDay, frequency: rule.frequency };
}

/** Ligne déjà en base, vue sous l'angle de l'occupation des n° de série. */
export interface StoredOccurrenceRow {
  recurrenceRuleId: string | null;
  occurrenceIndex: number | null;
  seriesVersion: number | null;
  expectedDate: Date;
}

/**
 * N° de la version COURANTE de la règle déjà pris par une ligne en base —
 * quels que soient sa date et son statut (payée, modifiée, déplacée,
 * annulée) : le moteur ne recrée jamais une occurrence logique existante.
 * - lignes de la version courante : leur n° ;
 * - lignes antérieures à ce lot (n° NULL), version 0 : n° retrouvé via
 *   l'ANCIEN calcul de dates (cohabitation avant reprise) ;
 * - lignes d'une version antérieure (changement de cadence) postérieures au
 *   début de la version courante : elles couvrent l'occurrence de la nouvelle
 *   version du même mois (même date pour WEEKLY/ONCE) — jamais recréée.
 */
export function occupiedIndexes(rule: Pick<RuleRow, 'id' | 'anchorDate' | 'anchorDay' | 'frequency' | 'seriesVersion'>, rows: StoredOccurrenceRow[]): Set<number> {
  const occupied = new Set<number>();
  const spec = seriesSpecOf(rule);
  const versionStart = startOfUtcDay(rule.anchorDate);
  const own = rows.filter((r) => r.recurrenceRuleId === rule.id);

  const legacy = own.filter((r) => r.occurrenceIndex === null);
  const legacyByDate = new Map<string, number>();
  if (rule.seriesVersion === 0 && legacy.length > 0) {
    const until = legacy.reduce((max, r) => (r.expectedDate > max ? r.expectedDate : max), versionStart);
    legacyOccurrenceDates(rule.anchorDate, rule.frequency, until).forEach((date, k) => legacyByDate.set(date.toISOString().slice(0, 10), k));
  }

  for (const row of own) {
    if (row.occurrenceIndex !== null && row.seriesVersion === rule.seriesVersion) {
      occupied.add(row.occurrenceIndex);
      continue;
    }
    if (row.occurrenceIndex === null && rule.seriesVersion === 0) {
      const k = legacyByDate.get(row.expectedDate.toISOString().slice(0, 10));
      if (k !== undefined) occupied.add(k);
      continue;
    }
    // Version antérieure (ou ligne historique d'avant un changement de cadence).
    const date = startOfUtcDay(row.expectedDate);
    if (date < new Date(Date.UTC(versionStart.getUTCFullYear(), versionStart.getUTCMonth(), 1))) continue;
    const covered = coveredIndex(spec, date);
    if (covered !== null) occupied.add(covered);
  }
  return occupied;
}

/** N° de la série dont l'occurrence tombe dans la même période que `date` (même mois ; même jour pour WEEKLY/ONCE). */
function coveredIndex(spec: SeriesSpec, date: Date): number | null {
  const anchor = startOfUtcDay(spec.anchorDate);
  if (spec.frequency === 'ONCE') return date.getTime() === anchor.getTime() ? 0 : null;
  if (spec.frequency === 'WEEKLY') {
    const diff = (date.getTime() - anchor.getTime()) / DAY_MS;
    return diff >= 0 && diff % 7 === 0 ? diff / 7 : null;
  }
  const step = MONTH_STEP[spec.frequency]!;
  const months = monthIndex(date) - monthIndex(anchor);
  return months >= 0 && months % step === 0 ? months / step : null;
}

/** Fin de la fenêtre glissante : la veille du même jour, `months` mois plus tard (borné au dernier jour du mois). */
function horizonEnd(from: Date, months: number): Date {
  const day = startOfUtcDay(from);
  const sameDayLater = clampedDate(monthIndex(day) + months, day.getUTCDate());
  return new Date(sameDayLater.getTime() - DAY_MS);
}

/**
 * Génère les planned_operations manquantes pour toutes les règles actives du
 * foyer, jusqu'à RECURRENCE_HORIZON_MONTHS à partir d'aujourd'hui — jamais
 * au-delà (§21). Idempotent (§20) : une occurrence logique (règle, version,
 * n°) déjà en base n'est jamais recréée, quelle que soit sa date. Appelé
 * paresseusement à chaque lecture du Planning — la fenêtre glissante "se
 * complète progressivement" avec le temps.
 */
export async function ensurePlannedOccurrences(tx: TxClient, householdId: string, horizonMonths = RECURRENCE_HORIZON_MONTHS): Promise<void> {
  const rangeStart = new Date();
  await ensurePlannedOccurrencesInRange(tx, householdId, rangeStart, horizonEnd(rangeStart, horizonMonths));
}

/** Champs d'une occurrence copiés du gabarit de la règle (puis indépendants par occurrence). */
function occurrenceFromRule(householdId: string, rule: RuleRow, occurrence: SeriesOccurrence) {
  return {
    householdId,
    kind: rule.kind,
    recurrenceRuleId: rule.id,
    occurrenceIndex: occurrence.index,
    seriesVersion: rule.seriesVersion,
    categoryId: rule.categoryId,
    financialPlanItemId: rule.financialPlanItemId,
    financialPlanDeadlineId: rule.financialPlanDeadlineId,
    sourceAccountId: rule.sourceAccountId,
    sourceSubaccountId: rule.sourceSubaccountId,
    destinationAccountId: rule.destinationAccountId,
    destinationSubaccountId: rule.destinationSubaccountId,
    expectedAmount: rule.expectedAmount,
    expectedDate: occurrence.date,
    label: rule.label ?? 'Récurrence',
    // Lot "À faire" — même mécanique que source/montant ci-dessus : le
    // gabarit porte responsable/inclusion, chaque occurrence générée les
    // copie puis vit indépendamment (modifiable occurrence par occurrence).
    responsibleMemberId: rule.responsibleMemberId,
    responsibleSource: rule.responsibleSource,
    includeInTodo: rule.includeInTodo,
  };
}

/** Jamais de génération dans le passé : une date antérieure à aujourd'hui relève de l'historique. */
function notBeforeToday(date: Date): Date {
  const today = startOfUtcDay(new Date());
  return date < today ? today : date;
}

/** Occurrences manquantes (n° non occupés) de chaque règle active sur la plage. */
async function missingOccurrences(tx: TxClient, householdId: string, rangeStart: Date, rangeEnd: Date): Promise<{ rule: RuleRow; occurrences: SeriesOccurrence[] }[]> {
  const start = notBeforeToday(rangeStart);
  if (start > rangeEnd) return [];
  const rules = await tx.recurrenceRule.findMany({ where: { householdId, active: true } });
  if (rules.length === 0) return [];
  const rows = await tx.plannedOperation.findMany({
    where: { recurrenceRuleId: { in: rules.map((r) => r.id) } },
    select: { recurrenceRuleId: true, occurrenceIndex: true, seriesVersion: true, expectedDate: true },
  });
  return rules
    .map((rule) => {
      const occupied = occupiedIndexes(rule, rows);
      return { rule, occurrences: computeOccurrences(seriesSpecOf(rule), start, rangeEnd).filter((o) => !occupied.has(o.index)) };
    })
    .filter((r) => r.occurrences.length > 0);
}

/**
 * Matérialise les occurrences manquantes des règles actives sur
 * [rangeStart, rangeEnd] uniquement (dates passées exclues). Une occurrence
 * logique existante (modifiée, payée, annulée ou déplacée) n'est jamais
 * recréée ni écrasée — garantie par le n° d'occurrence, plus par la date, et
 * par l'unicité (règle, version, n°) en base. Utilisée par le Planning et À
 * faire pour la plage consultée au-delà de la fenêtre de 12 mois.
 */
export async function ensurePlannedOccurrencesInRange(tx: TxClient, householdId: string, rangeStart: Date, rangeEnd: Date): Promise<void> {
  for (const { rule, occurrences } of await missingOccurrences(tx, householdId, rangeStart, rangeEnd)) {
    await tx.plannedOperation.createMany({
      data: occurrences.map((occurrence) => occurrenceFromRule(householdId, rule, occurrence)),
      skipDuplicates: true,
    });
  }
}

/**
 * Point d'entrée commun Planning / À faire avant toute lecture d'une période
 * consultée : fenêtre glissante de 12 mois à jour, puis occurrences
 * manquantes de la période elle-même (même règles, mêmes garanties).
 */
export async function ensureOccurrencesForPeriod(tx: TxClient, householdId: string, periodStart: Date, periodEnd: Date): Promise<void> {
  await ensurePlannedOccurrences(tx, householdId);
  await ensurePlannedOccurrencesInRange(tx, householdId, periodStart, periodEnd);
}

/**
 * Occurrences que les règles actives produiraient sur [rangeStart, rangeEnd]
 * sans être encore en base — CALCULÉES EN MÉMOIRE, jamais enregistrées.
 * Sert uniquement aux mois intermédiaires d'une projection cumulée (ni
 * affichés ni actionnables). Mêmes n° occupés que la matérialisation : une
 * occurrence annulée, déplacée ou modifiée n'est jamais réintroduite.
 */
export async function virtualPlannedOccurrences(tx: TxClient, householdId: string, rangeStart: Date, rangeEnd: Date) {
  return (await missingOccurrences(tx, householdId, rangeStart, rangeEnd)).flatMap(({ rule, occurrences }) =>
    occurrences.map((occurrence) => ({
      ...occurrenceFromRule(householdId, rule, occurrence),
      id: `virtual:${rule.id}|${rule.seriesVersion}|${occurrence.index}`,
      status: 'PENDING' as const,
      realizedOperationId: null,
      manuallyEdited: false,
    })),
  );
}

/**
 * Identité logique (n°, version) d'une ligne récurrente. Une ligne antérieure
 * à ce lot (n° NULL) est rattachée à son n° via l'ancien calcul de dates —
 * à faire AVANT de changer sa date, sinon son emplacement logique ne serait
 * plus reconnu et le moteur le recréerait à sa date théorique.
 */
export async function resolveOccurrenceIdentity(
  tx: TxClient,
  row: { recurrenceRuleId: string | null; occurrenceIndex: number | null; seriesVersion: number | null; expectedDate: Date },
): Promise<{ occurrenceIndex: number | null; seriesVersion: number | null }> {
  if (!row.recurrenceRuleId || row.occurrenceIndex !== null) return { occurrenceIndex: row.occurrenceIndex, seriesVersion: row.seriesVersion };
  const rule = await tx.recurrenceRule.findUnique({ where: { id: row.recurrenceRuleId } });
  if (!rule || rule.seriesVersion !== 0) return { occurrenceIndex: null, seriesVersion: null };
  const target = startOfUtcDay(row.expectedDate).getTime();
  const k = legacyOccurrenceDates(rule.anchorDate, rule.frequency, row.expectedDate).findIndex((date) => date.getTime() === target);
  return k >= 0 ? { occurrenceIndex: k, seriesVersion: 0 } : { occurrenceIndex: null, seriesVersion: null };
}

/**
 * Crée l'occurrence n°0 de la version courante de la règle (pivot d'un
 * changement de cadence), même si sa date est passée — sauf si ce n° est
 * déjà occupé, par exemple par une occurrence de l'ancienne version payée,
 * modifiée ou annulée dans le même mois : jamais de doublon logique.
 */
export async function createVersionPivot(tx: TxClient, householdId: string, rule: RuleRow): Promise<void> {
  const rows = await tx.plannedOperation.findMany({
    where: { recurrenceRuleId: rule.id },
    select: { recurrenceRuleId: true, occurrenceIndex: true, seriesVersion: true, expectedDate: true },
  });
  if (occupiedIndexes(rule, rows).has(0)) return;
  const pivot = { index: 0, date: occurrenceDate(seriesSpecOf(rule), 0) };
  await tx.plannedOperation.createMany({ data: [occurrenceFromRule(householdId, rule, pivot)], skipDuplicates: true });
}
