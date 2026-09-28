import { Prisma } from '@prisma/client';
import { effectiveAmount } from './ledger.util';

export type PlanningMonthKey = string; // 'YYYY-MM'

export interface PlanningPlannedOperationRow {
  id: string;
  kind: 'EXPENSE' | 'INCOME' | 'SAVINGS_CONTRIBUTION';
  status: 'PENDING' | 'REALIZED' | 'CANCELLED';
  label: string;
  expectedAmount: Prisma.Decimal;
  expectedDate: Date;
  categoryId: string | null;
  financialPlanItemId: string | null;
  financialPlanDeadlineId: string | null;
  sourceAccountId: string | null;
  sourceSubaccountId: string | null;
  destinationAccountId: string | null;
  destinationSubaccountId: string | null;
  realizedOperationId: string | null;
  realizedOperation: { id: string; amount: Prisma.Decimal; budgetImpact: 'NORMAL' | 'ALREADY_FUNDED' | 'EXCLUDED'; date: Date; reversalOfOperationId: string | null } | null;
}

export interface PlanningFinancialOperationRow {
  id: string;
  kind: string;
  label: string;
  amount: Prisma.Decimal;
  date: Date;
  categoryId: string | null;
  sourceAccountId: string | null;
  sourceSubaccountId: string | null;
  destinationAccountId: string | null;
  destinationSubaccountId: string | null;
  budgetImpact: 'NORMAL' | 'ALREADY_FUNDED' | 'EXCLUDED';
  reversalOfOperationId: string | null;
}

export interface PlanningCategoryRow {
  id: string;
  name: string;
  isDefaultFallback: boolean;
}

export interface PlanningCellItem {
  type: 'PLANNED_PENDING' | 'PLANNED_REALIZED' | 'REAL_UNPLANNED';
  plannedOperationId?: string;
  financialOperationId?: string;
  label: string;
  amount: number;
  date: string;
  sourceAccountId: string | null;
  sourceSubaccountId: string | null;
  destinationAccountId: string | null;
  destinationSubaccountId: string | null;
}

export interface PlanningCell {
  displayAmount: number;
  budgetAmount: number;
  /** Sous-total des items À VENIR (PLANNED_PENDING) uniquement — affichage MIXED, jamais sommé dans budgetAmount à part (déjà inclus via displayAmount/budgetAmount ci-dessus). */
  pendingAmount: number;
  /** Sous-total des items RÉALISÉS (PLANNED_REALIZED + REAL_UNPLANNED) uniquement — affichage MIXED. */
  realizedAmount: number;
  status: 'EMPTY' | 'PENDING' | 'REALIZED' | 'MIXED';
  /** Non-null seulement quand la case correspond à EXACTEMENT une occurrence prévue,
   * sans aucun autre élément agrégé — c'est la cible du tap simple / appui long. */
  singleOccurrence:
    | {
        plannedOperationId: string;
        status: 'PENDING' | 'REALIZED';
        expectedAmount: number;
        realizedAmount: number | null;
        sourceAccountId: string | null;
        sourceSubaccountId: string | null;
        destinationAccountId: string | null;
        destinationSubaccountId: string | null;
      }
    | null;
  items: PlanningCellItem[];
}

export interface PlanningRow {
  key: string;
  label: string;
  categoryId?: string;
  cells: Record<PlanningMonthKey, PlanningCell>;
}

export interface PlanningMonthSynthese {
  totalRevenus: number;
  totalDepenses: number;
  totalEpargne: number;
  balanceMensuelle: number;
  balanceCumulee: number;
}

export interface PlanningTable {
  months: PlanningMonthKey[];
  revenus: PlanningRow[];
  depenses: PlanningRow[];
  epargne: PlanningRow[];
  synthese: Record<PlanningMonthKey, PlanningMonthSynthese>;
}

