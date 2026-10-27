import { Prisma, PrismaClient, RecurrenceFrequency } from '@prisma/client';
import { legacyOccurrenceDates, occurrenceDate } from './recurrence.util';

/**
 * Reprise des occurrences récurrentes antérieures au lot « n° d'occurrence »
 * — SIMULATION UNIQUEMENT. Ce module ne contient aucune écriture : il
 * calcule, pour chaque ligne déjà en base sans n°, sa catégorie et l'action
 * que la reprise réelle effectuerait, et produit un rapport. Les lectures
 * sont faites dans une transaction PostgreSQL READ ONLY : toute écriture y
 * échouerait.
 *
 * Principes validés :
 * - le n° logique d'une ligne existante est retrouvé via l'ANCIEN calcul de
 *   dates (chaîné depuis l'ancrage) — correspondance par n°, jamais par date ;
 * - seule une occurrence FUTURE, en attente, intacte (jamais modifiée, sans
 *   paiement) est recalée sur sa date correcte (jour d'origine, dernier jour
 *   du mois s'il n'existe pas) ;
 * - réalisée, partiellement payée, modifiée, annulée, emplacement d'origine
 *   d'un ancien déplacement : conservées telles quelles (seul leur n° serait
 *   renseigné) — le n° suffit à empêcher toute recréation, sans ligne
 *   « annulée » technique.
 */

export type RepriseCategory =
  | 'INTACTE_FUTURE'
  | 'INTACTE_PASSEE'
  | 'REALISEE'
  | 'PARTIELLEMENT_PAYEE'
  | 'MODIFIEE'
  | 'ANNULEE'
  | 'ORIGINE_DEPLACEMENT'
  | 'DEJA_NUMEROTEE'
  | 'HORS_SERIE';

export type RepriseAction = 'NUMEROTER_ET_RECALER' | 'NUMEROTER' | 'AUCUNE';

export interface RepriseRule {
  id: string;
  householdId: string;
  frequency: RecurrenceFrequency;
  anchorDate: Date;
  anchorDay: number | null;
  active: boolean;
  seriesVersion: number;
  label: string | null;
  expectedAmount: Prisma.Decimal | number;
  categoryId: string | null;
  sourceAccountId: string | null;
  sourceSubaccountId: string | null;
  destinationAccountId: string | null;
  destinationSubaccountId: string | null;
  responsibleMemberId: string | null;
  includeInTodo: boolean;
}

export interface RepriseRow {
  id: string;
  recurrenceRuleId: string | null;
  occurrenceIndex: number | null;
  seriesVersion: number | null;
  status: 'PENDING' | 'REALIZED' | 'CANCELLED';
  expectedDate: Date;
  expectedAmount: Prisma.Decimal | number;
  label: string;
  categoryId: string | null;
  sourceAccountId: string | null;
  sourceSubaccountId: string | null;
  destinationAccountId: string | null;
  destinationSubaccountId: string | null;
  responsibleMemberId: string | null;
  includeInTodo: boolean;
  manuallyEdited: boolean;
  updatedAt: Date;
}

/** Ligne détachée (recurrenceRuleId NULL) — candidate « nouvelle ligne » d'un ancien déplacement. */
export interface DetachedRow {
  id: string;
  label: string;
  createdAt: Date;
}

export interface RepriseRowPlan {
  id: string;
  status: RepriseRow['status'];
  category: RepriseCategory;
  action: RepriseAction;
  currentDate: string;
  occurrenceIndex: number | null;
  /** Date que donnerait la nouvelle règle pour ce n° (null si hors série). */
  theoreticalDate: string | null;
  /** Vrai si la date actuelle diffère de la date théorique. */
  dateDiffers: boolean;
  /** Date après reprise (identique à currentDate sauf recalage). */
  dateAfter: string;
  detachedRowId?: string;
}

export interface RepriseRulePlan {
  ruleId: string;
  householdId: string;
  frequency: RecurrenceFrequency;
  anchorDate: string;
  anchorDay: number;
  anchorDayFrom29To31: boolean;
  active: boolean;
  seriesVersion: number;
  rows: RepriseRowPlan[];
  counts: Record<RepriseCategory, number>;
  conflicts: string[];
}

const iso = (date: Date) => date.toISOString().slice(0, 10);
const num = (v: Prisma.Decimal | number) => Number(v.toString());

/** Fenêtre (ms) entre l'annulation de la ligne d'origine et la création de la ligne détachée d'un ancien déplacement. */
const MOVE_MATCH_WINDOW_MS = 5000;

