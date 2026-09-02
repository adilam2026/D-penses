import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { round2, toNumber } from './ledger.util';
import { computeProjection, ProjectionResult, SimulatedEvent } from './projection.util';
import { addDaysUTC } from './variable-budget.util';

type TxClient = Prisma.TransactionClient;

/**
 * Simulateur What-if (docs/02-modele-metier.md G.10/G.11, Lot 8). RÉUTILISE
 * EXCLUSIVEMENT computeProjection (Lot 7, §3 de la demande) — jamais un second
 * moteur financier. Toute hypothèse de scénario n'existe qu'en mémoire, le temps
 * d'un appel : ces fonctions ne lisent que via `tx` (jamais d'écriture) — IF-10
 * garanti PAR CONSTRUCTION (aucun `tx.xxx.create/update/delete` dans ce fichier).
 */

const DEFAULT_HORIZON_DAYS = 90;
const CAPACITY_SEARCH_ITERATIONS = 18; // précision monétaire ~ upperBound / 2^18 (§17)

function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateKey(d: Date): string {
  return toUtcMidnight(d).toISOString().slice(0, 10);
}

function addMonthsUTC(date: Date, months: number): Date {
  const d = toUtcMidnight(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
}

// ---------- Décision & reason codes (§6/§7/§23/§24) ----------

export type Decision = 'POSSIBLE_ET_PRUDENT' | 'POSSIBLE_MAIS_TENSION' | 'IMPOSSIBLE_DEFICIT' | 'INDETERMINE_INCOMPLET';

export type ReasonCode =
  | 'PHYSICAL_DEFICIT'
  | 'FREE_CAPACITY_NEGATIVE'
  | 'SAFETY_BUFFER_AT_RISK'
  | 'UNKNOWN_FUTURE_AMOUNT'
  | 'PROTECTED_SAVINGS'
  | 'GOAL_TARGET_TOO_AGGRESSIVE';

export interface AccountLike {
  id: string;
  includeInOperationalTreasury: boolean;
}

/** RG-047 (§14) — un compte dédié à une SavingsPocket protégée ne doit jamais être proposé comme source neutre. */
async function isProtectedSavingsAccount(tx: TxClient, householdId: string, accountId: string): Promise<boolean> {
  const pocket = await tx.savingsPocket.findFirst({ where: { householdId, linkedAccountId: accountId, isProtected: true } });
  return pocket !== null;
}

// ---------- §4-§13 : simulation d'une dépense ponctuelle ----------

export interface PurchaseSimulationInput {
  amount: number;
  date: Date;
  accountId: string;
  horizonDays?: number;
  includeEnvisagedOptions?: boolean;
}

export interface ProjectionSlice {
  closingPhysicalTreasury: number;
  physicalLowPoint: number;
  physicalLowPointDate: Date;
  freeCapacityLowPoint: number;
  freeCapacityLowPointDate: Date;
  firstNegativeDate: Date | null;
  deficitAtFirstNegative: number | null;
}

function toSlice(r: ProjectionResult): ProjectionSlice {
  return {
    closingPhysicalTreasury: r.closingPhysicalTreasury,
    physicalLowPoint: r.physicalLowPoint,
    physicalLowPointDate: r.physicalLowPointDate,
    freeCapacityLowPoint: r.freeCapacityLowPoint,
    freeCapacityLowPointDate: r.freeCapacityLowPointDate,
    firstNegativeDate: r.firstNegativeDate,
    deficitAtFirstNegative: r.deficitAtFirstNegative,
  };
}

/** Point de la timeline restreint aux dates ≥ eventDate (§10 : marge APRÈS l'événement, jamais sur tout l'horizon). */
function sliceFrom(projection: ProjectionResult, fromKey: string) {
  const points = projection.timeline.filter((t) => t.date >= fromKey);
  let physicalLow = points.length ? points[0].physicalTreasury : projection.closingPhysicalTreasury;
  let freeCapacityLow = points.length ? points[0].freeCapacity : projection.closingFreeCapacity;
  let firstNegativeDate: string | null = null;
  let deficitAtFirstNegative: number | null = null;
  for (const p of points) {
    if (p.physicalTreasury < physicalLow) physicalLow = p.physicalTreasury;
    if (p.freeCapacity < freeCapacityLow) freeCapacityLow = p.freeCapacity;
    if (firstNegativeDate === null && p.physicalTreasury < 0) {
      firstNegativeDate = p.date;
      deficitAtFirstNegative = p.physicalTreasury;
    }
  }
  return { physicalLowPointAfter: round2(physicalLow), freeCapacityLowPointAfter: round2(freeCapacityLow), firstNegativeDate, deficitAtFirstNegative };
}

export interface PurchaseSimulationResult {
  decision: Decision;
  possibleDate: Date | null;
  recommendedDate: Date | null;
  baseline: ProjectionSlice;
  scenario: ProjectionSlice;
  physicalLowPointAfter: number;
  freeCapacityLowPointAfter: number;
  marginAfterPurchase: number; // = freeCapacityLowPointAfter (§10)
  deltaClosingPhysical: number;
  deltaPhysicalLowPoint: number;
  deltaFreeCapacityLowPoint: number;
  reasonCodes: ReasonCode[];
  isComplete: boolean;
  containsEstimates: boolean;
}

function buildExpenseEvent(date: Date, amount: number, operational: boolean): SimulatedEvent {
  return { date, kind: 'simulated_expense', label: 'Achat simulé', physicalImpact: operational ? -round2(amount) : 0, reserveImpact: 0 };
}

/**
 * §4-§13/§31-§34 : simulation d'une dépense ponctuelle. Deux appels à computeProjection
 * (baseline, scenario) — jamais un troisième moteur. possible_date/recommended_date sont
 * dérivées de la MÊME courbe baseline jour-par-jour (§8 : « pas de formule approximative ») :
 * un `simulated_expense` isolé ne modifie jamais provisionBalance ni aucun autre état interne
 * du moteur, donc son effet sur physical(T)/freeCapacity(T) pour T ≥ D est mathématiquement
 * une simple soustraction constante — IDENTIQUE, valeur pour valeur, à ce que produirait un
 * nouvel appel à computeProjection avec l'événement inséré au jour D. Dériver ces courbes à
 * partir des points déjà calculés par le moteur jour-par-jour n'est donc pas une approximation :
 * c'est exactement le même résultat, obtenu sans relancer une requête complète par jour candidat.
 */
export async function simulatePurchase(
  tx: TxClient,
  householdId: string,
  referenceDate: Date,
  input: PurchaseSimulationInput,
): Promise<PurchaseSimulationResult> {
  const ref = toUtcMidnight(referenceDate);
  // Un événement daté avant aujourd'hui (ou après l'horizon) serait invisible à la boucle
  // jour-par-jour de computeProjection (bornée à [ref, horizonEnd]) — toujours clampé, jamais
  // silencieusement ignoré.
  const horizonEnd = addDaysUTC(ref, input.horizonDays ?? DEFAULT_HORIZON_DAYS);
  const rawEventDate = toUtcMidnight(input.date);
  const eventDate = rawEventDate.getTime() < ref.getTime() ? ref : rawEventDate.getTime() > horizonEnd.getTime() ? horizonEnd : rawEventDate;
  const includeEnvisaged = input.includeEnvisagedOptions ?? false;

  const account = await tx.financialAccount.findFirst({ where: { id: input.accountId, householdId } });
  if (!account) throw new NotFoundException('Compte introuvable dans ce foyer');
  const operational = account.includeInOperationalTreasury;
  const protectedAccount = await isProtectedSavingsAccount(tx, householdId, input.accountId);

  const baseline = await computeProjection(tx, householdId, ref, horizonEnd, [], includeEnvisaged);
  const event = buildExpenseEvent(eventDate, input.amount, operational);
  const scenario = await computeProjection(tx, householdId, ref, horizonEnd, [event], includeEnvisaged);

  const after = sliceFrom(scenario, dateKey(eventDate));

  const reasonCodes: ReasonCode[] = [];
  if (!scenario.isComplete) reasonCodes.push('UNKNOWN_FUTURE_AMOUNT');
  if (after.physicalLowPointAfter < 0) reasonCodes.push('PHYSICAL_DEFICIT');
  if (after.freeCapacityLowPointAfter < 0) {
    // La marge de sécurité est déjà nette dans la capacité libre (G.6b) : si l'ajouter en
    // arrière rendrait la capacité à nouveau ≥ 0, c'est le COUSSIN qui absorbe l'écart —
    // un déficit qui subsiste même sans coussin est une tension de capacité plus profonde.
    const settings = await tx.householdSettings.findUnique({ where: { householdId } });
    const coussin = settings ? toNumber(settings.securityMarginAmount) : 0;
    if (round2(after.freeCapacityLowPointAfter + coussin) >= 0) reasonCodes.push('SAFETY_BUFFER_AT_RISK');
    else reasonCodes.push('FREE_CAPACITY_NEGATIVE');
  }
  if (protectedAccount) reasonCodes.push('PROTECTED_SAVINGS');

  let decision: Decision;
  if (!scenario.isComplete) decision = 'INDETERMINE_INCOMPLET';
  else if (after.physicalLowPointAfter < 0) decision = 'IMPOSSIBLE_DEFICIT';
  else if (protectedAccount || after.freeCapacityLowPointAfter < 0) decision = 'POSSIBLE_MAIS_TENSION';
  else decision = 'POSSIBLE_ET_PRUDENT';

  // §8/§9 : recherche jour par jour sur la courbe baseline déjà calculée (cf. commentaire ci-dessus) —
  // chaque point de la timeline (ref..horizonEnd) est testé comme date d'achat candidate, dans l'ordre.
  let possibleDate: Date | null = null;
  let recommendedDate: Date | null = null;
  for (const point of baseline.timeline) {
    const pointDate = new Date(`${point.date}T00:00:00.000Z`);
    const slice = sliceFrom(baseline, point.date);
    const physicalOk = round2(slice.physicalLowPointAfter - (operational ? input.amount : 0)) >= 0;
    if (possibleDate === null && physicalOk) possibleDate = pointDate;
    const capacityOk = round2(slice.freeCapacityLowPointAfter - (operational ? input.amount : 0)) >= 0;
    if (recommendedDate === null && physicalOk && capacityOk) recommendedDate = pointDate;
    if (possibleDate !== null && recommendedDate !== null) break;
  }

  return {
    decision,
    possibleDate,
    recommendedDate,
    baseline: toSlice(baseline),
    scenario: toSlice(scenario),
    physicalLowPointAfter: after.physicalLowPointAfter,
    freeCapacityLowPointAfter: after.freeCapacityLowPointAfter,
    marginAfterPurchase: after.freeCapacityLowPointAfter,
    deltaClosingPhysical: round2(scenario.closingPhysicalTreasury - baseline.closingPhysicalTreasury),
    deltaPhysicalLowPoint: round2(scenario.physicalLowPoint - baseline.physicalLowPoint),
    deltaFreeCapacityLowPoint: round2(scenario.freeCapacityLowPoint - baseline.freeCapacityLowPoint),
    reasonCodes,
    isComplete: scenario.isComplete,
    containsEstimates: scenario.containsEstimates,
  };
}

// ---------- §16/§36 : simulation de contribution(s) à un Goal ----------

export interface GoalContributionSimulationInput {
  goalId: string;
  amount: number;
  date: Date;
  recurring?: boolean;
  dayOfMonth?: number;
  horizonDays?: number;
}

export interface GoalContributionSimulationResult {
  baseline: ProjectionSlice;
  scenario: ProjectionSlice;
  deltaFreeCapacityLowPoint: number;
  contributionDates: Date[];
  reserveAddedTotal: number;
  isComplete: boolean;
  containsEstimates: boolean;
}

/** Occurrences mensuelles d'un jour donné entre référence et horizon (§18). */
function monthlyOccurrences(referenceDate: Date, horizonEnd: Date, dayOfMonth: number): Date[] {
  const dates: Date[] = [];
  const ref = toUtcMidnight(referenceDate);
  let cursor = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), Math.min(dayOfMonth, 28)));
  if (cursor.getTime() < ref.getTime()) cursor = addMonthsUTC(cursor, 1);
  while (cursor.getTime() <= horizonEnd.getTime()) {
    dates.push(cursor);
    cursor = addMonthsUTC(cursor, 1);
  }
  return dates;
}

