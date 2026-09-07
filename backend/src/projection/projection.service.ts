import { BadRequestException, Injectable } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { computeProjection, ProjectionResult } from '../common/ledger/projection.util';
import { computeMonthlyProjection, MonthlyProjectionResult } from '../common/ledger/monthly-projection.util';
import { addDaysUTC } from '../common/ledger/variable-budget.util';
import { ensureChargeDeadlinesUntil, ensureIncomeOccurrencesUntil } from '../common/ledger/occurrence-generation.util';

type TxClient = ReturnType<RlsContextService['getClient']>;

const DEFAULT_HORIZON_DAYS = 30;

const ALLOWED_HORIZON_MONTHS = [3, 6, 12, 24, 36, 60] as const;
const DEFAULT_HORIZON_MONTHS = 12;

export interface MonthlyMoveRequest {
  deadlineId: string;
  newDate: string;
}

/**
 * GET /projection (§31 Lot 7) — moteur unique (docs/02 G.6, RG-051). `at`/`horizon`/`to`
 * toujours injectables — jamais `new Date()` implicite dans le domaine (cf. Lots 5/6).
 */
@Injectable()
export class ProjectionService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async get(userId: string, householdId: string, at: string | undefined, horizonDays: number | undefined, to: string | undefined) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const referenceDate = at ? new Date(at) : new Date();
      const horizonEnd = to ? new Date(to) : addDaysUTC(referenceDate, horizonDays ?? DEFAULT_HORIZON_DAYS);
      // Lot 11 (§1/§3) : génération AVANT lecture, avec l'horizon EXACT demandé par
      // cet appel — jamais une constante séparée, l'appelant fournit déjà tout.
      await ensureIncomeOccurrencesUntil(tx, householdId, horizonEnd);
      await ensureChargeDeadlinesUntil(tx, householdId, horizonEnd);
      return this.toApi(await computeProjection(tx, householdId, referenceDate, horizonEnd));
    });
  }

  /** Réutilisable sur une transaction déjà ouverte (DashboardService) — jamais un second rlsContext.run() imbriqué. */
  async getOnTx(tx: TxClient, householdId: string, referenceDate: Date, horizonDays: number) {
    const horizonEnd = addDaysUTC(referenceDate, horizonDays);
    // Générée séparément ici aussi : DashboardService appelle getOnTx() directement,
    // sans passer par get() — l'horizon 30 jours est déjà couvert par la génération
    // faite en tête de DashboardService.getSummary(), createMany/skipDuplicates rend
    // ce second passage un no-op sûr, jamais un doublon (idempotence, §1).
    await ensureIncomeOccurrencesUntil(tx, householdId, horizonEnd);
    await ensureChargeDeadlinesUntil(tx, householdId, horizonEnd);
    return this.toApi(await computeProjection(tx, householdId, referenceDate, horizonEnd));
  }

  /**
   * GET /projection/monthly (Round 4, §2/§3/§4/§19) — moteur mensuel consolidé,
   * réutilise EXCLUSIVEMENT computeProjection (via monthly-projection.util.ts) :
   * jamais un second calcul indépendant des revenus/dépenses. La génération de
   * récurrences couvre TOUT l'horizon demandé, jusqu'à 60 mois (§3/§18).
   */
  async getMonthly(
    userId: string,
    householdId: string,
    horizonMonths: number | undefined,
    at: string | undefined,
    incomeAccountIds: string[] | null | undefined,
    expenseAccountIds: string[] | null | undefined,
  ) {
    const months = this.validateHorizonMonths(horizonMonths);
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const referenceDate = at ? new Date(at) : new Date();
      const horizonEnd = this.monthsHorizonEnd(referenceDate, months);
      await ensureIncomeOccurrencesUntil(tx, householdId, horizonEnd);
      await ensureChargeDeadlinesUntil(tx, householdId, horizonEnd);
      const result = await computeMonthlyProjection(tx, householdId, referenceDate, months, { incomeAccountIds, expenseAccountIds });
      return this.toMonthlyApi(result);
    });
  }

  /**
   * POST /projection/monthly/simulate (§12/§13) — baseline ET scénario dans le MÊME
   * appel, pour la comparaison avant/après (§13). AUCUNE écriture réelle (IF-10) :
   * `moves` n'existe qu'en mémoire, sous forme de `dateOverrides` passé à
   * computeProjection — jamais lu/écrit en base ici.
   */
  async simulateMonthly(
    userId: string,
    householdId: string,
    horizonMonths: number | undefined,
    at: string | undefined,
    incomeAccountIds: string[] | null | undefined,
    expenseAccountIds: string[] | null | undefined,
    moves: MonthlyMoveRequest[],
  ) {
    const months = this.validateHorizonMonths(horizonMonths);
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const referenceDate = at ? new Date(at) : new Date();
      const horizonEnd = this.monthsHorizonEnd(referenceDate, months);
      await ensureIncomeOccurrencesUntil(tx, householdId, horizonEnd);
      await ensureChargeDeadlinesUntil(tx, householdId, horizonEnd);

      const options = { incomeAccountIds, expenseAccountIds };
      const baseline = await computeMonthlyProjection(tx, householdId, referenceDate, months, options);

      if (moves.length === 0) {
        const only = this.toMonthlyApi(baseline);
        return { baseline: only, scenario: only };
      }

      const dateOverrides = new Map<string, Date>();
      for (const move of moves) {
        if (!move.deadlineId || !move.newDate) {
          throw new BadRequestException('Chaque déplacement simulé requiert deadlineId et newDate');
        }
        dateOverrides.set(move.deadlineId, new Date(move.newDate));
      }
      const scenario = await computeMonthlyProjection(tx, householdId, referenceDate, months, { ...options, dateOverrides });

      return { baseline: this.toMonthlyApi(baseline), scenario: this.toMonthlyApi(scenario) };
    });
  }

  private validateHorizonMonths(horizonMonths: number | undefined): number {
    const months = horizonMonths ?? DEFAULT_HORIZON_MONTHS;
    if (!ALLOWED_HORIZON_MONTHS.includes(months as (typeof ALLOWED_HORIZON_MONTHS)[number])) {
      throw new BadRequestException(`horizon_months doit être l'une des valeurs suivantes : ${ALLOWED_HORIZON_MONTHS.join(', ')}`);
    }
    return months;
  }

  private monthsHorizonEnd(referenceDate: Date, horizonMonths: number): Date {
    const ref = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
    const targetMonthIndex0 = ref.getUTCMonth() + horizonMonths - 1;
    const targetYear = ref.getUTCFullYear() + Math.floor(targetMonthIndex0 / 12);
    const normalizedMonth = ((targetMonthIndex0 % 12) + 12) % 12;
    return new Date(Date.UTC(targetYear, normalizedMonth + 1, 0));
  }

  /** Contrat API en snake_case explicite (§31 Lot 7), étendu Round 4 pour la vue mensuelle. */
  private toMonthlyApi(result: MonthlyProjectionResult) {
    return {
      reference_date: result.referenceDate,
      horizon_end: result.horizonEnd,
      horizon_months: result.horizonMonths,
      months: result.months.map((m) => ({
        month: m.month,
        label: m.label,
        total_income: m.totalIncome,
        total_expense: m.totalExpense,
        balance: m.balance,
        cumulative_balance: m.cumulativeBalance,
        income_items: m.incomeItems,
        expense_items: m.expenseItems,
        movable_expense_total: m.movableExpenseTotal,
        is_complete: m.isComplete,
        unknown_count: m.unknownCount,
        unknown_labels: m.unknownLabels,
        contains_estimates: m.containsEstimates,
        excluded_by_filter_count: m.excludedByFilterCount,
        excluded_by_filter_total: m.excludedByFilterTotal,
      })),
      summary: {
        total_income: result.summary.totalIncome,
        total_expense: result.summary.totalExpense,
        total_balance: result.summary.totalBalance,
        deficit_months_count: result.summary.deficitMonthsCount,
        worst_month: result.summary.worstMonth,
        max_monthly_deficit: result.summary.maxMonthlyDeficit,
        max_financing_need: result.summary.maxFinancingNeed,
        first_positive_cumulative_month: result.summary.firstPositiveCumulativeMonth,
        is_complete: result.summary.isComplete,
        incomplete_months_count: result.summary.incompleteMonthsCount,
      },
      account_filters: result.accountFilters,
    };
  }

  /** Contrat API en snake_case explicite (§31), même convention que la correction Lot 5 §5. */
  private toApi(result: ProjectionResult) {
    return {
      reference_date: result.referenceDate,
      horizon_end: result.horizonEnd,

      opening_physical_treasury: result.openingPhysicalTreasury,
      closing_physical_treasury: result.closingPhysicalTreasury,
      physical_low_point: result.physicalLowPoint,
      physical_low_point_date: result.physicalLowPointDate,

      opening_free_capacity: result.openingFreeCapacity,
      closing_free_capacity: result.closingFreeCapacity,
      free_capacity_low_point: result.freeCapacityLowPoint,
      free_capacity_low_point_date: result.freeCapacityLowPointDate,

      first_negative_date: result.firstNegativeDate,
      deficit_at_first_negative: result.deficitAtFirstNegative,

      contains_estimates: result.containsEstimates,
      unknown_events_count: result.unknownEventsCount,
      is_complete: result.isComplete,
      envisaged_events_total: result.envisagedEventsTotal,
      status: result.status,

      timeline: result.timeline,
    };
  }
}