/** Une ligne diffère-t-elle du gabarit actuel de sa règle (modification « cette échéance uniquement ») ? */
function differsFromTemplate(row: RepriseRow, rule: RepriseRule): boolean {
  return (
    num(row.expectedAmount) !== num(rule.expectedAmount) ||
    row.label !== (rule.label ?? 'Récurrence') ||
    row.categoryId !== rule.categoryId ||
    row.sourceAccountId !== rule.sourceAccountId ||
    row.sourceSubaccountId !== rule.sourceSubaccountId ||
    row.destinationAccountId !== rule.destinationAccountId ||
    row.destinationSubaccountId !== rule.destinationSubaccountId ||
    row.responsibleMemberId !== rule.responsibleMemberId ||
    row.includeInTodo !== rule.includeInTodo
  );
}

function emptyCounts(): Record<RepriseCategory, number> {
  return { INTACTE_FUTURE: 0, INTACTE_PASSEE: 0, REALISEE: 0, PARTIELLEMENT_PAYEE: 0, MODIFIEE: 0, ANNULEE: 0, ORIGINE_DEPLACEMENT: 0, DEJA_NUMEROTEE: 0, HORS_SERIE: 0 };
}

/**
 * Plan de reprise d'UNE règle (fonction pure, sans accès base). `paidIds` :
 * occurrences ayant au moins une opération réelle liée. `detached` : lignes
 * sans règle du même foyer (anciens déplacements).
 */
export function planRuleReprise(rule: RepriseRule, rows: RepriseRow[], paidIds: Set<string>, detached: DetachedRow[], today: Date): RepriseRulePlan {
  const anchorDay = rule.anchorDay ?? rule.anchorDate.getUTCDate();
  const spec = { anchorDate: rule.anchorDate, anchorDay, frequency: rule.frequency };
  const until = rows.reduce((max, r) => (r.expectedDate > max ? r.expectedDate : max), rule.anchorDate);
  const legacyIndex = new Map<string, number>();
  if (rule.seriesVersion === 0) legacyOccurrenceDates(rule.anchorDate, rule.frequency, until).forEach((date, k) => legacyIndex.set(iso(date), k));
  const todayIso = iso(today);
  const usedDetached = new Set<string>();

  const plans: RepriseRowPlan[] = rows
    .slice()
    .sort((a, b) => a.expectedDate.getTime() - b.expectedDate.getTime())
    .map((row) => {
      const currentDate = iso(row.expectedDate);
      const base = { id: row.id, status: row.status, currentDate };
      if (row.occurrenceIndex !== null) {
        const theoretical = row.seriesVersion === rule.seriesVersion ? iso(occurrenceDate(spec, row.occurrenceIndex)) : null;
        return { ...base, category: 'DEJA_NUMEROTEE', action: 'AUCUNE', occurrenceIndex: row.occurrenceIndex, theoreticalDate: theoretical, dateDiffers: theoretical !== null && theoretical !== currentDate, dateAfter: currentDate };
      }
      const k = legacyIndex.get(currentDate);
      if (k === undefined) {
        return { ...base, category: 'HORS_SERIE', action: 'AUCUNE', occurrenceIndex: null, theoreticalDate: null, dateDiffers: false, dateAfter: currentDate };
      }
      const theoretical = iso(occurrenceDate(spec, k));
      const common = { ...base, occurrenceIndex: k, theoreticalDate: theoretical, dateDiffers: theoretical !== currentDate };

      if (row.status === 'REALIZED') return { ...common, category: 'REALISEE', action: 'NUMEROTER', dateAfter: currentDate };
      if (row.status === 'CANCELLED') {
        const detachedMatch = detached.find(
          (d) => !usedDetached.has(d.id) && d.label === row.label && Math.abs(d.createdAt.getTime() - row.updatedAt.getTime()) <= MOVE_MATCH_WINDOW_MS,
        );
        if (detachedMatch) {
          usedDetached.add(detachedMatch.id);
          return { ...common, category: 'ORIGINE_DEPLACEMENT', action: 'NUMEROTER', dateAfter: currentDate, detachedRowId: detachedMatch.id };
        }
        return { ...common, category: 'ANNULEE', action: 'NUMEROTER', dateAfter: currentDate };
      }
      if (paidIds.has(row.id)) return { ...common, category: 'PARTIELLEMENT_PAYEE', action: 'NUMEROTER', dateAfter: currentDate };
      if (row.manuallyEdited || differsFromTemplate(row, rule)) return { ...common, category: 'MODIFIEE', action: 'NUMEROTER', dateAfter: currentDate };
      if (currentDate < todayIso) return { ...common, category: 'INTACTE_PASSEE', action: 'NUMEROTER', dateAfter: currentDate };
      return {
        ...common,
        category: 'INTACTE_FUTURE',
        action: common.dateDiffers ? 'NUMEROTER_ET_RECALER' : 'NUMEROTER',
        dateAfter: theoretical,
      };
    });

  // Contrôles de cohérence : un n° logique n'est attribué qu'une fois.
  const conflicts: string[] = [];
  const byIndex = new Map<number, string[]>();
  for (const p of plans) {
    const sameVersion = p.category !== 'DEJA_NUMEROTEE' || rows.find((r) => r.id === p.id)?.seriesVersion === rule.seriesVersion;
    if (p.occurrenceIndex === null || !sameVersion) continue;
    byIndex.set(p.occurrenceIndex, [...(byIndex.get(p.occurrenceIndex) ?? []), p.id]);
  }
  for (const [k, ids] of byIndex) if (ids.length > 1) conflicts.push(`n°${k} attribué à plusieurs lignes : ${ids.join(', ')}`);

  const counts = emptyCounts();
  for (const p of plans) counts[p.category] += 1;

  return {
    ruleId: rule.id,
    householdId: rule.householdId,
    frequency: rule.frequency,
    anchorDate: iso(rule.anchorDate),
    anchorDay,
    anchorDayFrom29To31: anchorDay >= 29,
    active: rule.active,
    seriesVersion: rule.seriesVersion,
    rows: plans as RepriseRowPlan[],
    counts,
    conflicts,
  };
}

