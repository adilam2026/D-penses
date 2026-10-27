import { Injectable } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { ensureOccurrencesForPeriod } from '../common/ledger/recurrence.util';
import { buildPlanningTable, monthBounds, monthKey, PlanningMonthKey, shiftMonthKey } from '../common/ledger/planning.util';
import { buildTodoList, TodoList } from '../common/ledger/todo.util';

/**
 * "À faire" — vue OPÉRATIONNELLE du Planning (§ "Planning = qu'est-ce qui est
 * prévu ? / À faire = qu'est-ce que je dois exécuter maintenant ?"), jamais
 * un second moteur financier. Réutilise EXACTEMENT buildPlanningTable() (même
 * requêtes, même calcul prévu/déjà payé/reste que /planning) — zéro second
 * calcul, zéro risque de divergence entre les deux écrans.
 */
/**
 * Mois financier consulté par À faire : mois financier courant décalé de
 * `monthsOffset` MOIS. Raisonne uniquement sur les clés de mois : le 31/10,
 * +1 donne novembre (jamais un "31 novembre" normalisé en décembre).
 */
export function todoTargetMonth(now: Date, monthsOffset: number, monthStartDay: number): PlanningMonthKey {
  return shiftMonthKey(monthKey(now, monthStartDay), monthsOffset);
}

@Injectable()
export class TodoService {
  constructor(private readonly rlsContext: RlsContextService) {}

  /** monthsOffset : 0 = mois courant (par défaut), +1 = mois suivant, -1 = précédent, etc. */
  async getTodo(userId: string, householdId: string, monthsOffset = 0): Promise<TodoList> {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const household = await tx.household.findUniqueOrThrow({ where: { id: householdId }, select: { monthStartDay: true } });
      const monthStartDay = household.monthStartDay;

      // Même notion de "mois financier" que Planning (monthKey/monthBounds) —
      // jamais un décalage calendaire naïf quand monthStartDay ≠ 1.
      const now = new Date();
      const targetMonth = todoTargetMonth(now, monthsOffset, monthStartDay);
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
