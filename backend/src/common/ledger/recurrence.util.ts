import { Prisma, RecurrenceFrequency } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

/** Horizon de génération (Checkpoint 3 §21) — jamais des années infinies, un an glissant seulement. */
export const RECURRENCE_HORIZON_MONTHS = 12;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addMonthsUtc(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

/** Occurrence suivante pour une fréquence donnée — ONCE n'a jamais de suivante (appelant ne doit jamais boucler dessus). */
export function nextOccurrenceDate(date: Date, frequency: RecurrenceFrequency): Date {
  switch (frequency) {
    case 'WEEKLY':
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 7));
    case 'MONTHLY':
      return addMonthsUtc(date, 1);
    case 'BIMONTHLY':
      return addMonthsUtc(date, 2);
    case 'QUARTERLY':
      return addMonthsUtc(date, 3);
    case 'SEMIANNUAL':
      return addMonthsUtc(date, 6);
    case 'YEARLY':
      return addMonthsUtc(date, 12);
    case 'ONCE':
      return date;
  }
}

/**
 * Toutes les dates d'occurrence entre [rangeStart, rangeEnd] (bornes incluses)
 * pour une règle donnée. Une règle ONCE ne produit jamais plus d'une date.
 */
export function computeOccurrenceDates(anchorDate: Date, frequency: RecurrenceFrequency, rangeStart: Date, rangeEnd: Date): Date[] {
  const anchor = startOfUtcDay(anchorDate);
  const start = startOfUtcDay(rangeStart);
  const end = startOfUtcDay(rangeEnd);

  if (frequency === 'ONCE') {
    return anchor >= start && anchor <= end ? [anchor] : [];
  }

  const dates: Date[] = [];
  let cursor = anchor;
  let guard = 0;
  // Avance jusqu'au début de la plage sans jamais générer d'occurrence passée hors plage.
  while (cursor < start && guard < 2000) {
    cursor = nextOccurrenceDate(cursor, frequency);
    guard++;
  }
  guard = 0;
  while (cursor <= end && guard < 2000) {
    dates.push(cursor);
    cursor = nextOccurrenceDate(cursor, frequency);
    guard++;
  }
  return dates;
}

/**
 * Génère les planned_operations manquantes pour toutes les règles actives du
 * foyer, jusqu'à RECURRENCE_HORIZON_MONTHS à partir d'aujourd'hui — jamais au
 *-delà (§21). Idempotent (§20) : `skipDuplicates` s'appuie sur
 * @@unique([recurrenceRuleId, expectedDate]), aucun doublon même appelé
 * plusieurs fois. Appelé paresseusement à chaque lecture du Planning — c'est
 * ainsi que la fenêtre glissante "se complète progressivement" avec le temps.
 */
export async function ensurePlannedOccurrences(tx: TxClient, householdId: string, horizonMonths = RECURRENCE_HORIZON_MONTHS): Promise<void> {
  const rules = await tx.recurrenceRule.findMany({ where: { householdId, active: true } });
  if (rules.length === 0) return;

  const rangeStart = new Date();
  // -1 jour : exactement horizonMonths occurrences mensuelles (jamais horizonMonths+1
  // en incluant par erreur la borne du 13e mois) — §21, jamais au-delà de 12 mois.
  const rangeEnd = new Date(addMonthsUtc(rangeStart, horizonMonths).getTime() - 24 * 60 * 60 * 1000);

  for (const rule of rules) {
    const dates = computeOccurrenceDates(rule.anchorDate, rule.frequency, rangeStart, rangeEnd);
    if (dates.length === 0) continue;

    await tx.plannedOperation.createMany({
      data: dates.map((expectedDate) => ({
        householdId,
        kind: rule.kind,
        recurrenceRuleId: rule.id,
        categoryId: rule.categoryId ?? undefined,
        financialPlanItemId: rule.financialPlanItemId ?? undefined,
        financialPlanDeadlineId: rule.financialPlanDeadlineId ?? undefined,
        sourceAccountId: rule.sourceAccountId ?? undefined,
        sourceSubaccountId: rule.sourceSubaccountId ?? undefined,
        destinationAccountId: rule.destinationAccountId ?? undefined,
        destinationSubaccountId: rule.destinationSubaccountId ?? undefined,
        expectedAmount: rule.expectedAmount,
        expectedDate,
        label: rule.label ?? 'Récurrence',
      })),
      skipDuplicates: true,
    });
  }
}
