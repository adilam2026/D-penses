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
  /** Lot "modifier une échéance récurrente" — non-null uniquement si cette occurrence provient d'une récurrence, pour que le mobile sache proposer le choix "cette échéance uniquement / et les suivantes". */
  recurrenceRuleId: string | null;
  financialPlanItemId: string | null;
  financialPlanDeadlineId: string | null;
  sourceAccountId: string | null;
  sourceSubaccountId: string | null;
  destinationAccountId: string | null;
  destinationSubaccountId: string | null;
  /** Uniquement conservé pour exclure, ci-dessous, l'opération de clôture des plans financiers (financial-plan.util.ts gère leur propre affichage) — jamais utilisé pour calculer "déjà payé"/"reste" (cf. PlanningFinancialOperationRow.plannedOperationId, qui couvre TOUS les paiements, partiels compris). */
  realizedOperationId: string | null;
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
  /** "Afficher dans le Planning" (lot dépense ponctuelle) — false retire cette opération de l'agrégation Planning (jamais du ledger/des soldes/de l'historique de compte). */
  includeInPlanning: boolean;
  /** Lot "paiements partiels successifs" — non-null quand cette opération réelle règle (en tout ou partie) une échéance prévue : posé sur CHAQUE paiement (partiel ou final), jamais limité au seul paiement de clôture. */
  plannedOperationId: string | null;
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
  /** Uniquement renseignés pour PLANNED_PENDING/PLANNED_REALIZED (jamais REAL_UNPLANNED) — cf. singleOccurrence. */
  recurrenceRuleId?: string | null;
  categoryId?: string | null;
  kind?: 'EXPENSE' | 'INCOME' | 'SAVINGS_CONTRIBUTION';
  /**
   * Lot "paiements partiels successifs" — uniquement sur un item
   * PLANNED_PENDING : le montant PRÉVU d'origine de l'échéance (constant),
   * alors que `amount` ci-dessus porte le RESTE à payer (prévu - déjà payé).
   * Permet au mobile de reconstruire "déjà payé" (= expectedAmount - amount)
   * pour une case ambiguë (plusieurs échéances dans la même case), sans
   * dépendre de singleOccurrence qui n'y est alors jamais renseigné.
   */
  expectedAmount?: number;
}

export type PlanningSingleOccurrence = {
  plannedOperationId: string;
  status: 'PENDING' | 'REALIZED';
  expectedAmount: number;
  /**
   * "Déjà payé" cumulé (paiements partiels + éventuel paiement final),
   * jamais la seule dernière opération. `null` tant qu'aucun paiement n'a
   * encore été enregistré (comportement historique inchangé) ; positif et
   * strictement inférieur à expectedAmount pour une échéance PENDING
   * partiellement payée — le "reste à payer" se calcule alors côté appelant
   * comme expectedAmount - realizedAmount, jamais stocké séparément.
   */
  realizedAmount: number | null;
  sourceAccountId: string | null;
  sourceSubaccountId: string | null;
  destinationAccountId: string | null;
  destinationSubaccountId: string | null;
  /** Lot "modifier une échéance récurrente" — permet au mobile de proposer "cette échéance uniquement / et les suivantes" uniquement quand pertinent. */
  recurrenceRuleId: string | null;
  categoryId: string | null;
  kind: 'EXPENSE' | 'INCOME' | 'SAVINGS_CONTRIBUTION';
};

