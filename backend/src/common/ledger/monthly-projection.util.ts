import { Prisma } from '@prisma/client';
import { round2 } from './ledger.util';
import { computeProjection, ProjectionEventSummary } from './projection.util';

type TxClient = Prisma.TransactionClient;

/**
 * Projection Globale Mensuelle (Round 4). AUCUN second moteur financier : ce fichier
 * appelle `computeProjection` (Lot 7/8, projection.util.ts) UNE SEULE FOIS pour tout
 * l'horizon demandé, puis regroupe par mois calendaire les événements déjà calculés —
 * source de vérité unique (§19), jamais de recalcul indépendant des revenus/dépenses.
 *
 * Revenu/dépense mensuel = somme des événements `kind` ∈ {income, deadline,
 * variable_budget} dont la date tombe dans le mois — jamais `kind` ∈ {transfer,
 * pocket_movement, simulated_expense} : un transfert interne est toujours net zéro
 * consolidé (§15), une contribution/retrait de Provision/Poche n'est jamais une
 * dépense (§15/§17 F), une Provision elle-même n'est jamais comptée séparément —
 * c'est la Deadline qu'elle couvre qui porte le montant consolidé (RG-095, enveloppe
 * ≠ compte). PRÉVU ≠ RÉEL (§14/§15) est déjà garanti en amont par computeProjection
 * (seules les IncomeOccurrence status='prevu' et les Deadline ouvertes/partielles y
 * entrent — un revenu déjà 'recu' ou une Deadline déjà 'soldee' n'y apparaissent
 * jamais, donc jamais compté deux fois avec leur pendant réel déjà dans le solde
 * d'ouverture de la trésorerie).
 */

export const UNDETERMINED_ACCOUNT = '__undetermined__';

export interface MonthlyLineItem {
  entityType: 'income_occurrence' | 'deadline' | 'variable_budget';
  entityId: string;
  label: string;
  date: string; // jour exact (ISO) où l'événement tombe dans le mois
  amount: number; // toujours positif — le signe est déjà porté par incomeItems/expenseItems
  accountId: string | null;
  accountKnown: boolean;
  amountStatus?: 'estime' | 'confirme';
  category?: 'obligatoire' | 'flexible' | 'projet'; // dépenses uniquement (§9)
  financialPlanId?: string | null;
  movable: boolean; // action "Déplacer" réellement disponible (§10/§11)
}

export interface MonthBucket {
  month: string; // "2026-11"
  label: string; // "Novembre 2026"
  totalIncome: number;
  totalExpense: number;
  balance: number;
  cumulativeBalance: number;
  incomeItems: MonthlyLineItem[];
  expenseItems: MonthlyLineItem[];
  movableExpenseTotal: number; // §10 "dépenses potentiellement décalables"
  isComplete: boolean;
  unknownCount: number;
  unknownLabels: string[];
  containsEstimates: boolean;
  excludedByFilterCount: number; // §4 — jamais silencieux : toujours renvoyé même à 0
  excludedByFilterTotal: number;
}

export interface MonthlyProjectionSummary {
  totalIncome: number;
  totalExpense: number;
  totalBalance: number;
  deficitMonthsCount: number;
  worstMonth: { month: string; balance: number } | null;
  maxMonthlyDeficit: number | null; // valeur positive (ampleur du pire déficit mensuel)
  maxFinancingNeed: number | null; // §6 — pire creux du cumul, positif, null si jamais négatif
  firstPositiveCumulativeMonth: string | null; // §7 — premier retour positif après un creux
  isComplete: boolean;
  incompleteMonthsCount: number;
}

export interface MonthlyProjectionResult {
  referenceDate: string;
  horizonEnd: string;
  horizonMonths: number;
  months: MonthBucket[];
  summary: MonthlyProjectionSummary;
  accountFilters: { incomeAccountIds: string[] | null; expenseAccountIds: string[] | null };
}

export interface MonthlyProjectionOptions {
  incomeAccountIds?: string[] | null; // null/undefined = "Tous" ; peut inclure UNDETERMINED_ACCOUNT
  expenseAccountIds?: string[] | null;
  dateOverrides?: Map<string, Date>; // simulation (§12/§13) — jamais persisté
}

