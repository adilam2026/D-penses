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
  const rangeStart = new Date();
  // -1 jour : exactement horizonMonths occurrences mensuelles (jamais horizonMonths+1
  // en incluant par erreur la borne du 13e mois) — §21, jamais au-delà de 12 mois.
  const rangeEnd = new Date(addMonthsUtc(rangeStart, horizonMonths).getTime() - 24 * 60 * 60 * 1000);
  await ensurePlannedOccurrencesInRange(tx, householdId, rangeStart, rangeEnd);
}

type RuleRow = Awaited<ReturnType<TxClient['recurrenceRule']['findMany']>>[number];

/** Champs d'une occurrence copiés du gabarit de la règle (puis indépendants par occurrence). */
function occurrenceFromRule(householdId: string, rule: RuleRow, expectedDate: Date) {
  return {
    householdId,
    kind: rule.kind,
    recurrenceRuleId: rule.id,
    categoryId: rule.categoryId,
    financialPlanItemId: rule.financialPlanItemId,
    financialPlanDeadlineId: rule.financialPlanDeadlineId,
    sourceAccountId: rule.sourceAccountId,
    sourceSubaccountId: rule.sourceSubaccountId,
    destinationAccountId: rule.destinationAccountId,
    destinationSubaccountId: rule.destinationSubaccountId,
    expectedAmount: rule.expectedAmount,
    expectedDate,
    label: rule.label ?? 'Récurrence',
    // Lot "À faire" — même mécanique que source/montant ci-dessus : le
    // gabarit porte responsable/inclusion, chaque occurrence générée les
    // copie puis vit indépendamment (modifiable occurrence par occurrence).
    responsibleMemberId: rule.responsibleMemberId,
    responsibleSource: rule.responsibleSource,
    includeInTodo: rule.includeInTodo,
  };
}

/** Jamais de génération dans le passé : une date antérieure à aujourd'hui relève de l'historique. */
function notBeforeToday(date: Date): Date {
  const today = startOfUtcDay(new Date());
  return date < today ? today : date;
}

/**
 * Matérialise les occurrences manquantes des règles actives sur
 * [rangeStart, rangeEnd] uniquement (dates passées exclues). Même garantie
 * que la fenêtre glissante : `skipDuplicates` sur
 * @@unique([recurrenceRuleId, expectedDate]) — une occurrence existante
 * (modifiée, payée, annulée ou déplacée, qui laisse une ligne CANCELLED à sa
 * date d'origine) n'est jamais recréée ni écrasée. Utilisée par le Planning
 * pour la seule plage affichée au-delà de la fenêtre de 12 mois.
 */
export async function ensurePlannedOccurrencesInRange(tx: TxClient, householdId: string, rangeStart: Date, rangeEnd: Date): Promise<void> {
  const start = notBeforeToday(rangeStart);
  if (start > rangeEnd) return;
  const rules = await tx.recurrenceRule.findMany({ where: { householdId, active: true } });
  for (const rule of rules) {
    const dates = computeOccurrenceDates(rule.anchorDate, rule.frequency, start, rangeEnd);
    if (dates.length === 0) continue;
    await tx.plannedOperation.createMany({
      data: dates.map((expectedDate) => occurrenceFromRule(householdId, rule, expectedDate)),
      skipDuplicates: true,
    });
  }
}

/**
 * Point d'entrée commun Planning / À faire avant toute lecture d'une période
 * consultée : fenêtre glissante de 12 mois à jour, puis occurrences
 * manquantes de la période elle-même (même règles, mêmes garanties).
 */
export async function ensureOccurrencesForPeriod(tx: TxClient, householdId: string, periodStart: Date, periodEnd: Date): Promise<void> {
  await ensurePlannedOccurrences(tx, householdId);
  await ensurePlannedOccurrencesInRange(tx, householdId, periodStart, periodEnd);
}

/**
 * Occurrences que les règles actives produiraient sur [rangeStart, rangeEnd]
 * sans être encore en base — CALCULÉES EN MÉMOIRE, jamais enregistrées.
 * Sert uniquement aux mois intermédiaires d'une projection cumulée (ni
 * affichés ni actionnables). `existingKeys` : "ruleId|AAAA-MM-JJ" déjà en
 * base, tous statuts confondus (une annulée ou déplacée n'est jamais
 * réintroduite).
 */
export async function virtualPlannedOccurrences(tx: TxClient, householdId: string, rangeStart: Date, rangeEnd: Date, existingKeys: Set<string>) {
  const start = notBeforeToday(rangeStart);
  if (start > rangeEnd) return [];
  const rules = await tx.recurrenceRule.findMany({ where: { householdId, active: true } });
  return rules.flatMap((rule) =>
    computeOccurrenceDates(rule.anchorDate, rule.frequency, start, rangeEnd)
      .filter((date) => !existingKeys.has(occurrenceKey(rule.id, date)))
      .map((date) => ({
        ...occurrenceFromRule(householdId, rule, date),
        id: `virtual:${occurrenceKey(rule.id, date)}`,
        status: 'PENDING' as const,
        realizedOperationId: null,
      })),
  );
}

export function occurrenceKey(ruleId: string, date: Date): string {
  return `${ruleId}|${date.toISOString().slice(0, 10)}`;
}
