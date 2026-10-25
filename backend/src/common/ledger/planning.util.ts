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
  /** Lot "À faire" — RESPONSABLE ≠ SOURCE, jamais déduit de sourceAccountId/sourceSubaccountId ci-dessus, aucun effet sur le ledger. */
  responsibleMemberId: string | null;
  /** Lot "À faire" — contrôle UNIQUEMENT la présence dans la checklist "À faire" (TodoService), jamais l'affichage Planning ni les calculs financiers ci-dessus. */
  includeInTodo: boolean;
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
  /** Lot "À faire" — RESPONSABLE ≠ SOURCE, jamais déduit des champs source/destination ci-dessus. */
  responsibleMemberId?: string | null;
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
  /** Lot "À faire" — RESPONSABLE ≠ SOURCE, jamais déduit des champs source/destination ci-dessus. */
  responsibleMemberId: string | null;
  /**
   * Lot "refonte Planning/À faire" — date prévue de CETTE occurrence, portée
   * directement ici pour que le mobile n'ait plus besoin de retrouver une
   * cellule/case (cell.items[0].date) juste pour connaître la date d'une
   * échéance : un seul objet occurrence, utilisable à l'identique depuis
   * Planning (case) ET À faire (ligne), pour le composant d'action unique
   * (choix "cette échéance / et les suivantes" compris).
   */
  expectedDate: string;
  /**
   * Lot "refonte Planning/À faire" — id de l'opération réelle qui a clôturé
   * CETTE échéance (non-null uniquement si status=REALIZED), pour que
   * l'ActionSheet unique puisse toujours proposer "Voir la transaction"
   * sans avoir besoin d'une case/cell à part.
   */
  realizedOperationId: string | null;
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

/**
 * Lot "Planning allégé" (correction recette) — remplace l'ancienne synthèse
 * (depensesPrevues/Payees/Reste, epargnePrevue/Versee/Reste,
 * depensesCouvertes/AProvisionner, balanceMensuelle/Cumulee), devenue
 * incohérente avec TOTAL DÉPENSES/VERSEMENTS affichés dans le même tableau :
 * l'ancienne "prévu" (depensesPrevues/epargnePrevue) sommait
 * expectedAmount/effectiveAmount SANS filtrer budgetImpact, alors que
 * totalDepenses/totalEpargne (budgetAmount) excluent ALREADY_FUNDED/EXCLUDED
 * (anti double-compte enveloppe) — divergence pouvant atteindre plusieurs
 * dizaines de milliers de DH dès qu'une partie des dépenses du mois est
 * financée depuis une enveloppe déjà alimentée.
 *
 * Nouvelle règle, UNE SEULE SOURCE DE VÉRITÉ : "REVENUS"/"DÉPENSES"/
 * "VERSEMENTS" de la synthèse SONT totalRevenus/totalDepenses/totalEpargne
 * (le même agrégat que TOTAL REVENUS/DÉPENSES/VERSEMENTS du tableau, aucun
 * second calcul) ; resultatPrevu/projectionCumulee en dérivent par simple
 * soustraction/cumul (ex-balanceMensuelle/balanceCumulee, renommés — "RÉSULTAT
 * PRÉVU", plus jamais "balance"). "Reste à exécuter" (mois COURANT
 * uniquement) est une information OPÉRATIONNELLE distincte, dérivée elle
 * aussi d'une seule quantité déjà fiable par échéance : `remaining` (=
 * expectedAmount - déjà payé), exactement celle utilisée par "À faire" —
 * jamais prévu+payé additionnés.
 */
export interface PlanningMonthSynthese {
  totalRevenus: number;
  totalDepenses: number;
  totalEpargne: number;
  /** = totalRevenus - totalDepenses - totalEpargne (ex-balanceMensuelle). */
  resultatPrevu: number;
  /** Cumul de resultatPrevu depuis le premier mois de l'horizon jusqu'à ce mois inclus (ex-balanceCumulee). */
  projectionCumulee: number;
  /**
   * "Reste à exécuter" (mois COURANT uniquement — premier mois de la table —
   * `null` pour tout autre mois) : somme des RESTES (jamais des prévus) des
   * dépenses/versements encore PENDING ce mois, exactement les mêmes
   * quantités `remaining` que "À faire" lit via PlanningOccurrenceRecord.
   */
  resteDepenses: number | null;
  resteVersements: number | null;
  /**
   * Couverture (mois courant uniquement, sinon null) — reprend la règle déjà
   * validée (lot "couverture des dépenses restantes"), désormais étendue aux
   * versements restants (toute échéance restante, dépense ou versement,
   * compare son reste au disponible de SA source : non-affecté du compte ou
   * solde de l'enveloppe, jamais sommés entre sources différentes, jamais un
   * surplus compensant le déficit d'une autre source).
   */
  couverte: boolean | null;
  /** = max(0, (resteDepenses+resteVersements) - couvert) — mois courant uniquement, sinon null. Jamais le détail technique du calcul n'est exposé au-delà de ce montant. */
  aProvisionner: number | null;
}