function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTH_LABELS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

function monthLabel(year: number, monthIndex0: number): string {
  return `${MONTH_LABELS_FR[monthIndex0]} ${year}`;
}

/** Dernier jour du mois `horizonMonths - 1` après le mois de `referenceDate` (horizon inclusif). */
function computeHorizonEnd(referenceDate: Date, horizonMonths: number): Date {
  const ref = toUtcMidnight(referenceDate);
  const targetMonthIndex0 = ref.getUTCMonth() + horizonMonths - 1;
  const targetYear = ref.getUTCFullYear() + Math.floor(targetMonthIndex0 / 12);
  const normalizedMonth = ((targetMonthIndex0 % 12) + 12) % 12;
  // Jour 0 du mois SUIVANT = dernier jour du mois cible (astuce Date UTC standard).
  return new Date(Date.UTC(targetYear, normalizedMonth + 1, 0));
}

function accountIncluded(accountId: string | null, accountKnown: boolean, filter: string[] | null | undefined): boolean {
  if (filter === null || filter === undefined) return true; // "Tous" (§4)
  if (!accountKnown || accountId === null) return filter.includes(UNDETERMINED_ACCOUNT);
  return filter.includes(accountId);
}

function classify(e: ProjectionEventSummary): MonthlyLineItem['category'] {
  if (e.entityType !== 'deadline') return undefined;
  if (e.financialPlanId) return 'projet';
  return e.obligationStatus === 'obligatoire' ? 'obligatoire' : 'flexible';
}

/**
 * Point d'entrée unique (§19) : une seule invocation de computeProjection couvrant
 * TOUT l'horizon demandé (jusqu'à 60 mois), puis un simple regroupement en mémoire —
 * aucune requête par mois, aucune requête par dépense (§18).
 */