export interface PlanningCell {
  displayAmount: number;
  budgetAmount: number;
  /** Sous-total des items À VENIR (PLANNED_PENDING) uniquement — affichage MIXED, jamais sommé dans budgetAmount à part (déjà inclus via displayAmount/budgetAmount ci-dessus). */
  pendingAmount: number;
  /** Sous-total des items RÉALISÉS (PLANNED_REALIZED + REAL_UNPLANNED) uniquement — affichage MIXED. */
  realizedAmount: number;
  status: 'EMPTY' | 'PENDING' | 'REALIZED' | 'MIXED';
  /** Non-null seulement quand TOUS les items de la case appartiennent à UNE
   * seule et même échéance (qu'elle ait reçu 0, 1 ou plusieurs paiements
   * partiels — cf. le registre dans buildPlanningTable) — jamais quand la
   * case mélange plusieurs échéances ou une opération réellement non
   * planifiée. C'est la cible du tap simple / appui long : une échéance
   * partiellement payée reste donc TOUJOURS interactive au même titre
   * qu'une échéance non payée (jamais de blocage après un 1er paiement
   * partiel, §correction "paiements partiels successifs"). */
  singleOccurrence: PlanningSingleOccurrence | null;
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
  /**
   * Lot "synthèse enrichie" — répond à "où en suis-je / puis-je couvrir le
   * reste ?", un axe DIFFÉRENT de totalDepenses/balance ci-dessus (qui
   * répondent à "projection budgétaire", cf. budgetContribution : excluent
   * ALREADY_FUNDED pour éviter le double-compte enveloppe). Ici, en
   * revanche, on utilise la valeur AFFICHÉE (effectiveAmount, jamais
   * filtrée par budgetImpact) : "déjà payé" doit refléter CE QUI A
   * RÉELLEMENT QUITTÉ LE COMPTE, quelle que soit la source utilisée — sinon
   * un paiement financé par une enveloppe semblerait ne jamais avoir été
   * payé. depensesPrevues - depensesPayees = depensesReste TOUJOURS (jamais
   * prévu+payé additionnés — §anti-double-compte, ex. 800 payé 300 ->
   * prévu 800, payé 300, reste 500, jamais 1100).
   */
  depensesPrevues: number;
  depensesPayees: number;
  depensesReste: number;
  /** Même principe que ci-dessus, mais pour les versements/épargne — jamais mélangé avec les dépenses (un versement vers une enveloppe n'est jamais une dépense). */
  epargnePrevue: number;
  epargneVersee: number;
  epargneReste: number;
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
}

/**
 * Registre "une case = une seule échéance ?" (lot "paiements partiels
 * successifs") — remplace l'ancienne règle `items.length === 1`, trop
 * fragile : une échéance partiellement payée pousse PLUSIEURS items dans sa
 * case (le reste + chaque paiement déjà enregistré), sans pour autant cesser
 * d'être une occurrence UNIQUE et donc toujours interactive (tap/appui long).
 * `markCellOccurrence` est appelé pour CHAQUE item qu'une échéance pousse
 * dans une case ; `markCellConflict` pour toute opération réellement non
 * planifiée qui atterrit dans la même case. Dès que plus d'une échéance (ou
 * une échéance + du non-planifié) touche la même case, le résultat devient
 * 'CONFLICT' et singleOccurrence reste définitivement null pour cette case
 * — comportement identique à avant pour les cases réellement ambiguës.
 */
type SingleOccurrenceRegistry = Map<PlanningCell, PlanningSingleOccurrence | 'CONFLICT'>;

function markCellOccurrence(registry: SingleOccurrenceRegistry, cell: PlanningCell, candidate: PlanningSingleOccurrence) {
  const existing = registry.get(cell);
  if (existing === undefined) {
    registry.set(cell, candidate);
  } else if (existing !== 'CONFLICT' && existing.plannedOperationId !== candidate.plannedOperationId) {
    registry.set(cell, 'CONFLICT');
  }
}

function markCellConflict(registry: SingleOccurrenceRegistry, cell: PlanningCell) {
  registry.set(cell, 'CONFLICT');
}

