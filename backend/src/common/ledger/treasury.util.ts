import { Prisma } from '@prisma/client';
import { getAccountBalances, getDeadlineBalance, round2, toNumber } from './ledger.util';
// NB (§26 Lot 9) : getDeadlineBalance reste utilisé tel quel dans computeDeadlineCommitments/
// computeNextDeadline ci-dessous — hors du chemin chaud identifié (computeTreasurySummary,
// appelé jusqu'à 20 fois par requête de capacité d'épargne). Non touché dans ce lot pour
// contenir le risque de régression (cf. rapport final §11 sur la dette restante).
import {
  BudgetLike,
  ProjectionMode,
  addDaysUTC,
  budgetAmountForWindow,
  computeBudgetPeriodStatus,
  getCurrentPeriodWindow,
} from './variable-budget.util';
import { CoverageItem, computePocketCurrentAmount, computeProvisionCoverage } from './provision.util';

type TxClient = Prisma.TransactionClient;

/**
 * Moteur de trésorerie/disponible libre (docs/02-modele-metier.md G.2 à G.5, Lot 5,
 * corrigé sur retour utilisateur). Toutes les fonctions sont tx-scoped (jamais de
 * rlsContext.run() imbriqué) et acceptent une referenceDate injectable — jamais de
 * `new Date()` implicite dans le domaine (§22).
 */

// ---------- G.2/G.3 — Patrimoine liquide total / Trésorerie opérationnelle ----------

export interface TreasurySummary {
  patrimoineLiquideTotal: number;
  tresorerieOperationnelle: number;
}

export async function computeTreasurySummary(tx: TxClient, householdId: string): Promise<TreasurySummary> {
  const accounts = await tx.financialAccount.findMany({ where: { householdId, status: 'actif' } });
  // Lot 9 (§26) : un seul aller-retour SQL pour tous les comptes du foyer, au lieu d'un
  // par compte — cette fonction est appelée à chaque calcul de trésorerie/projection,
  // donc jusqu'à 20 fois pour une seule requête de capacité d'épargne (recherche binaire).
  const balances = await getAccountBalances(tx, accounts.map((a) => a.id));
  let patrimoineLiquideTotal = 0;
  let tresorerieOperationnelle = 0;
  for (const account of accounts) {
    const balance = balances.get(account.id) ?? 0;
    patrimoineLiquideTotal += balance;
    if (account.includeInOperationalTreasury) tresorerieOperationnelle += balance;
  }
  return { patrimoineLiquideTotal: round2(patrimoineLiquideTotal), tresorerieOperationnelle: round2(tresorerieOperationnelle) };
}

// ---------- G.3 — Montants réservés (Lot 6) ----------

export interface ReservedAmounts {
  total: number;
}

/**
 * G.3 : Σ current_amount(SavingsPocket) + Σ current_amount(Provision), UNIQUEMENT
 * pour allocation_mode = virtual_allocation (RG-070/071). Les poches/provisions
 * `backed_by_account` sont explicitement exclues — leur montant est déjà retiré de
 * la Trésorerie opérationnelle par l'exclusion de leur compte dédié (RG-072/IF-06) ;
 * les additionner ici doublonnerait le même dirham. Cette fonction ne lit donc
 * jamais de solde de compte pour une poche/provision backed_by_account.
 */
export async function computeReservedAmounts(tx: TxClient, householdId: string): Promise<ReservedAmounts> {
  let total = 0;

  const pockets = await tx.savingsPocket.findMany({ where: { householdId, allocationMode: 'virtual_allocation' } });
  for (const p of pockets) {
    total += await computePocketCurrentAmount(tx, 'savings_pocket', p.id, p.allocationMode, p.linkedAccountId);
  }

  const provisions = await tx.provision.findMany({ where: { householdId, allocationMode: 'virtual_allocation' } });
  for (const p of provisions) {
    total += await computePocketCurrentAmount(tx, 'provision', p.id, p.allocationMode, p.linkedAccountId);
  }

  return { total: round2(total) };
}