function monthKey(date: Date): PlanningMonthKey {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthRange(start: Date, count: number): PlanningMonthKey[] {
  const keys: PlanningMonthKey[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  for (let i = 0; i < count; i++) {
    keys.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

function emptyCell(): PlanningCell {
  return { displayAmount: 0, budgetAmount: 0, pendingAmount: 0, realizedAmount: 0, status: 'EMPTY', singleOccurrence: null, items: [] };
}

function toNumber(d: Prisma.Decimal | number): number {
  return typeof d === 'number' ? d : d.toNumber();
}

/** Contribution "budget" d'une opération réelle : NORMAL compte, ALREADY_FUNDED/EXCLUDED jamais (anti double-compte). */
function budgetContribution(op: { amount: Prisma.Decimal; budgetImpact: 'NORMAL' | 'ALREADY_FUNDED' | 'EXCLUDED'; reversalOfOperationId: string | null }): number {
  if (op.budgetImpact !== 'NORMAL') return 0;
  return toNumber(effectiveAmount(op));
}

function pushItem(cell: PlanningCell, item: PlanningCellItem, displayDelta: number, budgetDelta: number) {
  cell.items.push(item);
  cell.displayAmount += displayDelta;
  cell.budgetAmount += budgetDelta;
}

function finalizeCellStatus(cell: PlanningCell) {
  if (cell.items.length === 0) {
    cell.status = 'EMPTY';
    return;
  }
  const hasPending = cell.items.some((i) => i.type === 'PLANNED_PENDING');
  const hasRealized = cell.items.some((i) => i.type !== 'PLANNED_PENDING');
  cell.status = hasPending && hasRealized ? 'MIXED' : hasPending ? 'PENDING' : 'REALIZED';

  cell.pendingAmount = cell.items.filter((i) => i.type === 'PLANNED_PENDING').reduce((sum, i) => sum + i.amount, 0);
  cell.realizedAmount = cell.items.filter((i) => i.type !== 'PLANNED_PENDING').reduce((sum, i) => sum + i.amount, 0);

  if (cell.items.length === 1) {
    const only = cell.items[0];
    const accounts = {
      sourceAccountId: only.sourceAccountId,
      sourceSubaccountId: only.sourceSubaccountId,
      destinationAccountId: only.destinationAccountId,
      destinationSubaccountId: only.destinationSubaccountId,
    };
    if (only.type === 'PLANNED_PENDING' && only.plannedOperationId) {
      cell.singleOccurrence = { plannedOperationId: only.plannedOperationId, status: 'PENDING', expectedAmount: only.amount, realizedAmount: null, ...accounts };
    } else if (only.type === 'PLANNED_REALIZED' && only.plannedOperationId) {
      cell.singleOccurrence = { plannedOperationId: only.plannedOperationId, status: 'REALIZED', expectedAmount: only.amount, realizedAmount: only.amount, ...accounts };
    }
  }
}

/**
 * Construit la table Planning multi-mois (Checkpoint 3) — 3 blocs de lignes
 * (revenus groupés par libellé, dépenses groupées STRICTEMENT par catégorie,
 * épargne groupée par sous-compte/compte destinataire) + synthèse mensuelle.
 *
 * Règle prévu/réel (V3.1) : PENDING -> expected_amount ; REALIZED -> montant
 * réel lié ; réel non prévu -> montant réel. Jamais sommés ensemble pour une
 * même occurrence. DISPLAY (ce qui est vu) inclut tout (y compris
 * ALREADY_FUNDED) ; BUDGET (Totaux/Balance) exclut ALREADY_FUNDED/EXCLUDED.
 *
 * Les occurrences liées à un plan financier (financialPlanItemId /
 * financialPlanDeadlineId) sont exclues des lignes catégorie/épargne
 * classiques — elles sont affichées uniquement via leur propre ligne de plan
 * (cf. financial-plans.util.ts), jamais doublées ici.
 */
export function buildPlanningTable(params: {
  months: PlanningMonthKey[];
  plannedOperations: PlanningPlannedOperationRow[];
  financialOperations: PlanningFinancialOperationRow[];
  categories: PlanningCategoryRow[];
  accountNames: Map<string, string>;
  subaccountNames: Map<string, string>;
}): PlanningTable {
  const { months, plannedOperations, financialOperations, categories, accountNames, subaccountNames } = params;
  const monthSet = new Set(months);

  const linkedRealOperationIds = new Set(plannedOperations.map((p) => p.realizedOperationId).filter((x): x is string => !!x));

  // Une paire opération/son renversement (§annulation d'un paiement) net à zéro et
  // ne doit JAMAIS s'afficher comme "réel non prévu" résiduel — qu'elle ait été
  // liée à une occurrence (déjà remise à PENDING) ou totalement libre.
  const reversedOriginalIds = new Set(financialOperations.map((op) => op.reversalOfOperationId).filter((x): x is string => !!x));

  const revenueRows = new Map<string, PlanningRow>();
  const depenseRows = new Map<string, PlanningRow>();
  const epargneRows = new Map<string, PlanningRow>();

  const ensureRow = (map: Map<string, PlanningRow>, key: string, label: string, categoryId?: string): PlanningRow => {
    let row = map.get(key);
    if (!row) {
      row = { key, label, categoryId, cells: {} };
      for (const m of months) row.cells[m] = emptyCell();
      map.set(key, row);
    }
    return row;
  };

  // "Autres" toujours visible même vide (jamais les autres catégories vides).
  const fallback = categories.find((c) => c.isDefaultFallback);
  if (fallback) ensureRow(depenseRows, fallback.id, fallback.name, fallback.id);

  const categoryById = new Map(categories.map((c) => [c.id, c]));

  for (const planned of plannedOperations) {
    if (planned.status === 'CANCELLED') continue;
    if (planned.financialPlanItemId || planned.financialPlanDeadlineId) continue; // affiché via le plan, jamais ici

    const mKey = monthKey(planned.expectedDate);
    if (!monthSet.has(mKey)) continue;

    const plannedAccounts = {
      sourceAccountId: planned.sourceAccountId,
      sourceSubaccountId: planned.sourceSubaccountId,
      destinationAccountId: planned.destinationAccountId,
      destinationSubaccountId: planned.destinationSubaccountId,
    };

    if (planned.kind === 'INCOME') {
      const row = ensureRow(revenueRows, planned.label, planned.label);
      const cell = row.cells[mKey];
      if (planned.status === 'PENDING') {
        pushItem(cell, { type: 'PLANNED_PENDING', plannedOperationId: planned.id, label: planned.label, amount: toNumber(planned.expectedAmount), date: planned.expectedDate.toISOString(), ...plannedAccounts }, toNumber(planned.expectedAmount), toNumber(planned.expectedAmount));
      } else if (planned.status === 'REALIZED' && planned.realizedOperation) {
        const real = planned.realizedOperation;
        const amount = toNumber(effectiveAmount(real));
        pushItem(cell, { type: 'PLANNED_REALIZED', plannedOperationId: planned.id, financialOperationId: real.id, label: planned.label, amount, date: real.date.toISOString(), ...plannedAccounts }, amount, budgetContribution(real));
      }
      continue;
    }

    if (planned.kind === 'SAVINGS_CONTRIBUTION') {
      const key = planned.destinationSubaccountId ?? planned.destinationAccountId ?? planned.label;
      const label = planned.destinationSubaccountId
        ? (subaccountNames.get(planned.destinationSubaccountId) ?? planned.label)
        : planned.destinationAccountId
          ? (accountNames.get(planned.destinationAccountId) ?? planned.label)
          : planned.label;
      const row = ensureRow(epargneRows, key, label);
      const cell = row.cells[mKey];
      if (planned.status === 'PENDING') {
        pushItem(cell, { type: 'PLANNED_PENDING', plannedOperationId: planned.id, label: planned.label, amount: toNumber(planned.expectedAmount), date: planned.expectedDate.toISOString(), ...plannedAccounts }, toNumber(planned.expectedAmount), toNumber(planned.expectedAmount));
      } else if (planned.status === 'REALIZED' && planned.realizedOperation) {
        const real = planned.realizedOperation;
        const amount = toNumber(effectiveAmount(real));
        pushItem(cell, { type: 'PLANNED_REALIZED', plannedOperationId: planned.id, financialOperationId: real.id, label: planned.label, amount, date: real.date.toISOString(), ...plannedAccounts }, amount, budgetContribution(real));
      }
      continue;
    }

    // EXPENSE : groupé STRICTEMENT par catégorie (jamais une ligne par transaction).
    const categoryId = planned.categoryId ?? fallback?.id;
    if (!categoryId) continue;
    const category = categoryById.get(categoryId);
    const row = ensureRow(depenseRows, categoryId, category?.name ?? 'Autres', categoryId);
    const cell = row.cells[mKey];
    if (planned.status === 'PENDING') {
      pushItem(cell, { type: 'PLANNED_PENDING', plannedOperationId: planned.id, label: planned.label, amount: toNumber(planned.expectedAmount), date: planned.expectedDate.toISOString(), ...plannedAccounts }, toNumber(planned.expectedAmount), toNumber(planned.expectedAmount));
    } else if (planned.status === 'REALIZED' && planned.realizedOperation) {
      const real = planned.realizedOperation;
      const amount = toNumber(effectiveAmount(real));
      pushItem(cell, { type: 'PLANNED_REALIZED', plannedOperationId: planned.id, financialOperationId: real.id, label: planned.label, amount, date: real.date.toISOString(), ...plannedAccounts }, amount, budgetContribution(real));
    }
  }

  // Opérations réelles NON liées à une occurrence prévue ("Autres" obligatoire,
  // ex. Aspirateur 2500 DH) — jamais rattachées à un plan financier non plus.
  for (const op of financialOperations) {
    if (linkedRealOperationIds.has(op.id)) continue;
    if (op.reversalOfOperationId) continue; // l'opération de renversement elle-même
    if (reversedOriginalIds.has(op.id)) continue; // l'opération d'origine, désormais renversée -> net zéro, jamais résiduelle

    const mKey = monthKey(op.date);
    if (!monthSet.has(mKey)) continue;

    const amount = toNumber(effectiveAmount(op));
    const budget = budgetContribution(op);
    const opAccounts = {
      sourceAccountId: op.sourceAccountId,
      sourceSubaccountId: op.sourceSubaccountId,
      destinationAccountId: op.destinationAccountId,
      destinationSubaccountId: op.destinationSubaccountId,
    };

    if (op.kind === 'INCOME') {
      const row = ensureRow(revenueRows, op.label, op.label);
      pushItem(row.cells[mKey], { type: 'REAL_UNPLANNED', financialOperationId: op.id, label: op.label, amount, date: op.date.toISOString(), ...opAccounts }, amount, budget);
    } else if (op.kind === 'SAVINGS_CONTRIBUTION') {
      const key = op.destinationSubaccountId ?? op.destinationAccountId ?? op.label;
      const label = op.destinationSubaccountId
        ? (subaccountNames.get(op.destinationSubaccountId) ?? op.label)
        : op.destinationAccountId
          ? (accountNames.get(op.destinationAccountId) ?? op.label)
          : op.label;
      const row = ensureRow(epargneRows, key, label);
      pushItem(row.cells[mKey], { type: 'REAL_UNPLANNED', financialOperationId: op.id, label: op.label, amount, date: op.date.toISOString(), ...opAccounts }, amount, budget);
    } else if (op.kind === 'EXPENSE') {
      const categoryId = op.categoryId ?? fallback?.id;
      if (!categoryId) continue;
      const category = categoryById.get(categoryId);
      const row = ensureRow(depenseRows, categoryId, category?.name ?? 'Autres', categoryId);
      pushItem(row.cells[mKey], { type: 'REAL_UNPLANNED', financialOperationId: op.id, label: op.label, amount, date: op.date.toISOString(), ...opAccounts }, amount, budget);
    }
  }

  for (const row of [...revenueRows.values(), ...depenseRows.values(), ...epargneRows.values()]) {
    for (const m of months) finalizeCellStatus(row.cells[m]);
  }

  const synthese: Record<PlanningMonthKey, PlanningMonthSynthese> = {};
  let cumulative = 0;
  for (const m of months) {
    const totalRevenus = sumRowsBudget(revenueRows, m);
    const totalDepenses = sumRowsBudget(depenseRows, m);
    const totalEpargne = sumRowsBudget(epargneRows, m);
    const balanceMensuelle = totalRevenus - totalDepenses - totalEpargne;
    cumulative += balanceMensuelle;
    synthese[m] = { totalRevenus, totalDepenses, totalEpargne, balanceMensuelle, balanceCumulee: cumulative };
  }

  const sortRows = (map: Map<string, PlanningRow>) => Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));

  return {
    months,
    revenus: sortRows(revenueRows),
    depenses: sortRows(depenseRows),
    epargne: sortRows(epargneRows),
    synthese,
  };
}

function sumRowsBudget(rows: Map<string, PlanningRow>, month: PlanningMonthKey): number {
  let total = 0;
  for (const row of rows.values()) total += row.cells[month]?.budgetAmount ?? 0;
  return total;
}
