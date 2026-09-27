import { Prisma } from '@prisma/client';
import { effectiveAmount } from './ledger.util';

type TxClient = Prisma.TransactionClient;

export interface DeadlinePlannedOperationInput {
  id: string;
  status: 'PENDING' | 'REALIZED' | 'CANCELLED';
  label: string;
  financialPlanItemId: string | null;
  expectedAmount: Prisma.Decimal;
  realizedOperation: { amount: Prisma.Decimal; reversalOfOperationId: string | null } | null;
}

export interface DeadlineSummaryInput {
  id: string;
  label: string;
  dueDate: Date;
  plannedOperations: DeadlinePlannedOperationInput[];
}

export interface DeadlineItemLine {
  plannedOperationId: string;
  itemId: string | null;
  label: string;
  amount: number;
  status: 'PENDING' | 'REALIZED';
}

export interface DeadlineSummary {
  deadlineId: string;
  label: string;
  dueDate: Date;
  totalPrevu: number;
  disponible: number;
  reste: number;
  monthsRemaining: number;
  recommendedMonthly: number;
  /** Toutes les lignes PENDING+REALIZED sont REALIZED (et il y en a au moins une) — jamais vrai pour une échéance vide. */
  paid: boolean;
  items: DeadlineItemLine[];
}

function toNumber(d: Prisma.Decimal): number {
  return d.toNumber();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Nombre de mois pleins restants jusqu'à dueDate (arrondi au supérieur, jamais < 1). */
function monthsRemainingUntil(now: Date, dueDate: Date): number {
  const months = (dueDate.getUTCFullYear() - now.getUTCFullYear()) * 12 + (dueDate.getUTCMonth() - now.getUTCMonth());
  const adjusted = dueDate.getUTCDate() < now.getUTCDate() ? months + 1 : months;
  return Math.max(1, adjusted);
}

/**
 * Prochaine échéance (Checkpoint 3 §prochaine échéance/recommandation) : le
 * "besoin" (total_prevu) et le "disponible" ne sont JAMAIS stockés — ils sont
 * dérivés des planned_operations liées à cette échéance (cf. commentaire du
 * schéma : "aucun montant stocké ici"). disponible ne compte QUE les
 * versements réellement réalisés (jamais les simples prévus) — recalculé
 * automatiquement à chaque paiement réel, jamais figé.
 */
export function computeDeadlineSummary(deadline: DeadlineSummaryInput, now: Date = new Date()): DeadlineSummary {
  let totalPrevu = 0;
  let disponible = 0;
  const items: DeadlineItemLine[] = [];
  let activeCount = 0;
  let realizedCount = 0;

  for (const op of deadline.plannedOperations) {
    if (op.status === 'CANCELLED') continue;
    activeCount++;
    totalPrevu += toNumber(op.expectedAmount);
    if (op.status === 'REALIZED' && op.realizedOperation) {
      realizedCount++;
      const amount = toNumber(effectiveAmount(op.realizedOperation));
      disponible += amount;
      items.push({ plannedOperationId: op.id, itemId: op.financialPlanItemId, label: op.label, amount, status: 'REALIZED' });
    } else {
      items.push({ plannedOperationId: op.id, itemId: op.financialPlanItemId, label: op.label, amount: toNumber(op.expectedAmount), status: 'PENDING' });
    }
  }
  const reste = Math.max(0, round2(totalPrevu - disponible));
  const monthsRemaining = monthsRemainingUntil(now, deadline.dueDate);
  const recommendedMonthly = reste > 0 ? round2(reste / monthsRemaining) : 0;

  return {
    deadlineId: deadline.id,
    label: deadline.label,
    dueDate: deadline.dueDate,
    totalPrevu: round2(totalPrevu),
    disponible: round2(disponible),
    reste,
    monthsRemaining,
    recommendedMonthly,
    paid: activeCount > 0 && activeCount === realizedCount,
    items,
  };
}

/** La prochaine échéance d'un plan : la plus proche dont la date n'est pas encore dépassée, sinon la plus proche tout court. */
export function pickNextDeadline<T extends { dueDate: Date }>(deadlines: T[], now: Date = new Date()): T | null {
  if (deadlines.length === 0) return null;
  const upcoming = deadlines.filter((d) => d.dueDate >= now).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  if (upcoming.length > 0) return upcoming[0];
  return [...deadlines].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
}

/**
 * Éléments récurrents d'un plan (§14 Checkpoint 4) : un élément non-ONCE
 * s'applique automatiquement à TOUTES les échéances existantes du plan
 * (simplification assumée — les échéances d'un plan familial partagent
 * généralement la même cadence que ses postes récurrents, ex. frais
 * scolaires trimestriels sur des échéances trimestrielles). Idempotent via
 * l'index unique partiel (financial_plan_item_id, financial_plan_deadline_id)
 * — jamais de doublon même appelé plusieurs fois. Un élément ONCE n'est
 * JAMAIS généré automatiquement : il doit être ajouté explicitement à une
 * échéance précise (cf. FinancialPlansService#addItemToDeadline).
 */
export async function ensurePlanItemOccurrences(tx: TxClient, planId: string): Promise<void> {
  const plan = await tx.financialPlan.findUnique({
    where: { id: planId },
    include: { items: { where: { active: true, frequency: { not: 'ONCE' } } }, deadlines: true },
  });
  if (!plan || plan.items.length === 0 || plan.deadlines.length === 0) return;

  for (const item of plan.items) {
    if (item.expectedAmount == null) continue;
    await tx.plannedOperation.createMany({
      data: plan.deadlines.map((deadline) => ({
        householdId: plan.householdId,
        kind: 'EXPENSE' as const,
        label: item.label,
        expectedAmount: item.expectedAmount!,
        expectedDate: deadline.dueDate,
        financialPlanItemId: item.id,
        financialPlanDeadlineId: deadline.id,
        sourceAccountId: plan.accountId ?? undefined,
        sourceSubaccountId: plan.subaccountId ?? undefined,
      })),
      skipDuplicates: true,
    });
  }
}