// ---------- G.5 — Horizon (H*) ----------

function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Fallback TECHNIQUE uniquement (aucune existence dans le modèle normatif) —
 * utilisé exclusivement quand aucune IncomeOccurrence prévue future n'existe,
 * pour permettre malgré tout l'affichage du Dashboard. Jamais présenté comme
 * la définition métier de H* (cf. corrections Lot 5 §4).
 */
export const DASHBOARD_FALLBACK_HORIZON_DAYS = 30;

export type HorizonSource = 'income' | 'fallback';

export interface HorizonResult {
  date: Date;
  source: HorizonSource;
  isFallback: boolean;
}

/**
 * H* (doc02 G.5) = date de la prochaine IncomeOccurrence « prévue » significative —
 * SEULE définition normative. Si aucune n'existe, un repli technique déterministe
 * (DASHBOARD_FALLBACK_HORIZON_DAYS) est utilisé pour ne pas bloquer l'affichage,
 * mais le résultat porte explicitement `source: 'fallback'`/`isFallback: true` —
 * jamais une fausse certitude silencieuse. Ne réutilise jamais seuil_à_venir
 * (HouseholdSettings), qui sert aux alertes temporelles, pas à définir H*.
 */
export async function computeHorizon(tx: TxClient, householdId: string, referenceDate: Date): Promise<HorizonResult> {
  const ref = toUtcMidnight(referenceDate);
  const nextIncome = await tx.incomeOccurrence.findFirst({
    where: { status: 'prevu', usualDate: { gt: ref }, incomeSource: { householdId } },
    orderBy: { usualDate: 'asc' },
  });
  if (nextIncome) return { date: nextIncome.usualDate, source: 'income', isFallback: false };

  return { date: new Date(ref.getTime() + DASHBOARD_FALLBACK_HORIZON_DAYS * 86400000), source: 'fallback', isFallback: true };
}

// ---------- G.4 — Montants engagés : part Deadline ----------

export interface CommittedItem {
  id: string;
  chargePlanId: string;
  chargePlanLabel: string;
  dueDate: Date;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  resteAPayer: number | null;
}

export interface DeadlineCommitments {
  knownAmount: number; // Σ engagement_non_couvert (= reste_a_payer, couverture_affectée=0 tant que Lot 6 n'existe pas)
  hasUnknown: boolean;
  unknownCount: number;
  hasEstimates: boolean;
  items: CommittedItem[];
  envisagedTotal: number; // jamais mélangé au total certain (§7, IF-25)
  envisagedHasUnknown: boolean;
}

/**
 * Part Deadline de G.4 — engagement_non_couvert (RG-090/RG-092, ex-reste_a_payer avant
 * Lot 6), JAMAIS known_plan_cost (un FinancialPlan n'est jamais lu ici, exclusion
 * structurelle du double comptage IF-28). Portée certaine = obligatoire ∪
 * optionnelle_souscrite (RG-106) ; optionnelle_envisagée calculée séparément (jamais
 * fusionnée, §7) ; optionnelle_refusée et les Deadline annulées/soldées sont exclues
 * (RG-107/RG-050). Une Deadline est engagée dès aujourd'hui si sa due_date tombe dans
 * l'horizon — jamais seulement le jour de son échéance (§5).
 *
 * Anti-double-comptage (RG-092/093, IF-16) : une Deadline liée à une Provision n'entre
 * ici que pour sa part NON couverte (engagement_non_couvert) — la part couverte est
 * déjà comptée dans Montants_réservés (virtual_allocation) ou déjà hors trésorerie
 * opérationnelle (backed_by_account, RG-072). La couverture est calculée sur la
 * TOTALITÉ des Deadline liées à chaque Provision (jamais restreinte à l'horizon,
 * cf. provision.util.ts) — un cache par provisionId évite de la recalculer par Deadline.
 */
