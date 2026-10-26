import { Injectable } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { ensureOccurrencesForPeriod } from '../common/ledger/recurrence.util';
import { buildPlanningTable, monthBounds, monthRange } from '../common/ledger/planning.util';
import { buildTodoList, TodoList } from '../common/ledger/todo.util';

/**
 * "À faire" — vue OPÉRATIONNELLE du Planning (§ "Planning = qu'est-ce qui est
 * prévu ? / À faire = qu'est-ce que je dois exécuter maintenant ?"), jamais
 * un second moteur financier. Réutilise EXACTEMENT buildPlanningTable() (même
 * requêtes, même calcul prévu/déjà payé/reste que /planning) — zéro second
 * calcul, zéro risque de divergence entre les deux écrans.
 */
@Injectable()
export class TodoService {
  constructor(private readonly rlsContext: RlsContextService) {}

  /** monthsOffset : 0 = mois courant (par défaut), +1 = mois suivant, -1 = précédent, etc. */
  async getTodo(userId: string, householdId: string, monthsOffset = 0): Promise<TodoList> {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const household = await tx.household.findUniqueOrThrow({ where: { id: householdId }, select: { monthStartDay: true } });
      const monthStartDay = household.monthStartDay;

      const now = new Date();
      // Même notion de "mois financier" que Planning (monthRange/monthBounds) —
      // jamais un décalage calendaire naïf quand monthStartDay ≠ 1.
      const shifted = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsOffset, now.getUTCDate()));
      const targetMonth = monthRange(shifted, 1, monthStartDay)[0];
      const { start: rangeStart, end: rangeEnd } = monthBounds(targetMonth, monthStartDay);
      // Même matérialisation que le Planning : un mois consulté directement
      // dans À faire, même au-delà de 12 mois, contient ses récurrences.
      await ensureOccurrencesForPeriod(tx, householdId, rangeStart, rangeEnd);

      const [plannedOperations, categories, accounts, subaccounts] = await Promise.all([
        tx.plannedOperation.findMany({ where: { householdId, expectedDate: { gte: rangeStart, lte: rangeEnd } } }),
        tx.category.findMany({ where: { householdId } }),
        tx.account.findMany({ where: { householdId } }),
        tx.subaccount.findMany({ where: { householdId } }),
      ]);

      // Même logique que planning.service.ts : un paiement partiel peut avoir
      // sa PROPRE date hors de la fenêtre du mois affiché.
      const plannedOperationIds = plannedOperations.map((p) => p.id);
      const financialOperations = await tx.financialOperation.findMany({
        where: {
          householdId,
          kind: { in: ['EXPENSE', 'INCOME', 'SAVINGS_CONTRIBUTION'] },
          OR: [{ date: { gte: rangeStart, lte: rangeEnd } }, { plannedOperationId: { in: plannedOperationIds } }],
        },
      });

      // "À faire" n'affiche jamais la couverture — maps vides, aucune requête
      // de solde supplémentaire nécessaire (synthese.couverte/aProvisionner ne sont jamais lus ici).
      const table = buildPlanningTable({
        months: [targetMonth],
        plannedOperations,
        financialOperations,
        categories,
        accountNames: new Map(accounts.map((a) => [a.id, a.name])),
        subaccountNames: new Map(subaccounts.map((s) => [s.id, s.name])),
        accountNonAffecte: new Map(),
        subaccountBalances: new Map(),
        monthStartDay,
      });

      return buildTodoList(table.occurrences, targetMonth, now);
    });
  }
}