/**
 * §16/§36 : une GoalContribution simulée ne grandit JAMAIS une poche backed_by_account dans
 * ce moteur (§16 ne détaille que virtual_allocation) — reserve-only, aucun PocketMovement/
 * GoalContribution réel créé (mêmes garanties IF-10 que simulatePurchase).
 */
export async function simulateGoalContribution(
  tx: TxClient,
  householdId: string,
  referenceDate: Date,
  input: GoalContributionSimulationInput,
): Promise<GoalContributionSimulationResult> {
  const ref = toUtcMidnight(referenceDate);
  const horizonEnd = addDaysUTC(ref, input.horizonDays ?? DEFAULT_HORIZON_DAYS);
  const goal = await tx.goal.findFirst({ where: { id: input.goalId, householdId }, include: { linkedPocket: true } });
  if (!goal) throw new NotFoundException('Objectif introuvable dans ce foyer');

  const dates =
    input.recurring && input.dayOfMonth
      ? monthlyOccurrences(ref, horizonEnd, input.dayOfMonth)
      : [toUtcMidnight(input.date)].filter((d) => d.getTime() >= ref.getTime() && d.getTime() <= horizonEnd.getTime());

  const events: SimulatedEvent[] =
    goal.linkedPocket && goal.linkedPocket.allocationMode === 'virtual_allocation'
      ? dates.map((date) => ({ date, kind: 'pocket_movement', label: `${goal.label} — contribution simulée`, physicalImpact: 0, reserveImpact: round2(input.amount) }))
      : []; // sans poche liée virtuelle, aucun effet financier projeté (§12/§16, cohérent avec Lot 7)

  const baseline = await computeProjection(tx, householdId, ref, horizonEnd);
  const scenario = await computeProjection(tx, householdId, ref, horizonEnd, events);

  return {
    baseline: toSlice(baseline),
    scenario: toSlice(scenario),
    deltaFreeCapacityLowPoint: round2(scenario.freeCapacityLowPoint - baseline.freeCapacityLowPoint),
    contributionDates: dates,
    reserveAddedTotal: round2(events.length * input.amount),
    isComplete: scenario.isComplete,
    containsEstimates: scenario.containsEstimates,
  };
}