export async function computeDeadlineCommitments(tx: TxClient, householdId: string, horizon: Date): Promise<DeadlineCommitments> {
  const certainPlans = await tx.chargePlan.findMany({
    where: { householdId, obligationStatus: { in: ['obligatoire', 'optionnelle_souscrite'] } },
    include: { deadlines: true },
  });

  let knownAmount = 0;
  let unknownCount = 0;
  let hasEstimates = false;
  const items: CommittedItem[] = [];
  const coverageCache = new Map<string, CoverageItem[]>();

  const engagementFor = async (deadlineId: string, provisionId: string | null, resteAPayer: number): Promise<number> => {
    if (!provisionId) return resteAPayer; // RG-091 : sans provision liée, engagement_non_couvert = reste_a_payer
    let coverage = coverageCache.get(provisionId);
    if (!coverage) {
      coverage = (await computeProvisionCoverage(tx, provisionId)).items;
      coverageCache.set(provisionId, coverage);
    }
    const item = coverage.find((i) => i.deadlineId === deadlineId);
    return item ? item.engagementNonCouvert : resteAPayer;
  };

  for (const cp of certainPlans) {
    for (const d of cp.deadlines) {
      if (d.financialStatus === 'annulee' || d.financialStatus === 'soldee') continue;
      if (d.dueDate > horizon) continue;

      if (d.amountStatus === 'inconnu') {
        unknownCount += 1;
        items.push({ id: d.id, chargePlanId: cp.id, chargePlanLabel: cp.label, dueDate: d.dueDate, amountStatus: 'inconnu', resteAPayer: null });
        continue; // jamais compté 0 (RG-103)
      }
      if (d.amountStatus === 'estime') hasEstimates = true;

      const balance = await getDeadlineBalance(tx, d.id);
      const resteAPayer = balance?.resteAPayer ?? 0;
      const engagement = await engagementFor(d.id, d.provisionId, resteAPayer);
      knownAmount += engagement;
      items.push({ id: d.id, chargePlanId: cp.id, chargePlanLabel: cp.label, dueDate: d.dueDate, amountStatus: d.amountStatus, resteAPayer });
    }
  }

  const envisagedPlans = await tx.chargePlan.findMany({
    where: { householdId, obligationStatus: 'optionnelle_envisagee' },
    include: { deadlines: true },
  });
  let envisagedTotal = 0;
  let envisagedHasUnknown = false;
  for (const cp of envisagedPlans) {
    for (const d of cp.deadlines) {
      if (d.financialStatus === 'annulee' || d.financialStatus === 'soldee') continue;
      if (d.dueDate > horizon) continue;
      if (d.amountStatus === 'inconnu') {
        envisagedHasUnknown = true;
        continue;
      }
      const balance = await getDeadlineBalance(tx, d.id);
      envisagedTotal += balance?.resteAPayer ?? 0;
    }
  }

  return {
    knownAmount: round2(knownAmount),
    hasUnknown: unknownCount > 0,
    unknownCount,
    hasEstimates,
    items,
    envisagedTotal: round2(envisagedTotal),
    envisagedHasUnknown,
  };
}

// ---------- G.4 — Montants engagés : part VariableBudget (réutilise le moteur Lot 3) ----------

function toBudgetLike(budget: {
  referenceAmount: unknown;
  referencePeriod: 'semaine' | 'mois';
  weekStartDay: number;
  startDate: Date;
  endDate: Date | null;
}): BudgetLike {
  return {
    referenceAmount: toNumber(budget.referenceAmount),
    referencePeriod: budget.referencePeriod,
    weekStartDay: budget.weekStartDay,
    startDate: budget.startDate,
    endDate: budget.endDate,
  };
}

