import { Injectable } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { toNumber } from '../common/ledger/ledger.util';
import { computeCommittedAmounts, computeDisponibleLibre, computeNextDeadline } from '../common/ledger/treasury.util';
import { ActionsService } from '../actions/actions.service';
import { VariableBudgetsService } from '../variable-budgets/variable-budgets.service';
import { FinancialPlansService } from '../financial-plans/financial-plans.service';

/**
 * GET /dashboard/summary (§21) — un seul endpoint consolidé : tous les calculs
 * financiers restent côté domaine/backend, le mobile n'affiche que le résultat
 * (§21). Toutes les briques (treasury.util, ActionsService, VariableBudgetsService,
 * FinancialPlansService) sont appelées sur LA MÊME transaction (tx-scoped) — jamais
 * de rlsContext.run() imbriqué (cf. bugs corrigés aux Lots 3/4).
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
      const committed = await computeCommittedAmounts(tx, householdId, referenceDate);
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
        referenceDate,
        // Vocabulaire figé (§13) — jamais renommé ailleurs dans l'API/mobile.
        tresorerieOperationnelle: disponible.tresorerieOperationnelle,
        disponibleLibre: disponible.disponibleLibre,
        montantsReserves: disponible.montantsReserves,
        montantsEngages: disponible.montantsEngages,
        coussinSecurite: disponible.coussinSecurite,
        patrimoineLiquideTotal: disponible.patrimoineLiquideTotal,
        calculIncomplet: disponible.incomplet, // §6 : au moins un montant inconnu dans l'horizon
        contientEstimations: disponible.hasEstimates, // §18
        horizon: disponible.horizon,
        engagements: {
          connu: committed.knownAmount,
          unknownCount: committed.unknownCount,
          items: committed.items,
        },
        optionsEnvisagees: {
          total: committed.envisagedTotal,
          hasUnknown: committed.envisagedHasUnknown,
        },
        prochaineEcheance: nextDeadline,
        actionsATraiter,
        budgetsResume,
        financialPlansResume,
      };
    });
  }
}