// ---------- §17/§18 : capacité d'épargne prudente (recherche binaire déterministe) ----------

export interface SavingsCapacityInput {
  recurring?: boolean;
  date?: Date;
  dayOfMonth?: number;
  horizonDays?: number;
}

export interface SavingsCapacityResult {
  maxAmount: number;
  recurring: boolean;
  horizonEnd: Date;
  contributionDates: Date[];
  isComplete: boolean;
  containsEstimates: boolean;
}

/**
 * §17/§18 : recherche binaire déterministe (précision monétaire, jamais une heuristique
 * opaque) du montant maximal de contribution (ponctuelle ou mensuelle récurrente) qui
 * n'entraîne ni déficit physique, ni capacité libre négative, sur l'horizon considéré.
 */
export async function computeSavingsCapacity(tx: TxClient, householdId: string, referenceDate: Date, input: SavingsCapacityInput): Promise<SavingsCapacityResult> {
  const ref = toUtcMidnight(referenceDate);
  const horizonEnd = addDaysUTC(ref, input.horizonDays ?? DEFAULT_HORIZON_DAYS);
  const recurring = input.recurring ?? false;
  const dates = recurring ? monthlyOccurrences(ref, horizonEnd, input.dayOfMonth ?? ref.getUTCDate()) : [input.date ? toUtcMidnight(input.date) : ref];

  const baseline = await computeProjection(tx, householdId, ref, horizonEnd);
  const upperBound = round2(Math.max(baseline.openingPhysicalTreasury, 0) + Math.max(-baseline.freeCapacityLowPoint, 0) + 1000);

  const feasible = async (amount: number): Promise<boolean> => {
    if (amount <= 0) return true;
    const events: SimulatedEvent[] = dates.map((date) => ({ date, kind: 'pocket_movement', label: 'Contribution simulée', physicalImpact: 0, reserveImpact: round2(amount) }));
    const scenario = await computeProjection(tx, householdId, ref, horizonEnd, events);
    return scenario.isComplete && scenario.freeCapacityLowPoint >= 0;
  };

  let lo = 0;
  let hi = upperBound;
  if (!(await feasible(hi))) {
    for (let i = 0; i < CAPACITY_SEARCH_ITERATIONS; i++) {
      const mid = round2((lo + hi) / 2);
      if (await feasible(mid)) lo = mid;
      else hi = mid;
    }
  } else {
    lo = hi;
  }

  const finalScenarioEvents: SimulatedEvent[] = dates.map((date) => ({ date, kind: 'pocket_movement', label: 'Contribution simulée', physicalImpact: 0, reserveImpact: round2(lo) }));
  const finalScenario = lo > 0 ? await computeProjection(tx, householdId, ref, horizonEnd, finalScenarioEvents) : baseline;

  return {
    maxAmount: round2(lo),
    recurring,
    horizonEnd,
    contributionDates: dates,
    isComplete: finalScenario.isComplete,
    containsEstimates: finalScenario.containsEstimates,
  };
}

