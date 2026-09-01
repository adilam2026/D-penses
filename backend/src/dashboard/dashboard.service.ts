import { Injectable } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { toNumber } from '../common/ledger/ledger.util';
import { computeDisponibleLibre, computeNextDeadline } from '../common/ledger/treasury.util';
import { ActionsService } from '../actions/actions.service';
import { VariableBudgetsService } from '../variable-budgets/variable-budgets.service';
import { FinancialPlansService } from '../financial-plans/financial-plans.service';

/**
 * GET /dashboard/summary (§21) — un seul endpoint consolidé : tous les calculs
 * financiers restent côté domaine/backend, le mobile n'affiche que le résultat.
 * Toutes les briques (treasury.util, ActionsService, VariableBudgetsService,
 * FinancialPlansService) sont appelées sur LA MÊME transaction (tx-scoped) —
 * jamais de rlsContext.run() imbriqué (cf. bugs corrigés aux Lots 3/4).
 *
 * Contrat d'API figé par la correction Lot 5 (§5) : les champs financiers sont
 * exposés en snake_case explicite, avec committed_amount = deadline_commitments
 * + variable_budget_commitments — jamais l'un sans l'autre, jamais fusionnés
 * silencieusement.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly rlsContext: RlsContextService,
    private readonly actions: ActionsService,
    private readonly variableBudgets: VariableBudgetsService,
    private readonly financialPlans: FinancialPlansService,
  ) {}

  async getSummary(userId: string, householdId: string, referenceDate: Date) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();

      const disponible = await computeDisponibleLibre(tx, householdId, referenceDate);
      const nextDeadline = await computeNextDeadline(tx, householdId, referenceDate);
      const actionsATraiter = await this.actions.listOnTx(tx, householdId, referenceDate);

      const budgets = await tx.variableBudget.findMany({ where: { householdId }, include: { category: true } });
      const budgetsResume = await Promise.all(
        budgets.map(async (b) => {
          const status = await this.variableBudgets.getBudgetStatusOnTx(tx, householdId, b.id, referenceDate);
          return { id: b.id, categoryName: b.category.name, referenceAmount: toNumber(b.referenceAmount), referencePeriod: b.referencePeriod, status };
        }),
      );

      const financialPlansResume = (await this.financialPlans.listOnTx(tx, householdId)).map((p) => ({
        id: p.id,
        label: p.label,
        knownPlanCost: p.knownPlanCost,
        remainingDue: p.remainingDue,
        completude: p.completude,
      }));

      return {
        reference_date: referenceDate,

        operational_treasury: disponible.tresorerieOperationnelle,
        reserved_amount: disponible.montantsReserves,
        deadline_commitments: disponible.deadlineCommitments,
        variable_budget_commitments: disponible.variableBudgetCommitments,
        committed_amount: disponible.montantsEngages, // = deadline_commitments + variable_budget_commitments
        safety_buffer: disponible.coussinSecurite,
        free_available: disponible.disponibleLibre,

        // Patrimoine liquide total — accessible secondairement (§12), pas dans la liste minimale §5 mais jamais retiré.
        patrimoine_liquide_total: disponible.patrimoineLiquideTotal,

        horizon_date: disponible.horizon.date,
        horizon_source: disponible.horizon.source, // 'income' | 'fallback'
        horizon_is_fallback: disponible.horizon.isFallback,

        contains_estimates: disponible.hasEstimates,
        unknown_commitments_count: disponible.unknownCount,
        is_complete: !disponible.incomplet,

        deadlineItems: disponible.deadlineItems,
        optionsEnvisagees: {
          total: disponible.envisagedTotal,
          hasUnknown: disponible.envisagedHasUnknown,
        },
        prochaineEcheance: nextDeadline,
        actionsATraiter,
        budgetsResume,
        financialPlansResume,
      };
    });
  }
}
