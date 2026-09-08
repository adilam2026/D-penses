import { Prisma } from '@prisma/client';
import { getAccountBalances, round2, toNumber } from './ledger.util';
import { computeProjection, ProjectionEventSummary } from './projection.util';
import {
  DEFAULT_CLOSING_DAY,
  financialPeriodKeyOf,
  financialPeriodKeyString,
  financialPeriodLabel,
  getFinancialPeriodBounds,
  getFinancialPeriodOf,
  shiftFinancialPeriod,
} from './financial-period.util';

type TxClient = Prisma.TransactionClient;

/**
 * Projection Globale Mensuelle (Round 4, corrections Round 4bis §1-§9). AUCUN
 * second moteur financier : ce fichier appelle `computeProjection` (Lot 7/8,
 * projection.util.ts) UNE SEULE FOIS pour tout l'horizon demandé pour la couche
 * PRÉVUE, et lit directement (2 requêtes ciblées, jamais par mois/par dépense,
 * §18) la couche RÉELLE de la période — jamais un recalcul indépendant.
 *
 * RÈGLE FINALE (§1 Round 4bis) — la projection mensuelle représente, pour
 * chaque mois :
 *
 *   total du mois = mouvements RÉELS survenus dans le mois (Payment.paidDate /
 *                   IncomeOccurrence.actualDate) + montants PRÉVUS encore non
 *                   réalisés (resteAPayer > 0 / IncomeOccurrence status=prevu)
 *
 * Anti-double-comptage PROUVÉ par construction, pas seulement vérifié (§4) :
 *   - Revenu : IncomeOccurrence est SOIT 'prevu' SOIT 'recu' (jamais les deux
 *     à la fois, un seul flip de statut, RG-014bis) → union disjointe exacte.
 *   - Dépense : deadline_with_balance.reste_a_payer = amount_current −
 *     Σ payeNet(payments) EXACTEMENT (vue SQL, RG-016) → Σ(payeNet de chaque
 *     Payment réel, attribué à SON MOIS réel) + reste_a_payer (attribué au
 *     mois de due_date, IF non nul) = amount_current, TOUJOURS, quel que soit
 *     le nombre de paiements partiels ni leurs dates réelles.
 *
 * Ces deux couches (réelle/prévue) sont TOUJOURS distinctes du calcul de
 * `openingPhysicalTreasury` dans computeProjection : ce dernier lit le solde
 * RÉEL actuel des comptes (déjà net de tout l'historique, y compris les
 * paiements/revenus de cette période) — jamais réinjecté ici comme un
 * événement de plus (ce qui doublerait son effet sur la courbe physique
 * jour-par-jour). La couche réelle ci-dessous n'alimente QUE l'agrégation
 * mensuelle, jamais `computeProjection` lui-même.
 *
 * Ni transfert (§15), ni mouvement de Provision/Poche, ni Provision elle-même
 * (§17 F) — réel ou prévu — n'entrent jamais dans revenus/dépenses consolidés.
 *
 * R6.2 (§12) — EXCEPTION UNIQUE ET CIBLÉE à cette exclusion : un transfert
 * encore `prevu` (récurrent ou ponctuel — même impact, jamais deux logiques)
 * dont un compte source/destination fait partie de la trésorerie pilotée
 * (treasuryAccountIds) ajuste `cashRunning`/`projectedCashBalance` du mois de
 * sa `plannedDate`, EXACTEMENT comme un transfert confirmé le fait déjà pour
 * le solde réel actuel (computeTreasurySummary, treasury.util.ts — même
 * logique des 4 combinaisons piloté/hors-pilotage, jamais réimplémentée).
 * Ceci NE touche JAMAIS `balance`/`cumulativeBalance` (qui restent des flux
 * revenus−dépenses purs, jamais un transfert) — uniquement la trésorerie
 * projetée, qui doit refléter que l'argent quitte/rejoint le périmètre
 * piloté. Un transfert entre deux comptes pilotés a un impact net de 0
 * (RG implicite §11 CAS A) — jamais une dépense globale artificielle.
 */

export const UNDETERMINED_ACCOUNT = '__undetermined__';

