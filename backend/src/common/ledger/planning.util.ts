import { Prisma } from '@prisma/client';
import { effectiveAmount } from './ledger.util';

export type PlanningMonthKey = string; // 'YYYY-MM'

/** Titre affiché pour une dépense sans catégorie choisie — jamais le nom technique "Autres" (§5 correction). */
export const CHARGES_PONCTUELLES_LABEL = 'Charges ponctuelles';

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
  /** Nom de la catégorie — PUR TITRE DE REGROUPEMENT visuel côté mobile (Lot ciblé §5), jamais une ligne financière : le montant reste toujours porté par la ligne (libellé), jamais par la catégorie. Absent quand l'opération n'a aucune catégorie. */
  categoryLabel?: string;
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

/**
 * Mois financier paramétrable (§ Début du mois) — jour 1 par défaut : se
 * comporte alors EXACTEMENT comme le mois calendaire (aucune régression).
 * Jour > 1 (ex. 28) : le mois financier "octobre" ne commence pas le 1er
 * octobre mais le 28 septembre (jour `startDay` du mois précédent) et finit
 * le 27 octobre (jour `startDay - 1` du mois lui-même) — ex. explicite de la
 * spec : début=28 -> octobre = 28/09 → 27/10, novembre = 28/10 → 27/11.
 *
 * Le libellé affiché suit le mois qui contient la MAJORITÉ des jours de la
 * période (jour <= 15 -> la période reste nommée par le mois où elle
 * commence ; jour > 15 -> elle est nommée par le mois où elle se termine,
 * qui en contient alors la plus grande part) — règle qui se réduit
 * naturellement au mois calendaire quand `startDay` vaut 1.
 */
function labelMonthOffset(startDay: number): 0 | 1 {
  return startDay <= 15 ? 0 : 1;
}

function monthKey(date: Date, startDay = 1): PlanningMonthKey {
  const day = date.getUTCDate();
  let refMonth = date.getUTCMonth();
  let refYear = date.getUTCFullYear();
  if (day < startDay) {
    refMonth -= 1;
    if (refMonth < 0) {
      refMonth = 11;
      refYear -= 1;
    }
  }
  let labelMonth = refMonth + labelMonthOffset(startDay);
  let labelYear = refYear;
  if (labelMonth > 11) {
    labelMonth -= 12;
    labelYear += 1;
  }
  return `${labelYear}-${String(labelMonth + 1).padStart(2, '0')}`;
}

/** Bornes réelles [début, fin] (inclusives) de la période financière désignée par `key`, pour construire la fenêtre de requête DB — jamais déduites naïvement du 1er/dernier jour calendaire quand `startDay` ≠ 1. */
export function monthBounds(key: PlanningMonthKey, startDay = 1): { start: Date; end: Date } {
  const [yearStr, monthStr] = key.split('-');
  const labelYear = Number(yearStr);
  const labelMonth = Number(monthStr) - 1;
  let refMonth = labelMonth - labelMonthOffset(startDay);
  let refYear = labelYear;
  if (refMonth < 0) {
    refMonth = 11;
    refYear -= 1;
  }
  const start = new Date(Date.UTC(refYear, refMonth, startDay));
  const end = new Date(Date.UTC(refYear, refMonth + 1, startDay - 1));
  return { start, end };
}