async function consommeSurFenetre(tx: TxClient, variableBudgetId: string, start: Date, end: Date): Promise<number> {
  const result = await tx.budgetExpense.aggregate({
    where: { variableBudgetId, spentDate: { gte: start, lt: addDaysUTC(end, 1) } }, // borne exclusive : inclut toute la journée de fin
    _sum: { amount: true },
  });
  return toNumber(result._sum.amount);
}

export interface VariableBudgetCommitmentItem {
  variableBudgetId: string;
  amount: number;
}

export interface VariableBudgetCommitments {
  total: number;
  items: VariableBudgetCommitmentItem[];
}

/**
 * Part budgets variables de G.4 — « Σ Projection_prudente_restante(variable_budget)
 * pour les périodes se terminant ≤ H » (doc02 G.4). Réutilise EXCLUSIVEMENT le
 * moteur Lot 3 (budgetAmountForWindow/computeBudgetPeriodStatus — semaines/mois
 * calendaires réels, prorata uniquement aux bords, RG-098) — aucune formule
 * recopiée ici.
 *
 * Anti-double-comptage (IF-13, corrections Lot 5) : le réalisé (BudgetExpense déjà
 * enregistrées) a déjà réduit le solde réel du compte via LedgerEntry — il ne doit
 * donc JAMAIS être une seconde fois déduit ici. Seule la part FUTURE (restante) est
 * ajoutée :
 *  - période courante (contient referenceDate) → projectionPrudenteRestante du
 *    moteur Lot 3, qui soustrait déjà le consommé réel de cette période (G.8) ;
 *  - toute portion de fenêtre au-delà de la période courante jusqu'à l'horizon →
 *    entièrement future (aucune BudgetExpense n'existe encore là), donc
 *    budgetAmountForWindow proratisé (RG-098) est déjà exactement le restant, sans
 *    consommation à soustraire.
 */
export async function computeVariableBudgetCommitments(
  tx: TxClient,
  householdId: string,
  referenceDate: Date,
  horizon: Date,
  mode: ProjectionMode,
): Promise<VariableBudgetCommitments> {
  const ref = toUtcMidnight(referenceDate);
  const budgets = await tx.variableBudget.findMany({
    where: { householdId, startDate: { lte: horizon }, OR: [{ endDate: null }, { endDate: { gte: ref } }] },
  });

  let total = 0;
  const items: VariableBudgetCommitmentItem[] = [];

  for (const row of budgets) {
    const budget = toBudgetLike(row);
    const currentWindow = getCurrentPeriodWindow(budget, ref);
    const consommeCourant = await consommeSurFenetre(tx, row.id, currentWindow.start, currentWindow.end);
    const currentStatus = computeBudgetPeriodStatus(budget, ref, consommeCourant, mode);

    let amount = currentStatus.projectionPrudenteRestante; // période courante entière — déjà nette du réalisé (G.8)

    if (horizon.getTime() > currentWindow.end.getTime()) {
      const nextStart = addDaysUTC(currentWindow.end, 1);
      amount += budgetAmountForWindow(budget, nextStart, horizon); // périodes futures : rien de réalisé, donc = restant intégral proraté (RG-098)
    }

    amount = round2(amount);
    total += amount;
    items.push({ variableBudgetId: row.id, amount });
  }

  return { total: round2(total), items };
}

// ---------- Prochaine échéance (§11) ----------

export interface NextDeadline {
  id: string;
  chargePlanLabel: string;
  dueDate: Date;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  resteAPayer: number | null;
}