function applySingleOccurrenceRegistry(registry: SingleOccurrenceRegistry) {
  for (const [cell, candidate] of registry) {
    if (candidate !== 'CONFLICT') cell.singleOccurrence = candidate;
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

  // Opération(s) de clôture des échéances liées à un PLAN FINANCIER
  // (financial-plans.service.ts#markDeadlinePaid) — ce chemin ne pose jamais
  // planned_operation_id (cf. ledger.util.ts), donc le seul moyen de les
  // exclure d'ici (elles s'affichent via financial-plan.util.ts, jamais
  // doublées dans les lignes catégorie/épargne classiques) reste l'ancien
  // lien unique realizedOperationId.
  const planFinancialRealizedIds = new Set(
    plannedOperations.filter((p) => p.financialPlanItemId || p.financialPlanDeadlineId).map((p) => p.realizedOperationId).filter((x): x is string => !!x),
  );

  // Une paire opération/son renversement (§annulation d'un paiement) net à zéro et
  // ne doit JAMAIS s'afficher comme "réel non prévu" résiduel — qu'elle ait été
  // liée à une occurrence (déjà remise à PENDING) ou totalement libre.
  const reversedOriginalIds = new Set(financialOperations.map((op) => op.reversalOfOperationId).filter((x): x is string => !!x));

  // Lot "paiements partiels successifs" : regroupe TOUTES les opérations
  // réelles (paiements partiels + éventuel paiement final + leurs éventuels
  // renversements) par échéance d'origine — jamais limité à la seule
  // opération de clôture (realizedOperationId/realizedOperation, qui reste
  // réservé à la toute dernière opération qui a clos l'échéance).
  const realizationsByPlannedId = new Map<string, PlanningFinancialOperationRow[]>();
  for (const op of financialOperations) {
    if (!op.plannedOperationId) continue;
    const list = realizationsByPlannedId.get(op.plannedOperationId);
    if (list) list.push(op);
    else realizationsByPlannedId.set(op.plannedOperationId, [op]);
  }

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

  const singleOccurrenceRegistry: SingleOccurrenceRegistry = new Map();

  // Lot "synthèse enrichie" (Part 2 A/D) — accumulateurs mensuels DISTINCTS de
  // budgetAmount/totalDepenses (qui filtrent ALREADY_FUNDED pour l'anti
  // double-compte "projection budgétaire") : ici on veut la valeur AFFICHÉE
  // (ce qui a réellement quitté le compte, quelle que soit la source), pour
  // que Prévu - Payé = Reste tienne TOUJOURS, échéance par échéance.
  const depensesPrevuesByMonth = new Map<PlanningMonthKey, number>(months.map((m) => [m, 0]));
  const depensesPayeesByMonth = new Map<PlanningMonthKey, number>(months.map((m) => [m, 0]));
  const epargnePrevueByMonth = new Map<PlanningMonthKey, number>(months.map((m) => [m, 0]));
  const epargneVerseeByMonth = new Map<PlanningMonthKey, number>(months.map((m) => [m, 0]));
  const addToMonth = (map: Map<PlanningMonthKey, number>, m: PlanningMonthKey, delta: number) => map.set(m, (map.get(m) ?? 0) + delta);

  /**
   * Pousse dans `cell` tous les items d'UNE échéance (paiements déjà
   * enregistrés + éventuel reste à payer) et enregistre son occurrence
   * candidate pour le registre singleOccurrence — partagé entre les 3
   * natures (EXPENSE/INCOME/SAVINGS_CONTRIBUTION), qui ne diffèrent que par
   * la ligne dans laquelle la case se trouve. Retourne le montant déjà payé
   * (somme nette affichée, §correction) pour que l'appelant alimente, le cas
   * échéant, les accumulateurs Part 2 A/D.
   */
  function pushPlannedOccurrence(cell: PlanningCell, planned: PlanningPlannedOperationRow, realizations: PlanningFinancialOperationRow[]): number {
    const plannedAccounts = {
      sourceAccountId: planned.sourceAccountId,
      sourceSubaccountId: planned.sourceSubaccountId,
      destinationAccountId: planned.destinationAccountId,
      destinationSubaccountId: planned.destinationSubaccountId,
    };
    const meta = { recurrenceRuleId: planned.recurrenceRuleId, categoryId: planned.categoryId, kind: planned.kind };
    const expected = toNumber(planned.expectedAmount);
    const isCancelled = planned.status === 'CANCELLED';

    let paidDisplay = 0;
    for (const real of realizations) paidDisplay += toNumber(effectiveAmount(real));

    for (const real of realizations) {
      if (real.reversalOfOperationId) continue; // la contre-écriture elle-même : jamais affichée comme item
      if (reversedOriginalIds.has(real.id)) continue; // opération d'origine désormais renversée -> net zéro, jamais résiduelle
      const amount = toNumber(effectiveAmount(real));
      pushItem(
        cell,
        {
          type: 'PLANNED_REALIZED',
          // Échéance annulée : jamais de lien actionnable ("Annuler le
          // paiement" n'a plus de sens sur une échéance qui n'est plus
          // RÉALISÉE) — seule la consultation ("Voir") reste proposée.
          plannedOperationId: isCancelled ? undefined : planned.id,
          financialOperationId: real.id,
          label: planned.label,
          amount,
          date: real.date.toISOString(),
          sourceAccountId: real.sourceAccountId,
          sourceSubaccountId: real.sourceSubaccountId,
          destinationAccountId: real.destinationAccountId,
          destinationSubaccountId: real.destinationSubaccountId,
          ...meta,
        },
        amount,
        budgetContribution(real),
      );
    }

    if (planned.status === 'PENDING') {
      const remaining = expected - paidDisplay;
      if (remaining > 0) {
        pushItem(
          cell,
          { type: 'PLANNED_PENDING', plannedOperationId: planned.id, label: planned.label, amount: remaining, expectedAmount: expected, date: planned.expectedDate.toISOString(), ...plannedAccounts, ...meta },
          remaining,
          remaining,
        );
      }
      markCellOccurrence(singleOccurrenceRegistry, cell, {
        plannedOperationId: planned.id,
        status: 'PENDING',
        expectedAmount: expected,
        realizedAmount: paidDisplay > 0 ? paidDisplay : null,
        ...plannedAccounts,
        ...meta,
      });
    } else if (planned.status === 'REALIZED') {
      markCellOccurrence(singleOccurrenceRegistry, cell, {
        plannedOperationId: planned.id,
        status: 'REALIZED',
        expectedAmount: expected,
        realizedAmount: paidDisplay,
        ...plannedAccounts,
        ...meta,
      });
    }
    // CANCELLED : seuls les items RÉALISÉS ci-dessus (s'il y en a) sont affichés — jamais de singleOccurrence (rien à ajuster sur une échéance annulée).

    return paidDisplay;
  }

  for (const planned of plannedOperations) {
    if (planned.financialPlanItemId || planned.financialPlanDeadlineId) continue; // affiché via le plan, jamais ici

    const realizations = realizationsByPlannedId.get(planned.id) ?? [];
    // Annulée SANS paiement antérieur : rien à montrer. Annulée AVEC des
    // paiements déjà enregistrés : ces paiements restent de VRAIES dépenses
    // (argent réellement sorti) et doivent rester visibles dans le Planning
    // — jamais escamotés simplement parce que le reste a été annulé.
    if (planned.status === 'CANCELLED' && realizations.length === 0) continue;

    const mKey = monthKey(planned.expectedDate, monthStartDay);
    if (!monthSet.has(mKey)) continue;

    let row: PlanningRow;
    if (planned.kind === 'INCOME') {
      const incomeCategoryId = planned.categoryId ?? undefined;
      const incomeCategory = incomeCategoryId ? categoryById.get(incomeCategoryId) : undefined;
      row = ensureRow(revenueRows, labelRowKey(incomeCategoryId, planned.label), planned.label, incomeCategoryId, incomeCategory?.name);
    } else if (planned.kind === 'SAVINGS_CONTRIBUTION') {
      const key = planned.destinationSubaccountId ?? planned.destinationAccountId ?? planned.label;
      const label = planned.destinationSubaccountId
        ? (subaccountNames.get(planned.destinationSubaccountId) ?? planned.label)
        : planned.destinationAccountId
          ? (accountNames.get(planned.destinationAccountId) ?? planned.label)
          : planned.label;
      const savingsCategoryId = planned.categoryId ?? undefined;
      const savingsCategory = savingsCategoryId ? categoryById.get(savingsCategoryId) : undefined;
      row = ensureRow(epargneRows, key, label, savingsCategoryId, savingsCategory?.name);
    } else {
      // EXPENSE : une ligne par libellé (Lot ciblé §5) — la catégorie ne fait plus
      // qu'un titre de regroupement affiché côté mobile, jamais une ligne fondant
      // plusieurs libellés en un seul montant. Une dépense (ponctuelle, le cas
      // courant) sans catégorie choisie retombe sur "Autres" en base, mais est
      // affichée sous le titre littéral "Charges ponctuelles" (§5 correction) —
      // jamais "Autres", qui resterait trompeur pour l'utilisateur.
      const categoryId = planned.categoryId ?? fallback?.id;
      if (!categoryId) continue;
      const categoryLabel = categoryId === fallback?.id ? CHARGES_PONCTUELLES_LABEL : categoryById.get(categoryId)?.name;
      row = ensureRow(depenseRows, labelRowKey(categoryId, planned.label), planned.label, categoryId, categoryLabel);
    }

    const paidDisplay = pushPlannedOccurrence(row.cells[mKey], planned, realizations);

    if (planned.kind === 'EXPENSE') {
      const prevuContribution = planned.status === 'CANCELLED' ? paidDisplay : toNumber(planned.expectedAmount);
      addToMonth(depensesPrevuesByMonth, mKey, prevuContribution);
      addToMonth(depensesPayeesByMonth, mKey, paidDisplay);
    } else if (planned.kind === 'SAVINGS_CONTRIBUTION') {
      const prevuContribution = planned.status === 'CANCELLED' ? paidDisplay : toNumber(planned.expectedAmount);
      addToMonth(epargnePrevueByMonth, mKey, prevuContribution);
      addToMonth(epargneVerseeByMonth, mKey, paidDisplay);
    }
  }

  // Opérations réelles NON liées à une occurrence prévue ("Autres" obligatoire,
  // ex. Aspirateur 2500 DH) — jamais rattachées à un plan financier non plus.
  for (const op of financialOperations) {
    if (op.plannedOperationId) continue; // traitée ci-dessus via l'échéance liée, jamais ici (y compris ses paiements partiels)
    if (planFinancialRealizedIds.has(op.id)) continue; // clôture d'un plan financier -> affichée via financial-plan.util.ts
    if (op.reversalOfOperationId) continue; // l'opération de renversement elle-même
    if (reversedOriginalIds.has(op.id)) continue; // l'opération d'origine, désormais renversée -> net zéro, jamais résiduelle
    // "Afficher dans le Planning" décoché (lot dépense ponctuelle) — exclue
    // UNIQUEMENT de cette agrégation (cellules + totaux) ; le ledger, les
    // soldes et l'historique de compte ne passent jamais par ce chemin.
    if (!op.includeInPlanning) continue;

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

    let cell: PlanningCell;
    if (op.kind === 'INCOME') {
      const incomeCategoryId = op.categoryId ?? undefined;
      const incomeCategory = incomeCategoryId ? categoryById.get(incomeCategoryId) : undefined;
      const row = ensureRow(revenueRows, labelRowKey(incomeCategoryId, op.label), op.label, incomeCategoryId, incomeCategory?.name);
      cell = row.cells[mKey];
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
      cell = row.cells[mKey];
      addToMonth(epargnePrevueByMonth, mKey, amount);
      addToMonth(epargneVerseeByMonth, mKey, amount);
    } else if (op.kind === 'EXPENSE') {
      const categoryId = op.categoryId ?? fallback?.id;
      if (!categoryId) continue;
      const categoryLabel = categoryId === fallback?.id ? CHARGES_PONCTUELLES_LABEL : categoryById.get(categoryId)?.name;
      const row = ensureRow(depenseRows, labelRowKey(categoryId, op.label), op.label, categoryId, categoryLabel);
      cell = row.cells[mKey];
      addToMonth(depensesPrevuesByMonth, mKey, amount);
      addToMonth(depensesPayeesByMonth, mKey, amount);
    } else {
      continue;
    }

    pushItem(cell, { type: 'REAL_UNPLANNED', financialOperationId: op.id, label: op.label, amount, date: op.date.toISOString(), ...opAccounts }, amount, budget);
    markCellConflict(singleOccurrenceRegistry, cell); // une opération réellement non planifiée rend la case ambiguë, jamais une occurrence unique
  }

  for (const row of [...revenueRows.values(), ...depenseRows.values(), ...epargneRows.values()]) {
    for (const m of months) finalizeCellStatus(row.cells[m]);
  }
  applySingleOccurrenceRegistry(singleOccurrenceRegistry);

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
    const depensesPrevues = depensesPrevuesByMonth.get(m) ?? 0;
    const depensesPayees = depensesPayeesByMonth.get(m) ?? 0;
    const epargnePrevue = epargnePrevueByMonth.get(m) ?? 0;
    const epargneVersee = epargneVerseeByMonth.get(m) ?? 0;
    synthese[m] = {
      totalRevenus,
      totalDepenses,
      totalEpargne,
      balanceMensuelle,
      balanceCumulee: cumulative,
      depensesPrevues,
      depensesPayees,
      depensesReste: depensesPrevues - depensesPayees,
      epargnePrevue,
      epargneVersee,
      epargneReste: epargnePrevue - epargneVersee,
    };
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