export async function computeMonthlyProjection(
  tx: TxClient,
  householdId: string,
  referenceDate: Date,
  horizonMonths: number,
  options: MonthlyProjectionOptions = {},
): Promise<MonthlyProjectionResult> {
  const ref = toUtcMidnight(referenceDate);
  const horizonEnd = computeHorizonEnd(ref, horizonMonths);

  const projection = await computeProjection(tx, householdId, ref, horizonEnd, [], false, options.dateOverrides);

  // ---------- Construction des mois vides (§3) : un bucket par mois, même sans événement ----------
  const buckets = new Map<string, MonthBucket>();
  for (let i = 0; i < horizonMonths; i += 1) {
    const monthIndex0 = ref.getUTCMonth() + i;
    const year = ref.getUTCFullYear() + Math.floor(monthIndex0 / 12);
    const normalizedMonth = ((monthIndex0 % 12) + 12) % 12;
    const key = `${year}-${String(normalizedMonth + 1).padStart(2, '0')}`;
    buckets.set(key, {
      month: key,
      label: monthLabel(year, normalizedMonth),
      totalIncome: 0,
      totalExpense: 0,
      balance: 0,
      cumulativeBalance: 0,
      incomeItems: [],
      expenseItems: [],
      movableExpenseTotal: 0,
      isComplete: true,
      unknownCount: 0,
      unknownLabels: [],
      containsEstimates: false,
      excludedByFilterCount: 0,
      excludedByFilterTotal: 0,
    });
  }

  // ---------- Regroupement des événements déjà calculés (§19 — aucun recalcul) ----------
  for (const day of projection.timeline) {
    const dayDate = new Date(`${day.date}T00:00:00.000Z`);
    const key = monthKey(dayDate);
    const bucket = buckets.get(key);
    if (!bucket) continue; // hors horizon demandé (ne devrait pas arriver, garde défensive)

    for (const e of day.events) {
      // Jamais transfer/pocket_movement/simulated_expense au niveau consolidé (§15/§17 F/G).
      if (e.kind !== 'income' && e.kind !== 'deadline' && e.kind !== 'variable_budget') continue;

      if (e.unknownAmount) {
        bucket.isComplete = false;
        bucket.unknownCount += 1;
        bucket.unknownLabels.push(e.label);
        continue; // RG-103 : jamais un montant à 0 dans les totaux (§16)
      }

      const isIncome = e.kind === 'income';
      const filter = isIncome ? options.incomeAccountIds : options.expenseAccountIds;
      const included = accountIncluded(e.accountId ?? null, e.accountKnown ?? false, filter ?? null);
      const magnitude = round2(Math.abs(e.grossAmount ?? e.amount));
      if (magnitude === 0) continue;

      if (!included) {
        // §4 — jamais silencieusement disparu : toujours comptabilisé, jamais dans les totaux.
        bucket.excludedByFilterCount += 1;
        bucket.excludedByFilterTotal = round2(bucket.excludedByFilterTotal + magnitude);
        continue;
      }

      const item: MonthlyLineItem = {
        entityType: e.entityType ?? (isIncome ? 'income_occurrence' : 'deadline'),
        entityId: e.entityId ?? '',
        label: e.label,
        date: day.date,
        amount: magnitude,
        accountId: e.accountId ?? null,
        accountKnown: e.accountKnown ?? false,
        amountStatus: e.amountStatus === 'inconnu' ? undefined : e.amountStatus,
        movable: e.movable ?? false,
      };
      if (e.amountStatus === 'estime') bucket.containsEstimates = true;

      if (isIncome) {
        bucket.totalIncome = round2(bucket.totalIncome + magnitude);
        bucket.incomeItems.push(item);
      } else {
        item.category = classify(e);
        bucket.totalExpense = round2(bucket.totalExpense + magnitude);
        bucket.expenseItems.push(item);
        if (item.movable) bucket.movableExpenseTotal = round2(bucket.movableExpenseTotal + magnitude);
      }
    }
  }

  // ---------- Balance mensuelle et cumulée (§2/§6), dans l'ordre chronologique ----------
  const months = Array.from(buckets.values()).sort((a, b) => a.month.localeCompare(b.month));
  let cumulative = 0;
  let totalIncome = 0;
  let totalExpense = 0;
  let deficitMonthsCount = 0;
  let worstMonth: { month: string; balance: number } | null = null;
  let incompleteMonthsCount = 0;
  let maxFinancingNeed: number | null = null;
  let inDeficitStreak = false;
  let firstPositiveCumulativeMonth: string | null = null;

  for (const bucket of months) {
    bucket.balance = round2(bucket.totalIncome - bucket.totalExpense);
    cumulative = round2(cumulative + bucket.balance);
    bucket.cumulativeBalance = cumulative;

    totalIncome = round2(totalIncome + bucket.totalIncome);
    totalExpense = round2(totalExpense + bucket.totalExpense);
    if (!bucket.isComplete) incompleteMonthsCount += 1;

    if (bucket.balance < 0) {
      deficitMonthsCount += 1;
      if (!worstMonth || bucket.balance < worstMonth.balance) worstMonth = { month: bucket.month, balance: bucket.balance };
    }

    if (cumulative < 0) {
      inDeficitStreak = true;
      if (maxFinancingNeed === null || -cumulative > maxFinancingNeed) maxFinancingNeed = round2(-cumulative);
    } else if (inDeficitStreak && firstPositiveCumulativeMonth === null) {
      firstPositiveCumulativeMonth = bucket.month;
    }
  }

  return {
    referenceDate: ref.toISOString().slice(0, 10),
    horizonEnd: horizonEnd.toISOString().slice(0, 10),
    horizonMonths,
    months,
    summary: {
      totalIncome: round2(totalIncome),
      totalExpense: round2(totalExpense),
      totalBalance: round2(totalIncome - totalExpense),
      deficitMonthsCount,
      worstMonth,
      maxMonthlyDeficit: worstMonth ? round2(-worstMonth.balance) : null,
      maxFinancingNeed,
      firstPositiveCumulativeMonth,
      isComplete: incompleteMonthsCount === 0,
      incompleteMonthsCount,
    },
    accountFilters: {
      incomeAccountIds: options.incomeAccountIds ?? null,
      expenseAccountIds: options.expenseAccountIds ?? null,
    },
  };
}