export interface MonthlyLineItem {
  entityType: 'income_occurrence' | 'deadline' | 'variable_budget';
  entityId: string;
  label: string;
  date: string; // jour exact (ISO) où l'événement tombe dans le mois — date RÉELLE si realized=true
  amount: number; // toujours positif — le signe est déjà porté par incomeItems/expenseItems
  accountId: string | null;
  accountKnown: boolean;
  amountStatus?: 'estime' | 'confirme';
  category?: 'obligatoire' | 'flexible' | 'projet'; // dépenses uniquement (§9)
  financialPlanId?: string | null;
  movable: boolean; // action "Déplacer" réellement disponible (§10/§11) — toujours false si realized
  realized: boolean; // Round 4bis §1 — true = mouvement réel déjà survenu, false = encore prévu
}

export interface MonthBucket {
  month: string; // "2026-11"
  label: string; // "Novembre 2026"
  totalIncome: number;
  totalExpense: number;
  balance: number;
  cumulativeBalance: number;
  projectedCashBalance: number; // Round 4bis §7 — trésorerie initiale + cumul des flux
  // R6.2 (§12) — impact net des transferts encore `prevu` sur la trésorerie pilotée
  // ce mois-ci (signé : positif = entrée nette, négatif = sortie nette) — jamais
  // dans balance/cumulativeBalance, uniquement appliqué à projectedCashBalance.
  plannedTransferNetTreasuryImpact: number;
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
  // Round 4bis §6-§8 — la balance cumulée (flux purs, part de zéro) N'EST PAS un solde de
  // trésorerie : ces champs partent de la trésorerie RÉELLE initiale, jamais de zéro.
  openingCashBalance: number;
  cashLowPoint: { month: string; value: number } | null;
  maxFinancingNeed: number; // §8 — max(0, -min(trésorerie projetée)) ; 0 si jamais négative
  firstPositiveCashBalanceMonth: string | null; // premier retour ≥0 après un creux de TRÉSORERIE (pas du cumul de flux)
  treasuryAccountIds: string[]; // §9 — comptes réellement inclus dans la trésorerie initiale, jamais implicite
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

/**
 * R6.3 (points A/C) — période FINANCIÈRE d'une date réelle (jamais son mois
 * civil brut) : moteur unique financial-period.util.ts, jamais un second
 * calcul de bucketing. closingDay=31 (défaut HouseholdSettings) reproduit à
 * l'identique le découpage par mois civil d'avant R6.3.
 */
function monthKey(date: Date, closingDay: number): string {
  return financialPeriodKeyOf(date, closingDay);
}

/** Dernière date réelle de la période financière `horizonMonths - 1` après celle de `referenceDate` (horizon inclusif). */
function computeHorizonEnd(referenceDate: Date, horizonMonths: number, closingDay: number): Date {
  const ref = toUtcMidnight(referenceDate);
  const refPeriod = getFinancialPeriodOf(ref, closingDay);
  const targetPeriod = shiftFinancialPeriod(refPeriod, horizonMonths - 1);
  return getFinancialPeriodBounds(targetPeriod.year, targetPeriod.monthIndex0, closingDay).end;
}

function accountIncluded(accountId: string | null, accountKnown: boolean, filter: string[] | null | undefined): boolean {
  if (filter === null || filter === undefined) return true; // "Tous" (§4)
  if (!accountKnown || accountId === null) return filter.includes(UNDETERMINED_ACCOUNT);
  return filter.includes(accountId);
}

function classify(entityType: string | undefined, obligationStatus: string | undefined, financialPlanId: string | null | undefined): MonthlyLineItem['category'] {
  if (entityType !== 'deadline') return undefined;
  if (financialPlanId) return 'projet';
  return obligationStatus === 'obligatoire' ? 'obligatoire' : 'flexible';
}

/**
 * RG-015 : signe du paiement sur reste_a_payer, EXACTEMENT la formule de la vue
 * SQL deadline_with_balance (jamais une réimplémentation divergente) — c'est
 * cette identité qui garantit Σ(payeNet réels) + reste_a_payer = amount_current.
 */
function paymentPayeNet(type: string, direction: string | null, amount: number): number {
  if (type === 'remboursement') return -amount;
  if (type === 'ajustement') return direction === 'augmente_paye' ? amount : -amount;
  return amount; // paiement
}

interface RealBucketing {
  month: string;
  item: MonthlyLineItem;
}

/**
 * Couche RÉELLE (§1-§3 Round 4bis) : paiements et revenus reçus dont la date
 * RÉELLE (jamais la date prévue d'origine) tombe dans [ref, horizonEnd].
 * Aucune boucle par mois ni par dépense — 2 requêtes bornées par foyer+période.
 */
async function realizedItems(
  tx: TxClient,
  householdId: string,
  ref: Date,
  horizonEnd: Date,
  closingDay: number,
): Promise<{ income: RealBucketing[]; expense: RealBucketing[] }> {
  const income: RealBucketing[] = [];
  const expense: RealBucketing[] = [];

  const payments = await tx.payment.findMany({
    where: { paidDate: { gte: ref, lte: horizonEnd }, deadline: { chargePlan: { householdId } } },
    include: { deadline: { include: { chargePlan: true } } },
  });
  for (const p of payments) {
    const payeNet = round2(paymentPayeNet(p.type, p.direction, toNumber(p.amount)));
    if (payeNet === 0) continue;
    const cp = p.deadline.chargePlan;
    expense.push({
      month: monthKey(p.paidDate, closingDay),
      item: {
        entityType: 'deadline',
        entityId: p.deadlineId,
        label: cp.label,
        date: p.paidDate.toISOString().slice(0, 10),
        amount: payeNet,
        accountId: p.accountId,
        accountKnown: true, // Round 3 §13 — accountId toujours obligatoire sur un Payment réel
        category: classify('deadline', cp.obligationStatus, cp.financialPlanId),
        financialPlanId: cp.financialPlanId,
        movable: false,
        realized: true,
      },
    });
  }

  const occurrences = await tx.incomeOccurrence.findMany({
    where: { status: 'recu', actualDate: { gte: ref, lte: horizonEnd }, incomeSource: { householdId } },
    include: { incomeSource: true },
  });
  for (const o of occurrences) {
    if (o.actualAmount === null || o.actualDate === null) continue; // ne devrait jamais arriver pour status=recu
    const amount = round2(toNumber(o.actualAmount));
    if (amount === 0) continue;
    income.push({
      month: monthKey(o.actualDate, closingDay),
      item: {
        entityType: 'income_occurrence',
        entityId: o.id,
        label: o.incomeSource.label,
        date: o.actualDate.toISOString().slice(0, 10),
        amount,
        accountId: o.accountId ?? o.incomeSource.defaultAccountId,
        accountKnown: true, // Round 3 §11 — accountId toujours obligatoire à la confirmation
        movable: false,
        realized: true,
      },
    });
  }

  return { income, expense };
}

/**
 * Comptes inclus dans la trésorerie initiale (Round 4bis §9, restreint par
 * R6.1 §12) — règle d'UNION explicite, jamais ambiguë : si l'un des deux
 * filtres Revenus/Dépenses vaut "Tous", la trésorerie couvre tous les comptes
 * actifs INCLUS DANS LE PILOTAGE (Tous ∪ X = Tous des comptes pilotés, jamais
 * tous les comptes de la base) ; sinon elle couvre l'union des deux listes
 * explicites, elle-même toujours restreinte aux comptes pilotés — un compte
 * marqué hors pilotage ne revient jamais automatiquement dans la trésorerie
 * initiale, quel que soit le filtre choisi (la sentinelle "compte non
 * déterminé" n'est jamais un compte réel, donc jamais incluse ici).
 */
async function treasuryAccountIds(
  tx: TxClient,
  householdId: string,
  incomeAccountIds: string[] | null | undefined,
  expenseAccountIds: string[] | null | undefined,
): Promise<string[]> {
  const pilotedAccounts = await tx.financialAccount.findMany({
    where: { householdId, status: 'actif', includeInOperationalTreasury: true },
    select: { id: true },
  });
  const allIds = pilotedAccounts.map((a) => a.id);
  if (incomeAccountIds == null || expenseAccountIds == null) return allIds;
  const union = new Set([...incomeAccountIds, ...expenseAccountIds].filter((id) => id !== UNDETERMINED_ACCOUNT));
  return allIds.filter((id) => union.has(id));
}

/**
 * R6.2 (§12) — impact net, par mois, des transferts encore `prevu` (récurrents
 * ou ponctuels) sur la trésorerie pilotée. Même formule que
 * computeTreasurySummary pour un transfert confirmé (treasury.util.ts) :
 * source piloté → -amount, destination pilotée → +amount, les deux à la fois
 * s'annulent exactement (jamais réimplémentée séparément, juste appliquée à
 * `prevu` au lieu de `confirme`). Un compte hors du périmètre `treasuryIds`
 * ne contribue jamais (CAS D — 0 impact).
 */
async function plannedTransferTreasuryImpacts(
  tx: TxClient,
  householdId: string,
  ref: Date,
  horizonEnd: Date,
  treasuryIds: string[],
  closingDay: number,
): Promise<Map<string, number>> {
  const impacts = new Map<string, number>();
  if (treasuryIds.length === 0) return impacts;
  const treasurySet = new Set(treasuryIds);

  const transfers = await tx.accountTransfer.findMany({
    where: { householdId, status: 'prevu', plannedDate: { gte: ref, lte: horizonEnd } },
  });
  for (const t of transfers) {
    const amount = toNumber(t.amount);
    if (amount === 0) continue;
    let net = 0;
    if (t.fromAccountId && treasurySet.has(t.fromAccountId)) net -= amount;
    if (t.toAccountId && treasurySet.has(t.toAccountId)) net += amount;
    if (net === 0) continue; // CAS A (piloté→piloté) ou CAS D (hors→hors) : jamais d'impact
    // R6.3 (point J) — un transfert récurrent R6.2 se rattache lui aussi à SA période
    // financière réelle (ex. clôture=25, transfert planifié le 27/09 → période Octobre),
    // exactement comme un paiement/revenu réel — même moteur, jamais un second calcul.
    const key = monthKey(t.plannedDate, closingDay);
    impacts.set(key, round2((impacts.get(key) ?? 0) + net));
  }
  return impacts;
}

/**
 * Point d'entrée unique (§19) : une seule invocation de computeProjection couvrant
 * TOUT l'horizon demandé (jusqu'à 60 mois) pour la couche prévue, 2 requêtes
 * ciblées pour la couche réelle, 1 requête batchée pour la trésorerie initiale —
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
  // R6.3 (points A/C/J) — jour de clôture du foyer (financial-period.util.ts, moteur
  // unique) : défaut 31 si le foyer n'a pas encore de HouseholdSettings, rétrocompatible
  // à l'identique avec le découpage par mois civil d'avant R6.3.
  const settings = await tx.householdSettings.findUnique({ where: { householdId } });
  const closingDay = settings?.closingDay ?? DEFAULT_CLOSING_DAY;
  const horizonEnd = computeHorizonEnd(ref, horizonMonths, closingDay);

  const [projection, realized, treasuryIds] = await Promise.all([
    computeProjection(tx, householdId, ref, horizonEnd, [], false, options.dateOverrides),
    realizedItems(tx, householdId, ref, horizonEnd, closingDay),
    treasuryAccountIds(tx, householdId, options.incomeAccountIds, options.expenseAccountIds),
  ]);
  const [treasuryBalances, transferImpacts] = await Promise.all([
    getAccountBalances(tx, treasuryIds),
    plannedTransferTreasuryImpacts(tx, householdId, ref, horizonEnd, treasuryIds, closingDay),
  ]);
  const openingCashBalance = round2(treasuryIds.reduce((sum, id) => sum + (treasuryBalances.get(id) ?? 0), 0));

  // ---------- Construction des périodes financières vides (§3) : un bucket par
  // période, même sans événement — jamais le mois civil brut de `ref` (point A).
  const buckets = new Map<string, MonthBucket>();
  const refPeriod = getFinancialPeriodOf(ref, closingDay);
  for (let i = 0; i < horizonMonths; i += 1) {
    const period = shiftFinancialPeriod(refPeriod, i);
    const key = financialPeriodKeyString(period);
    buckets.set(key, {
      month: key,
      label: financialPeriodLabel(period),
      totalIncome: 0,
      totalExpense: 0,
      balance: 0,
      cumulativeBalance: 0,
      projectedCashBalance: 0,
      plannedTransferNetTreasuryImpact: 0,
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

  function applyItem(bucket: MonthBucket, isIncome: boolean, item: MonthlyLineItem) {
    const filter = isIncome ? options.incomeAccountIds : options.expenseAccountIds;
    const included = accountIncluded(item.accountId, item.accountKnown, filter ?? null);
    if (!included) {
      // §4 — jamais silencieusement disparu : toujours comptabilisé, jamais dans les totaux.
      bucket.excludedByFilterCount += 1;
      bucket.excludedByFilterTotal = round2(bucket.excludedByFilterTotal + Math.abs(item.amount));
      return;
    }
    if (item.amountStatus === 'estime') bucket.containsEstimates = true;
    if (isIncome) {
      bucket.totalIncome = round2(bucket.totalIncome + item.amount);
      bucket.incomeItems.push(item);
    } else {
      bucket.totalExpense = round2(bucket.totalExpense + item.amount);
      bucket.expenseItems.push(item);
      if (item.movable) bucket.movableExpenseTotal = round2(bucket.movableExpenseTotal + item.amount);
    }
  }

  // ---------- Couche PRÉVUE (déjà calculée par computeProjection, §19 — aucun recalcul) ----------
  for (const day of projection.timeline) {
    const dayDate = new Date(`${day.date}T00:00:00.000Z`);
    const bucket = buckets.get(monthKey(dayDate, closingDay));
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
      const magnitude = round2(Math.abs(e.grossAmount ?? e.amount));
      if (magnitude === 0) continue;

      const item: MonthlyLineItem = {
        entityType: e.entityType ?? (isIncome ? 'income_occurrence' : 'deadline'),
        entityId: e.entityId ?? '',
        label: e.label,
        date: day.date,
        amount: magnitude,
        accountId: e.accountId ?? null,
        accountKnown: e.accountKnown ?? false,
        amountStatus: e.amountStatus === 'inconnu' ? undefined : e.amountStatus,
        category: isIncome ? undefined : classify(e.entityType, e.obligationStatus, e.financialPlanId),
        financialPlanId: e.financialPlanId,
        movable: e.movable ?? false,
        realized: false,
      };
      applyItem(bucket, isIncome, item);
    }
  }

  // ---------- Couche RÉELLE (§1-§3 Round 4bis) : ajoutée dans SON propre mois réel ----------
  for (const { month, item } of realized.income) {
    const bucket = buckets.get(month);
    if (bucket) applyItem(bucket, true, item);
  }
  for (const { month, item } of realized.expense) {
    const bucket = buckets.get(month);
    if (bucket) applyItem(bucket, false, item);
  }

  // ---------- Balance mensuelle, cumul de flux, et trésorerie projetée (§2/§6/§7/§8) ----------
  const months = Array.from(buckets.values()).sort((a, b) => a.month.localeCompare(b.month));
  let cumulative = 0;
  let cashRunning = openingCashBalance;
  let totalIncome = 0;
  let totalExpense = 0;
  let deficitMonthsCount = 0;
  let worstMonth: { month: string; balance: number } | null = null;
  let incompleteMonthsCount = 0;
  let cashLowPoint: { month: string; value: number } | null = null;
  let inCashDeficitStreak = false;
  let maxFinancingNeed = 0;
  let firstPositiveCashBalanceMonth: string | null = null;

  for (const bucket of months) {
    bucket.balance = round2(bucket.totalIncome - bucket.totalExpense);
    cumulative = round2(cumulative + bucket.balance);
    bucket.cumulativeBalance = cumulative;
    // R6.2 (§12) — appliqué à cashRunning UNIQUEMENT (jamais à balance/cumulativeBalance,
    // qui restent des flux revenus−dépenses purs).
    bucket.plannedTransferNetTreasuryImpact = transferImpacts.get(bucket.month) ?? 0;
    cashRunning = round2(cashRunning + bucket.balance + bucket.plannedTransferNetTreasuryImpact);
    bucket.projectedCashBalance = cashRunning;

    totalIncome = round2(totalIncome + bucket.totalIncome);
    totalExpense = round2(totalExpense + bucket.totalExpense);
    if (!bucket.isComplete) incompleteMonthsCount += 1;

    if (bucket.balance < 0) {
      deficitMonthsCount += 1;
      if (!worstMonth || bucket.balance < worstMonth.balance) worstMonth = { month: bucket.month, balance: bucket.balance };
    }

    // Round 4bis §8 : le besoin de financement suit la TRÉSORERIE PROJETÉE (compte tenu du
    // disponible initial), jamais le cumul de flux seul — max(0, -min(trésorerie projetée)).
    if (!cashLowPoint || cashRunning < cashLowPoint.value) cashLowPoint = { month: bucket.month, value: cashRunning };
    if (cashRunning < 0) {
      inCashDeficitStreak = true;
      maxFinancingNeed = Math.max(maxFinancingNeed, round2(-cashRunning));
    } else if (inCashDeficitStreak && firstPositiveCashBalanceMonth === null) {
      firstPositiveCashBalanceMonth = bucket.month;
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
      openingCashBalance,
      cashLowPoint,
      maxFinancingNeed: round2(maxFinancingNeed),
      firstPositiveCashBalanceMonth,
      treasuryAccountIds: treasuryIds,
      isComplete: incompleteMonthsCount === 0,
      incompleteMonthsCount,
    },
    accountFilters: {
      incomeAccountIds: options.incomeAccountIds ?? null,
      expenseAccountIds: options.expenseAccountIds ?? null,
    },
  };
}