/**
 * Lot "À faire" — UN enregistrement par échéance PENDING/REALIZED réellement
 * traitée (jamais CANCELLED-sans-paiement), indépendant du regroupement par
 * case/catégorie ci-dessus. Essentiel : une case Planning peut regrouper
 * PLUSIEURS échéances (cell.singleOccurrence devient alors null, ambiguïté
 * d'affichage) — "À faire" ne doit JAMAIS perdre une action pour cette
 * raison, donc il ne lit jamais cell.singleOccurrence, il lit CETTE liste
 * plate, construite UNE fois, dans la même passe que le calcul prévu/payé/
 * reste (pushPlannedOccurrence) — jamais un second calcul.
 */
export interface PlanningOccurrenceRecord {
  plannedOperationId: string;
  kind: 'EXPENSE' | 'INCOME' | 'SAVINGS_CONTRIBUTION';
  status: 'PENDING' | 'REALIZED';
  label: string;
  expectedAmount: number;
  /** "Déjà payé" cumulé — même convention que PlanningSingleOccurrence.realizedAmount (null tant que rien n'est payé). */
  realizedAmount: number | null;
  expectedDate: string;
  month: PlanningMonthKey;
  sourceAccountId: string | null;
  sourceSubaccountId: string | null;
  destinationAccountId: string | null;
  destinationSubaccountId: string | null;
  recurrenceRuleId: string | null;
  categoryId: string | null;
  responsibleMemberId: string | null;
  includeInTodo: boolean;
}