// ---------- §19/§20/§35 : analyse Goal ----------

export type GoalTargetStatus = 'FEASIBLE_AT_REQUESTED_PACE' | 'NOT_FEASIBLE_AT_REQUESTED_PACE' | 'NO_TARGET_DATE';

export interface GoalAnalysisResult {
  targetAmount: number;
  savedAmount: number;
  remainingAmount: number;
  targetDate: Date | null;
  monthsUntilTarget: number | null;
  necessaryMonthlyAmount: number | null;
  prudentMonthlyAmount: number;
  targetStatus: GoalTargetStatus;
  realisticDate: Date | null;
  reasonCodes: ReasonCode[];
  isComplete: boolean;
}

/** §19 : « déjà mis de côté » = Σ GoalContribution confirmées — même convention que GoalsService (Lot 6). */
async function goalSavedAmount(tx: TxClient, goalId: string): Promise<number> {
  const contributions = await tx.goalContribution.findMany({ where: { goalId, status: 'confirme' } });
  return round2(contributions.reduce((sum, c) => sum + toNumber(c.actualAmount), 0));
}

/**
 * §19/§20/§35 : compare le rythme NÉCESSAIRE (arithmétique simple, explicitement demandé
 * comme référence de comparaison) au rythme PRUDENT (moteur de projection réel, jamais une
 * moyenne). §20 : la date réaliste n'est jamais `remaining / capacity` — elle réutilise le
 * rythme prudent calculé sur la timeline réelle, puis vérifie/affine sur l'horizon étendu
 * (jusqu'à 2 passes) pour tenir compte d'événements futurs qui changeraient la capacité
 * disponible sur une fenêtre plus longue.
 */
