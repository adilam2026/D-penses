import { Prisma } from '@prisma/client';
import { effectiveAmount } from './ledger.util';

export interface DeadlinePlannedOperationInput {
  status: 'PENDING' | 'REALIZED' | 'CANCELLED';
  expectedAmount: Prisma.Decimal;
  realizedOperation: { amount: Prisma.Decimal; reversalOfOperationId: string | null } | null;
}

export interface DeadlineSummaryInput {
  id: string;
  label: string;
  dueDate: Date;
  plannedOperations: DeadlinePlannedOperationInput[];
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
  for (const op of deadline.plannedOperations) {
    if (op.status === 'CANCELLED') continue;
    totalPrevu += toNumber(op.expectedAmount);
    if (op.status === 'REALIZED' && op.realizedOperation) {
      disponible += toNumber(effectiveAmount(op.realizedOperation));
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
  };
}

/** La prochaine échéance d'un plan : la plus proche dont la date n'est pas encore dépassée, sinon la plus proche tout court. */
export function pickNextDeadline<T extends { dueDate: Date }>(deadlines: T[], now: Date = new Date()): T | null {
  if (deadlines.length === 0) return null;
  const upcoming = deadlines.filter((d) => d.dueDate >= now).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  if (upcoming.length > 0) return upcoming[0];
  return [...deadlines].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
}