export interface PlanningTable {
  months: PlanningMonthKey[];
  revenus: PlanningRow[];
  depenses: PlanningRow[];
  epargne: PlanningRow[];
  synthese: Record<PlanningMonthKey, PlanningMonthSynthese>;
  occurrences: PlanningOccurrenceRecord[];
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
/** Clé "aucune source exploitable" (lot couverture §4) — toujours comptée disponible=0, jamais une source supposée. */
const NO_SOURCE_KEY = '__NO_SOURCE__';

function sourceKeyOf(sourceAccountId: string | null, sourceSubaccountId: string | null): string {
  if (!sourceAccountId) return NO_SOURCE_KEY;
  return `${sourceAccountId}::${sourceSubaccountId ?? 'direct'}`;
}

/** Disponible RÉEL de cette source — jamais une source différente, jamais un total patrimoine (lot "couverture des dépenses restantes"). */
function disponibleForSource(sourceKey: string, accountNonAffecte: Map<string, number>, subaccountBalances: Map<string, number>): number {
  if (sourceKey === NO_SOURCE_KEY) return 0;
  const sepIndex = sourceKey.indexOf('::');
  const accountId = sourceKey.slice(0, sepIndex);
  const sub = sourceKey.slice(sepIndex + 2);
  if (sub !== 'direct') return Math.max(0, subaccountBalances.get(sub) ?? 0);
  return Math.max(0, accountNonAffecte.get(accountId) ?? 0);
}

export function buildPlanningTable(params: {
  months: PlanningMonthKey[];
  plannedOperations: PlanningPlannedOperationRow[];
  financialOperations: PlanningFinancialOperationRow[];
  categories: PlanningCategoryRow[];
  accountNames: Map<string, string>;
  subaccountNames: Map<string, string>;
  /**
   * Lot "couverture des dépenses restantes" — soldes RÉELS actuels (non-
   * affecté par compte, solde par enveloppe/sous-compte), utilisés
   * UNIQUEMENT pour calculer la couverture du mois COURANT (premier mois de
   * `months`). Jamais une projection : cf. le commentaire de
   * PlanningMonthSynthese.couverte/aProvisionner pour la limite assumée sur
   * les mois futurs.
   */
  accountNonAffecte: Map<string, number>;
  subaccountBalances: Map<string, number>;
  /** Jour de début du mois financier (§ Paramètres > début du mois) — 1 par défaut (mois calendaire, inchangé). */
  monthStartDay?: number;
}): PlanningTable {
  const { months, plannedOperations, financialOperations, categories, accountNames, subaccountNames, accountNonAffecte, subaccountBalances, monthStartDay = 1 } = params;
  const monthSet = new Set(months);
  // Le mois courant est TOUJOURS months[0] (monthRange() part de `now`, cf.
  // planning.service.ts) — jamais recalculé ici à partir de la date système,
  // pour rester cohérent avec exactement la fenêtre demandée par l'appelant.
  const currentMonth = months[0];

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

  // Lot "Planning allégé" — "reste à exécuter" du mois COURANT uniquement,
  // groupé par SOURCE PRÉVUE de l'échéance (jamais par échéance individuelle
  // ni sommé entre sources différentes) : une carte par nature (dépense vs
  // versement) pour l'affichage séparé "Dépenses X / Versements Y", et leur
  // fusion ci-dessous pour la couverture combinée (§11 : une échéance
  // restante, dépense ou versement, compare son reste au disponible de SA
  // propre source).
  const resteDepensesParSourceMoisCourant = new Map<string, number>();
  const resteVersementsParSourceMoisCourant = new Map<string, number>();

  // Lot "À faire" — une entrée par échéance PENDING/REALIZED traitée,
  // indépendante du regroupement par case (cf. PlanningOccurrenceRecord).
  const occurrenceRecords: PlanningOccurrenceRecord[] = [];

  /**
   * Pousse dans `cell` tous les items d'UNE échéance (paiements déjà
   * enregistrés + éventuel reste à payer) et enregistre son occurrence
   * candidate pour le registre singleOccurrence — partagé entre les 3
   * natures (EXPENSE/INCOME/SAVINGS_CONTRIBUTION), qui ne diffèrent que par
   * la ligne dans laquelle la case se trouve. Retourne le montant déjà payé
   * (somme nette affichée, §correction) ET le reste encore à payer (0 si
   * REALIZED/CANCELLED) pour que l'appelant alimente les accumulateurs
   * Part 2 A/D et, pour le mois courant, la couverture par source.
   */
  function pushPlannedOccurrence(cell: PlanningCell, planned: PlanningPlannedOperationRow, realizations: PlanningFinancialOperationRow[]): { paidDisplay: number; remaining: number } {
    const plannedAccounts = {
      sourceAccountId: planned.sourceAccountId,
      sourceSubaccountId: planned.sourceSubaccountId,
      destinationAccountId: planned.destinationAccountId,
      destinationSubaccountId: planned.destinationSubaccountId,
    };
    const meta = { recurrenceRuleId: planned.recurrenceRuleId, categoryId: planned.categoryId, kind: planned.kind, responsibleMemberId: planned.responsibleMemberId };
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

    const remaining = planned.status === 'PENDING' ? expected - paidDisplay : 0;
    if (planned.status === 'PENDING') {
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
        expectedDate: planned.expectedDate.toISOString(),
        realizedOperationId: null,
        ...plannedAccounts,
        ...meta,
      });
    } else if (planned.status === 'REALIZED') {
      markCellOccurrence(singleOccurrenceRegistry, cell, {
        plannedOperationId: planned.id,
        status: 'REALIZED',
        expectedAmount: expected,
        realizedAmount: paidDisplay,
        expectedDate: planned.expectedDate.toISOString(),
        realizedOperationId: planned.realizedOperationId,
        ...plannedAccounts,
        ...meta,
      });
    }
    // CANCELLED : seuls les items RÉALISÉS ci-dessus (s'il y en a) sont affichés — jamais de singleOccurrence (rien à ajuster sur une échéance annulée).

    return { paidDisplay, remaining };
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

    const { paidDisplay, remaining } = pushPlannedOccurrence(row.cells[mKey], planned, realizations);

    // Lot "À faire" — CANCELLED exclu (rien à exécuter ni à montrer comme
    // "effectué" dans cette vue) ; jamais issu de cell.singleOccurrence, qui
    // devient null dès que plusieurs échéances partagent la même case.
    if (planned.status === 'PENDING' || planned.status === 'REALIZED') {
      occurrenceRecords.push({
        plannedOperationId: planned.id,
        kind: planned.kind,
        status: planned.status,
        label: planned.label,
        expectedAmount: toNumber(planned.expectedAmount),
        // Même convention que PlanningSingleOccurrence.realizedAmount ci-dessus (markCellOccurrence) : null tant que rien n'est payé, sinon le cumulé.
        realizedAmount: planned.status === 'REALIZED' ? paidDisplay : paidDisplay > 0 ? paidDisplay : null,
        expectedDate: planned.expectedDate.toISOString(),
        month: mKey,
        sourceAccountId: planned.sourceAccountId,
        sourceSubaccountId: planned.sourceSubaccountId,
        destinationAccountId: planned.destinationAccountId,
        destinationSubaccountId: planned.destinationSubaccountId,
        recurrenceRuleId: planned.recurrenceRuleId,
        categoryId: planned.categoryId,
        responsibleMemberId: planned.responsibleMemberId,
        includeInTodo: planned.includeInTodo,
      });
    }