export function monthRange(start: Date, count: number, startDay = 1): PlanningMonthKey[] {
  const keys: PlanningMonthKey[] = [];
  const firstKey = monthKey(start, startDay);
  let [year, month] = firstKey.split('-').map(Number);
  month -= 1; // 0-indexed pour l'arithmétique
  for (let i = 0; i < count; i++) {
    keys.push(`${year}-${String(month + 1).padStart(2, '0')}`);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
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
  /** Jour de début du mois financier (§ Paramètres > début du mois) — 1 par défaut (mois calendaire, inchangé). */
  monthStartDay?: number;
}): PlanningTable {
  const { months, plannedOperations, financialOperations, categories, accountNames, subaccountNames, monthStartDay = 1 } = params;
  const monthSet = new Set(months);

  const linkedRealOperationIds = new Set(plannedOperations.map((p) => p.realizedOperationId).filter((x): x is string => !!x));

  // Une paire opération/son renversement (§annulation d'un paiement) net à zéro et
  // ne doit JAMAIS s'afficher comme "réel non prévu" résiduel — qu'elle ait été
  // liée à une occurrence (déjà remise à PENDING) ou totalement libre.
  const reversedOriginalIds = new Set(financialOperations.map((op) => op.reversalOfOperationId).filter((x): x is string => !!x));

  const revenueRows = new Map<string, PlanningRow>();
  const depenseRows = new Map<string, PlanningRow>();
  const epargneRows = new Map<string, PlanningRow>();

  const ensureRow = (map: Map<string, PlanningRow>, key: string, label: string, categoryId?: string, categoryLabel?: string): PlanningRow => {
    let row = map.get(key);
    if (!row) {
      row = { key, label, categoryId, categoryLabel, cells: {} };
      for (const m of months) row.cells[m] = emptyCell();
      map.set(key, row);
    }
    return row;
  };

  const fallback = categories.find((c) => c.isDefaultFallback);
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  /** Clé de ligne (Lot ciblé §5) : une ligne = UN libellé, jamais une catégorie agrégée — la catégorie ne sert plus qu'à regrouper visuellement plusieurs lignes sous un même titre côté mobile. */
  function labelRowKey(categoryId: string | undefined, label: string): string {
    return `${categoryId ?? '∅'}::${label}`;
  }

  for (const planned of plannedOperations) {
    if (planned.status === 'CANCELLED') continue;
    if (planned.financialPlanItemId || planned.financialPlanDeadlineId) continue; // affiché via le plan, jamais ici

    const mKey = monthKey(planned.expectedDate, monthStartDay);
    if (!monthSet.has(mKey)) continue;

    const plannedAccounts = {
      sourceAccountId: planned.sourceAccountId,
      sourceSubaccountId: planned.sourceSubaccountId,
      destinationAccountId: planned.destinationAccountId,
      destinationSubaccountId: planned.destinationSubaccountId,
    };

    if (planned.kind === 'INCOME') {
      const incomeCategoryId = planned.categoryId ?? undefined;
      const incomeCategory = incomeCategoryId ? categoryById.get(incomeCategoryId) : undefined;
      const row = ensureRow(revenueRows, labelRowKey(incomeCategoryId, planned.label), planned.label, incomeCategoryId, incomeCategory?.name);
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
      const savingsCategoryId = planned.categoryId ?? undefined;
      const savingsCategory = savingsCategoryId ? categoryById.get(savingsCategoryId) : undefined;
      const row = ensureRow(epargneRows, key, label, savingsCategoryId, savingsCategory?.name);
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

    // EXPENSE : une ligne par libellé (Lot ciblé §5) — la catégorie ne fait plus
    // qu'un titre de regroupement affiché côté mobile, jamais une ligne fondant
    // plusieurs libellés en un seul montant. Une dépense (ponctuelle, le cas
    // courant) sans catégorie choisie retombe sur "Autres" en base, mais est
    // affichée sous le titre littéral "Charges ponctuelles" (§5 correction) —
    // jamais "Autres", qui resterait trompeur pour l'utilisateur.
    const categoryId = planned.categoryId ?? fallback?.id;
    if (!categoryId) continue;
    const categoryLabel = categoryId === fallback?.id ? CHARGES_PONCTUELLES_LABEL : categoryById.get(categoryId)?.name;
    const row = ensureRow(depenseRows, labelRowKey(categoryId, planned.label), planned.label, categoryId, categoryLabel);
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

    const mKey = monthKey(op.date, monthStartDay);
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
      const incomeCategoryId = op.categoryId ?? undefined;
      const incomeCategory = incomeCategoryId ? categoryById.get(incomeCategoryId) : undefined;
      const row = ensureRow(revenueRows, labelRowKey(incomeCategoryId, op.label), op.label, incomeCategoryId, incomeCategory?.name);
      pushItem(row.cells[mKey], { type: 'REAL_UNPLANNED', financialOperationId: op.id, label: op.label, amount, date: op.date.toISOString(), ...opAccounts }, amount, budget);
    } else if (op.kind === 'SAVINGS_CONTRIBUTION') {
      const key = op.destinationSubaccountId ?? op.destinationAccountId ?? op.label;
      const label = op.destinationSubaccountId
        ? (subaccountNames.get(op.destinationSubaccountId) ?? op.label)
        : op.destinationAccountId
          ? (accountNames.get(op.destinationAccountId) ?? op.label)
          : op.label;
      const savingsCategoryId = op.categoryId ?? undefined;
      const savingsCategory = savingsCategoryId ? categoryById.get(savingsCategoryId) : undefined;
      const row = ensureRow(epargneRows, key, label, savingsCategoryId, savingsCategory?.name);
      pushItem(row.cells[mKey], { type: 'REAL_UNPLANNED', financialOperationId: op.id, label: op.label, amount, date: op.date.toISOString(), ...opAccounts }, amount, budget);
    } else if (op.kind === 'EXPENSE') {
      const categoryId = op.categoryId ?? fallback?.id;
      if (!categoryId) continue;
      const categoryLabel = categoryId === fallback?.id ? CHARGES_PONCTUELLES_LABEL : categoryById.get(categoryId)?.name;
      const row = ensureRow(depenseRows, labelRowKey(categoryId, op.label), op.label, categoryId, categoryLabel);
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
    // Règle comptable (correction ciblée) : un versement/épargne n'est JAMAIS
    // une dépense (il n'entre donc jamais dans totalDepenses), mais il réduit
    // bien la trésorerie disponible du mois — la BALANCE MENSUELLE doit donc
    // le soustraire : Balance mensuelle = Revenus - Dépenses - Versements/Épargne.
    const balanceMensuelle = totalRevenus - totalDepenses - totalEpargne;
    cumulative += balanceMensuelle;
    synthese[m] = { totalRevenus, totalDepenses, totalEpargne, balanceMensuelle, balanceCumulee: cumulative };
  }

  // Tri : lignes catégorisées groupées par catégorie (ordre alphabétique du titre),
  // puis les lignes sans catégorie en dernier — pour que le mobile puisse afficher
  // des groupes contigus sans re-trier (Lot ciblé §5).
  const sortRows = (map: Map<string, PlanningRow>) =>
    Array.from(map.values()).sort((a, b) => {
      if (!a.categoryLabel && !b.categoryLabel) return a.label.localeCompare(b.label);
      if (!a.categoryLabel) return 1;
      if (!b.categoryLabel) return -1;
      const catCompare = a.categoryLabel.localeCompare(b.categoryLabel);
      return catCompare !== 0 ? catCompare : a.label.localeCompare(b.label);
    });

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