export async function analyzeGoal(tx: TxClient, householdId: string, referenceDate: Date, goalId: string, horizonDays?: number): Promise<GoalAnalysisResult> {
  const ref = toUtcMidnight(referenceDate);
  const goal = await tx.goal.findFirst({ where: { id: goalId, householdId } });
  if (!goal) throw new NotFoundException('Objectif introuvable dans ce foyer');
  const targetAmount = toNumber(goal.targetAmount);
  const savedAmount = await goalSavedAmount(tx, goalId);
  const remainingAmount = round2(Math.max(targetAmount - savedAmount, 0));
  const targetDate = goal.targetDate;

  const dayOfMonth = ref.getUTCDate();
  const analysisHorizonEnd = targetDate ? (targetDate.getTime() > ref.getTime() ? targetDate : addDaysUTC(ref, 1)) : addDaysUTC(ref, horizonDays ?? 365);
  const analysisHorizonDays = Math.max(Math.round((analysisHorizonEnd.getTime() - ref.getTime()) / 86400000), 1);

  const prudent = await computeSavingsCapacity(tx, householdId, ref, { recurring: true, dayOfMonth, horizonDays: analysisHorizonDays });

  let monthsUntilTarget: number | null = null;
  let necessaryMonthlyAmount: number | null = null;
  let targetStatus: GoalTargetStatus = 'NO_TARGET_DATE';
  let realisticDate: Date | null = null;
  const reasonCodes: ReasonCode[] = [];

  if (targetDate) {
    monthsUntilTarget = round2(Math.max((targetDate.getTime() - ref.getTime()) / 86400000, 0) / 30);
    necessaryMonthlyAmount = monthsUntilTarget > 0 ? round2(remainingAmount / monthsUntilTarget) : remainingAmount;

    if (prudent.maxAmount >= necessaryMonthlyAmount) {
      targetStatus = 'FEASIBLE_AT_REQUESTED_PACE';
    } else {
      targetStatus = 'NOT_FEASIBLE_AT_REQUESTED_PACE';
      reasonCodes.push('GOAL_TARGET_TOO_AGGRESSIVE');

      // §20 : estimation initiale à partir du rythme prudent réel, puis un passage d'affinage
      // sur l'horizon ainsi étendu (jamais une simple division isolée).
      if (prudent.maxAmount > 0) {
        let monthsNeeded = Math.ceil(remainingAmount / prudent.maxAmount);
        const refined = await computeSavingsCapacity(tx, householdId, ref, { recurring: true, dayOfMonth, horizonDays: monthsNeeded * 31 });
        if (refined.maxAmount > 0) {
          const refinedMonths = Math.ceil(remainingAmount / refined.maxAmount);
          monthsNeeded = Math.max(monthsNeeded, refinedMonths);
        }
        realisticDate = addMonthsUTC(ref, monthsNeeded);
      }
    }
  }

  return {
    targetAmount: round2(targetAmount),
    savedAmount,
    remainingAmount,
    targetDate,
    monthsUntilTarget,
    necessaryMonthlyAmount,
    prudentMonthlyAmount: prudent.maxAmount,
    targetStatus,
    realisticDate,
    reasonCodes,
    isComplete: prudent.isComplete,
  };
}