    // "Reste à exécuter" (mois COURANT uniquement) — UNIQUEMENT `remaining`
    // (expectedAmount - déjà payé, 0 pour REALIZED/CANCELLED par construction
    // de pushPlannedOccurrence ci-dessus), groupé par la source PRÉVUE de
    // l'échéance — jamais une échéance individuelle, jamais une source
    // supposée, jamais le prévu additionné au payé.
    if (mKey === currentMonth && remaining > 0) {
      const sourceKey = sourceKeyOf(planned.sourceAccountId, planned.sourceSubaccountId);
      const map = planned.kind === 'EXPENSE' ? resteDepensesParSourceMoisCourant : planned.kind === 'SAVINGS_CONTRIBUTION' ? resteVersementsParSourceMoisCourant : null;
      if (map) map.set(sourceKey, (map.get(sourceKey) ?? 0) + remaining);
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
    } else if (op.kind === 'EXPENSE') {
      const categoryId = op.categoryId ?? fallback?.id;
      if (!categoryId) continue;
      const categoryLabel = categoryId === fallback?.id ? CHARGES_PONCTUELLES_LABEL : categoryById.get(categoryId)?.name;
      const row = ensureRow(depenseRows, labelRowKey(categoryId, op.label), op.label, categoryId, categoryLabel);
      cell = row.cells[mKey];
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

  // Couverture combinée (mois courant uniquement, §11) : dépenses ET
  // versements restants sont fusionnés PAR SOURCE avant comparaison au
  // disponible — jamais un pool unique entre sources différentes, jamais un
  // surplus sur une source compensant le déficit d'une autre.
  const sumMapValues = (map: Map<string, number>) => {
    let total = 0;
    for (const v of map.values()) total += v;
    return total;
  };
  const resteDepensesMoisCourant = sumMapValues(resteDepensesParSourceMoisCourant);
  const resteVersementsMoisCourant = sumMapValues(resteVersementsParSourceMoisCourant);
  const resteCombineParSource = new Map<string, number>();
  for (const [k, v] of resteDepensesParSourceMoisCourant) resteCombineParSource.set(k, (resteCombineParSource.get(k) ?? 0) + v);
  for (const [k, v] of resteVersementsParSourceMoisCourant) resteCombineParSource.set(k, (resteCombineParSource.get(k) ?? 0) + v);
  let couvertMoisCourant = 0;
  for (const [sourceKey, reste] of resteCombineParSource) {
    const disponible = disponibleForSource(sourceKey, accountNonAffecte, subaccountBalances);
    couvertMoisCourant += Math.min(disponible, reste);
  }
  // Jamais > reste total par construction (min(disponible, reste) <= reste pour chaque source) ; Math.max défensif uniquement.
  const aProvisionnerMoisCourant = Math.max(0, resteDepensesMoisCourant + resteVersementsMoisCourant - couvertMoisCourant);

  const synthese: Record<PlanningMonthKey, PlanningMonthSynthese> = {};
  let cumulative = 0;
  for (const m of months) {
    const totalRevenus = sumRowsBudget(revenueRows, m);
    const totalDepenses = sumRowsBudget(depenseRows, m);
    const totalEpargne = sumRowsBudget(epargneRows, m);
    // Règle comptable (correction ciblée) : un versement/épargne n'est JAMAIS
    // une dépense (il n'entre donc jamais dans totalDepenses), mais il réduit
    // bien la trésorerie disponible du mois — le RÉSULTAT PRÉVU doit donc le
    // soustraire : Résultat prévu = Revenus - Dépenses - Versements/Épargne.
    // Dérivé des MÊMES totaux affichés juste au-dessus (TOTAL REVENUS/
    // DÉPENSES/VERSEMENTS) — aucun second calcul, aucune divergence possible.
    const resultatPrevu = totalRevenus - totalDepenses - totalEpargne;
    cumulative += resultatPrevu;
    const isCurrentMonth = m === currentMonth;
    synthese[m] = {
      totalRevenus,
      totalDepenses,
      totalEpargne,
      resultatPrevu,
      projectionCumulee: cumulative,
      resteDepenses: isCurrentMonth ? resteDepensesMoisCourant : null,
      resteVersements: isCurrentMonth ? resteVersementsMoisCourant : null,
      couverte: isCurrentMonth ? aProvisionnerMoisCourant <= 0 : null,
      aProvisionner: isCurrentMonth ? aProvisionnerMoisCourant : null,
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
    occurrences: occurrenceRecords,
  };
}

function sumRowsBudget(rows: Map<string, PlanningRow>, month: PlanningMonthKey): number {
  let total = 0;
  for (const row of rows.values()) total += row.cells[month]?.budgetAmount ?? 0;
  return total;
}
