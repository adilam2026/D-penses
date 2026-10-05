import { Injectable } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { ensurePlannedOccurrences } from '../common/ledger/recurrence.util';
import { computeNonAffecte, computeSubaccountBalance } from '../common/ledger/ledger.util';
import { buildPlanningTable, monthBounds, monthRange, PlanningMonthKey } from '../common/ledger/planning.util';

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

      const household = await tx.household.findUniqueOrThrow({ where: { id: householdId }, select: { monthStartDay: true } });
      const monthStartDay = household.monthStartDay;

      const horizonMonths = clampMonths(months);
      const now = new Date();
      const monthsList: PlanningMonthKey[] = monthRange(now, horizonMonths, monthStartDay);
      // Bornes réelles de la fenêtre financière (§ début du mois) — jamais le
      // 1er/dernier jour calendaire naïf quand monthStartDay ≠ 1.
      const rangeStart = monthBounds(monthsList[0], monthStartDay).start;
      const rangeEnd = monthBounds(monthsList[monthsList.length - 1], monthStartDay).end;

      const [plannedOperations, categories, accounts, subaccounts] = await Promise.all([
        tx.plannedOperation.findMany({ where: { householdId, expectedDate: { gte: rangeStart, lte: rangeEnd } } }),
        tx.category.findMany({ where: { householdId } }),
        tx.account.findMany({ where: { householdId } }),
        tx.subaccount.findMany({ where: { householdId } }),
      ]);

      // Lot "paiements partiels successifs" : un paiement partiel peut avoir
      // sa PROPRE date hors de la fenêtre affichée (ex. échéance due le 30,
      // payée en partie le 2 du mois suivant) — il doit malgré tout compter
      // dans "déjà payé"/"reste" de l'échéance, affichée dans SA propre case
      // (celle du mois de l'échéance, cf. planning.util.ts). On récupère donc
      // en plus, sans condition de date, toute opération déjà liée à l'une
      // des échéances affichées.
      const plannedOperationIds = plannedOperations.map((p) => p.id);
      const financialOperations = await tx.financialOperation.findMany({
        where: {
          householdId,
          kind: { in: ['EXPENSE', 'INCOME', 'SAVINGS_CONTRIBUTION'] },
          OR: [{ date: { gte: rangeStart, lte: rangeEnd } }, { plannedOperationId: { in: plannedOperationIds } }],
        },
      });

      // Lot "couverture des dépenses restantes" — soldes RÉELS actuels (non-
      // affecté par compte, solde par enveloppe), utilisés UNIQUEMENT pour le
      // mois courant (cf. buildPlanningTable). Jamais une projection : pour
      // les mois futurs, aucune valeur fiable n'existe dans le modèle actuel
      // (pas de solde-par-mois stocké/projeté) — cf. rapport de livraison.
      const [accountNonAffecteEntries, subaccountBalanceEntries] = await Promise.all([
        Promise.all(accounts.map(async (a): Promise<[string, number]> => [a.id, (await computeNonAffecte(tx, a.id)).toNumber()])),
        Promise.all(subaccounts.map(async (s): Promise<[string, number]> => [s.id, (await computeSubaccountBalance(tx, s.id)).toNumber()])),
      ]);

      return buildPlanningTable({
        months: monthsList,
        plannedOperations,
        financialOperations,
        categories,
        accountNames: new Map(accounts.map((a) => [a.id, a.name])),
        subaccountNames: new Map(subaccounts.map((s) => [s.id, s.name])),
        accountNonAffecte: new Map(accountNonAffecteEntries),
        subaccountBalances: new Map(subaccountBalanceEntries),
        monthStartDay,
      });
    });
  }
}