export interface RepriseReport {
  mode: 'SIMULATION';
  generatedAt: string;
  today: string;
  totals: {
    rules: number;
    activeRules: number;
    rulesAnchoredOn29To31: number;
    occurrences: number;
    occurrencesOfRules29To31: number;
    byCategory: Record<RepriseCategory, number>;
    toRecale: number;
    datesDiffering: number;
    conflicts: number;
  };
  rules: RepriseRulePlan[];
}

/**
 * Exécute la SIMULATION sur les foyers donnés, dans une transaction READ
 * ONLY (toute écriture échouerait). Le contexte RLS est positionné foyer par
 * foyer, exactement comme une requête applicative.
 */
export async function simulateRecurrenceReprise(prisma: PrismaClient, householdIds: string[], today: Date = new Date()): Promise<RepriseReport> {
  const plans: RepriseRulePlan[] = [];
  let rulesTotal = 0;
  let activeRules = 0;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    for (const householdId of householdIds) {
      await tx.$executeRaw`SELECT set_config('app.current_household_id', ${householdId}, true)`;
      const rules = await tx.recurrenceRule.findMany({ where: { householdId } });
      rulesTotal += rules.length;
      activeRules += rules.filter((r) => r.active).length;
      if (rules.length === 0) continue;
      const rows = await tx.plannedOperation.findMany({ where: { householdId, recurrenceRuleId: { in: rules.map((r) => r.id) } } });
      const payments = await tx.financialOperation.findMany({
        where: { householdId, plannedOperationId: { in: rows.map((r) => r.id) } },
        select: { plannedOperationId: true },
      });
      const paidIds = new Set(payments.map((p) => p.plannedOperationId!));
      const detached = await tx.plannedOperation.findMany({ where: { householdId, recurrenceRuleId: null }, select: { id: true, label: true, createdAt: true } });
      for (const rule of rules) {
        plans.push(planRuleReprise(rule, rows.filter((r) => r.recurrenceRuleId === rule.id), paidIds, detached, today));
      }
    }
  });

  const byCategory = emptyCounts();
  for (const plan of plans) for (const [c, n] of Object.entries(plan.counts)) byCategory[c as RepriseCategory] += n;
  const allRows = plans.flatMap((p) => p.rows);
  return {
    mode: 'SIMULATION',
    generatedAt: new Date().toISOString(),
    today: iso(today),
    totals: {
      rules: rulesTotal,
      activeRules,
      rulesAnchoredOn29To31: plans.filter((p) => p.anchorDayFrom29To31).length,
      occurrences: allRows.length,
      occurrencesOfRules29To31: plans.filter((p) => p.anchorDayFrom29To31).reduce((n, p) => n + p.rows.length, 0),
      byCategory,
      toRecale: allRows.filter((r) => r.action === 'NUMEROTER_ET_RECALER').length,
      datesDiffering: allRows.filter((r) => r.dateDiffers).length,
      conflicts: plans.reduce((n, p) => n + p.conflicts.length, 0),
    },
    rules: plans,
  };
}
