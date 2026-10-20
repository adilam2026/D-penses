import { PlanningMonthKey, PlanningOccurrenceRecord } from './planning.util';

/**
 * Lot "À faire" — vue OPÉRATIONNELLE du Planning, jamais un second moteur
 * financier : construite à partir de PlanningOccurrenceRecord[], déjà calculé
 * par buildPlanningTable() (même prévu/déjà payé/reste que le Planning,
 * jamais une seconde logique qui pourrait diverger — §12 "Aucune
 * synchronisation artificielle, les deux écrans lisent le même état").
 */
export interface TodoActionRecord {
  plannedOperationId: string;
  kind: 'EXPENSE' | 'SAVINGS_CONTRIBUTION';
  label: string;
  expectedAmount: number;
  /** "Déjà payé" cumulé — null tant que rien n'est payé (même convention que Planning). */
  realizedAmount: number | null;
  /** = expectedAmount - (realizedAmount ?? 0) — précalculé pour éviter toute dérive de calcul côté mobile. */
  remaining: number;
  expectedDate: string;
  sourceAccountId: string | null;
  sourceSubaccountId: string | null;
  destinationAccountId: string | null;
  destinationSubaccountId: string | null;
  recurrenceRuleId: string | null;
  categoryId: string | null;
  /** RESPONSABLE ≠ SOURCE — null = "Responsable à définir" (reste visible dans "Tous", jamais masqué). */
  responsibleMemberId: string | null;
  status: 'PENDING' | 'REALIZED';
  /** PENDING dont expectedDate < aujourd'hui — jamais pertinent pour REALIZED. */
  late: boolean;
}

export interface TodoList {
  month: PlanningMonthKey;
  pending: TodoActionRecord[];
  done: TodoActionRecord[];
  /** = pending.length — "N actions restantes" (§4), jamais une somme de paiements. */
  pendingCount: number;
  /** Somme des RESTES (jamais des montants prévus initiaux) — §4. */
  totalRemaining: number;
}

/** Comparaison purement textuelle sur 'YYYY-MM-DD' (ISO), jamais de fuseau — cohérent avec le reste du Planning. */
function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * §7 : seules les échéances EXPENSE/SAVINGS_CONTRIBUTION marquées
 * includeInTodo entrent dans "À faire" — INCOME en est TOUJOURS exclu (V1),
 * TRANSFERT n'existe pas encore à l'état planifié (hors périmètre de ce lot).
 * §14 : tri retard < aujourd'hui < à venir, puis chronologique.
 */
export function buildTodoList(occurrences: PlanningOccurrenceRecord[], month: PlanningMonthKey, now: Date): TodoList {
  const today = dateOnly(now.toISOString());
  const eligible = occurrences.filter((o) => o.month === month && o.includeInTodo && o.kind !== 'INCOME');

  const pending: TodoActionRecord[] = [];
  const done: TodoActionRecord[] = [];

  for (const o of eligible) {
    const remaining = o.expectedAmount - (o.realizedAmount ?? 0);
    const record: TodoActionRecord = {
      plannedOperationId: o.plannedOperationId,
      kind: o.kind as 'EXPENSE' | 'SAVINGS_CONTRIBUTION',
      label: o.label,
      expectedAmount: o.expectedAmount,
      realizedAmount: o.realizedAmount,
      remaining,
      expectedDate: o.expectedDate,
      sourceAccountId: o.sourceAccountId,
      sourceSubaccountId: o.sourceSubaccountId,
      destinationAccountId: o.destinationAccountId,
      destinationSubaccountId: o.destinationSubaccountId,
      recurrenceRuleId: o.recurrenceRuleId,
      categoryId: o.categoryId,
      responsibleMemberId: o.responsibleMemberId,
      status: o.status,
      late: o.status === 'PENDING' && dateOnly(o.expectedDate) < today,
    };
    (o.status === 'PENDING' ? pending : done).push(record);
  }

  function sortRank(r: TodoActionRecord): 0 | 1 | 2 {
    const d = dateOnly(r.expectedDate);
    if (d < today) return 0; // en retard
    if (d === today) return 1; // aujourd'hui
    return 2; // prochaines actions
  }
  pending.sort((a, b) => sortRank(a) - sortRank(b) || a.expectedDate.localeCompare(b.expectedDate));
  // "Effectué" : plus récent d'abord — lecture naturelle d'un historique du mois.
  done.sort((a, b) => b.expectedDate.localeCompare(a.expectedDate));

  return {
    month,
    pending,
    done,
    pendingCount: pending.length,
    totalRemaining: pending.reduce((sum, r) => sum + r.remaining, 0),
  };
}
