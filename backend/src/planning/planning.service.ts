import { Injectable } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { ensurePlannedOccurrences } from '../common/ledger/recurrence.util';
import { buildPlanningTable, monthRange, PlanningMonthKey } from '../common/ledger/planning.util';

export const PLANNING_MIN_MONTHS = 3;
export const PLANNING_MAX_MONTHS = 12;
export const PLANNING_DEFAULT_MONTHS = 6;

function clampMonths(months?: number): number {
  if (!months || Number.isNaN(months)) return PLANNING_DEFAULT_MONTHS;
  return Math.min(PLANNING_MAX_MONTHS, Math.max(PLANNING_MIN_MONTHS, Math.floor(months)));
}

@Injectable()
export class PlanningService {
  constructor(private readonly rlsContext: RlsContextService) {}

  /**
   * Endpoint agrégé unique (§performance) : une seule requête retourne toute
   * la table groupée — jamais 1 requête par ligne/mois/catégorie.
   */
  async getPlanning(userId: string, householdId: string, months?: number) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();

      // Fenêtre glissante toujours à jour (§génération des occurrences) avant lecture.
      await ensurePlannedOccurrences(tx, householdId);

      const horizonMonths = clampMonths(months);
      const now = new Date();
      const monthsList: PlanningMonthKey[] = monthRange(now, horizonMonths);
      const rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const rangeEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + horizonMonths, 0));

      const [plannedOperations, financialOperations, categories, accounts, subaccounts] = await Promise.all([
        tx.plannedOperation.findMany({
          where: { householdId, expectedDate: { gte: rangeStart, lte: rangeEnd } },
          include: { realizedOperation: true },
        }),
        tx.financialOperation.findMany({
          where: { householdId, date: { gte: rangeStart, lte: rangeEnd }, kind: { in: ['EXPENSE', 'INCOME', 'SAVINGS_CONTRIBUTION'] } },
        }),
        tx.category.findMany({ where: { householdId } }),
        tx.account.findMany({ where: { householdId } }),
        tx.subaccount.findMany({ where: { householdId } }),
      ]);

      return buildPlanningTable({
        months: monthsList,
        plannedOperations,
        financialOperations,
        categories,
        accountNames: new Map(accounts.map((a) => [a.id, a.name])),
        subaccountNames: new Map(subaccounts.map((s) => [s.id, s.name])),
      });
    });
  }
}