export async function computeNextDeadline(tx: TxClient, householdId: string, referenceDate: Date): Promise<NextDeadline | null> {
  const ref = toUtcMidnight(referenceDate);
  const certainPlans = await tx.chargePlan.findMany({
    where: { householdId, obligationStatus: { in: ['obligatoire', 'optionnelle_souscrite'] } },
    include: { deadlines: true },
  });

  let best: NextDeadline | null = null;
  for (const cp of certainPlans) {
    for (const d of cp.deadlines) {
      if (d.financialStatus === 'annulee' || d.financialStatus === 'soldee') continue;
      if (d.dueDate < ref) continue;

      const balance = await getDeadlineBalance(tx, d.id);
      const resteAPayer = balance?.resteAPayer ?? null;
      if (resteAPayer !== null && resteAPayer <= 0) continue; // reste_a_payer > 0 requis — mais un montant inconnu (NULL) n'est jamais traité comme 0 (RG-103)

      if (!best || d.dueDate < best.dueDate) {
        best = { id: d.id, chargePlanLabel: cp.label, dueDate: d.dueDate, amountStatus: d.amountStatus, resteAPayer };
      }
    }
  }
  return best;
}

// ---------- G.5 — Disponible libre ----------

export interface DisponibleLibreResult {
  referenceDate: Date;
  horizon: HorizonResult;
  patrimoineLiquideTotal: number;
  tresorerieOperationnelle: number;
  montantsReserves: number;
  deadlineCommitments: number;
  variableBudgetCommitments: number;
  montantsEngages: number; // = deadlineCommitments + variableBudgetCommitments
  coussinSecurite: number;
  disponibleLibre: number; // jamais borné à 0 (§9)
  incomplet: boolean; // au moins un montant inconnu dans l'horizon (§6)
  hasEstimates: boolean;
  unknownCount: number;
  deadlineItems: CommittedItem[];
  envisagedTotal: number;
  envisagedHasUnknown: boolean;
}

/**
 * G.5 — Disponible_libre = Trésorerie_opérationnelle − Montants_réservés −
 * Montants_engagés − Coussin_de_sécurité, où Montants_engagés = part Deadline +
 * part VariableBudget (G.4 complet, corrections Lot 5). Point de départ TOUJOURS
 * la trésorerie opérationnelle, jamais le patrimoine liquide total (§9). Le
 * coussin réutilise HouseholdSettings.security_margin_amount (déjà modélisé au
 * Lot 0, doc04 §P) — même concept que le « safety_buffer_amount » de la demande.
 */
export async function computeDisponibleLibre(tx: TxClient, householdId: string, referenceDate: Date): Promise<DisponibleLibreResult> {
  const treasury = await computeTreasurySummary(tx, householdId);
  const reserved = await computeReservedAmounts(tx, householdId);
  const horizon = await computeHorizon(tx, householdId, referenceDate);
  const deadlineCommitments = await computeDeadlineCommitments(tx, householdId, horizon.date);

  const settings = await tx.householdSettings.findUnique({ where: { householdId } });
  const mode = (settings?.variableBudgetProjectionMode ?? 'prudent_max') as ProjectionMode;
  const variableBudgetCommitments = await computeVariableBudgetCommitments(tx, householdId, referenceDate, horizon.date, mode);

  const coussinSecurite = settings ? toNumber(settings.securityMarginAmount) : 0;
  const montantsEngages = round2(deadlineCommitments.knownAmount + variableBudgetCommitments.total);
  const disponibleLibre = round2(treasury.tresorerieOperationnelle - reserved.total - montantsEngages - coussinSecurite);

  return {
    referenceDate,
    horizon,
    patrimoineLiquideTotal: treasury.patrimoineLiquideTotal,
    tresorerieOperationnelle: treasury.tresorerieOperationnelle,
    montantsReserves: reserved.total,
    deadlineCommitments: deadlineCommitments.knownAmount,
    variableBudgetCommitments: variableBudgetCommitments.total,
    montantsEngages,
    coussinSecurite,
    disponibleLibre,
    incomplet: deadlineCommitments.hasUnknown,
    hasEstimates: deadlineCommitments.hasEstimates,
    unknownCount: deadlineCommitments.unknownCount,
    deadlineItems: deadlineCommitments.items,
    envisagedTotal: deadlineCommitments.envisagedTotal,
    envisagedHasUnknown: deadlineCommitments.envisagedHasUnknown,
  };
}
