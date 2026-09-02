import { Injectable } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { computeProjection, ProjectionResult } from '../common/ledger/projection.util';
import { addDaysUTC } from '../common/ledger/variable-budget.util';

type TxClient = ReturnType<RlsContextService['getClient']>;

const DEFAULT_HORIZON_DAYS = 30;

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
      return this.toApi(await computeProjection(tx, householdId, referenceDate, horizonEnd));
    });
  }

  /** Réutilisable sur une transaction déjà ouverte (DashboardService) — jamais un second rlsContext.run() imbriqué. */
  async getOnTx(tx: TxClient, householdId: string, referenceDate: Date, horizonDays: number) {
    return this.toApi(await computeProjection(tx, householdId, referenceDate, addDaysUTC(referenceDate, horizonDays)));
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
