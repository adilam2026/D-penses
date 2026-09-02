import { Injectable } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { ProjectionSlice, analyzeGoal, computeSavingsCapacity, simulateGoalContribution, simulatePurchase } from '../common/ledger/simulation.util';
import { SimulatePurchaseDto } from './dto/simulate-purchase.dto';
import { SimulateGoalContributionDto } from './dto/simulate-goal-contribution.dto';
import { SavingsCapacityDto } from './dto/savings-capacity.dto';
import { AnalyzeGoalDto } from './dto/analyze-goal.dto';

/**
 * GET/POST /simulation (§30 Lot 8) — What-if pur : chaque méthode ouvre une transaction
 * RLS en LECTURE SEULE (aucun tx.xxx.create/update/delete jamais appelé ici ni dans
 * common/ledger/simulation.util.ts) — IF-10 garanti par construction (§29/TEST 1/12).
 * Contrat API en snake_case explicite, comme la carte Dashboard/GET /projection (Lot 7).
 */
@Injectable()
export class SimulationService {
  constructor(private readonly rlsContext: RlsContextService) {}

  private sliceToApi(s: ProjectionSlice) {
    return {
      closing_physical_treasury: s.closingPhysicalTreasury,
      physical_low_point: s.physicalLowPoint,
      physical_low_point_date: s.physicalLowPointDate,
      free_capacity_low_point: s.freeCapacityLowPoint,
      free_capacity_low_point_date: s.freeCapacityLowPointDate,
      first_negative_date: s.firstNegativeDate,
      deficit_at_first_negative: s.deficitAtFirstNegative,
    };
  }

  async purchase(userId: string, householdId: string, at: string | undefined, dto: SimulatePurchaseDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const referenceDate = at ? new Date(at) : new Date();
      const result = await simulatePurchase(tx, householdId, referenceDate, {
        amount: dto.amount,
        date: new Date(dto.date),
        accountId: dto.accountId,
        horizonDays: dto.horizonDays,
        includeEnvisagedOptions: dto.includeEnvisagedOptions,
      });
      return {
        decision: result.decision,
        possible_date: result.possibleDate,
        recommended_date: result.recommendedDate,
        baseline: this.sliceToApi(result.baseline),
        scenario: this.sliceToApi(result.scenario),
        physical_low_point_after: result.physicalLowPointAfter,
        free_capacity_low_point_after: result.freeCapacityLowPointAfter,
        margin_after_purchase: result.marginAfterPurchase,
        delta_closing_physical: result.deltaClosingPhysical,
        delta_physical_low_point: result.deltaPhysicalLowPoint,
        delta_free_capacity_low_point: result.deltaFreeCapacityLowPoint,
        reason_codes: result.reasonCodes,
        is_complete: result.isComplete,
        contains_estimates: result.containsEstimates,
      };
    });
  }

  async goalContribution(userId: string, householdId: string, at: string | undefined, dto: SimulateGoalContributionDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const referenceDate = at ? new Date(at) : new Date();
      const result = await simulateGoalContribution(tx, householdId, referenceDate, {
        goalId: dto.goalId,
        amount: dto.amount,
        date: new Date(dto.date),
        recurring: dto.recurring,
        dayOfMonth: dto.dayOfMonth,
        horizonDays: dto.horizonDays,
      });
      return {
        baseline: this.sliceToApi(result.baseline),
        scenario: this.sliceToApi(result.scenario),
        delta_free_capacity_low_point: result.deltaFreeCapacityLowPoint,
        contribution_dates: result.contributionDates,
        reserve_added_total: result.reserveAddedTotal,
        is_complete: result.isComplete,
        contains_estimates: result.containsEstimates,
      };
    });
  }

  async savingsCapacity(userId: string, householdId: string, at: string | undefined, dto: SavingsCapacityDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const referenceDate = at ? new Date(at) : new Date();
      const result = await computeSavingsCapacity(tx, householdId, referenceDate, {
        recurring: dto.recurring,
        date: dto.date ? new Date(dto.date) : undefined,
        dayOfMonth: dto.dayOfMonth,
        horizonDays: dto.horizonDays,
      });
      return {
        max_amount: result.maxAmount,
        recurring: result.recurring,
        horizon_end: result.horizonEnd,
        contribution_dates: result.contributionDates,
        is_complete: result.isComplete,
        contains_estimates: result.containsEstimates,
      };
    });
  }

  async goal(userId: string, householdId: string, at: string | undefined, dto: AnalyzeGoalDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const referenceDate = at ? new Date(at) : new Date();
      const result = await analyzeGoal(tx, householdId, referenceDate, dto.goalId, dto.horizonDays);
      return {
        target_amount: result.targetAmount,
        saved_amount: result.savedAmount,
        remaining_amount: result.remainingAmount,
        target_date: result.targetDate,
        months_until_target: result.monthsUntilTarget,
        necessary_monthly_amount: result.necessaryMonthlyAmount,
        prudent_monthly_amount: result.prudentMonthlyAmount,
        target_status: result.targetStatus,
        realistic_date: result.realisticDate,
        reason_codes: result.reasonCodes,
        is_complete: result.isComplete,
      };
    });
  }
}
