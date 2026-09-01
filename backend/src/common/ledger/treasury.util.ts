import { Prisma } from '@prisma/client';
import { getAccountBalance, getDeadlineBalance, round2, toNumber } from './ledger.util';

type TxClient = Prisma.TransactionClient;

/**
 * Moteur de trésorerie/disponible libre (docs/02-modele-metier.md G.2 à G.5, Lot 5).
 * Toutes les fonctions sont tx-scoped (jamais de rlsContext.run() imbriqué, cf. les
 * bugs de transaction corrigés aux Lots 3/4) et acceptent une referenceDate
 * injectable — jamais de `new Date()` implicite dans le domaine (§22).
 */

// ---------- G.2/G.3 — Patrimoine liquide total / Trésorerie opérationnelle ----------

export interface TreasurySummary {
  patrimoineLiquideTotal: number;
  tresorerieOperationnelle: number;
}

export async function computeTreasurySummary(tx: TxClient, householdId: string): Promise<TreasurySummary> {
  const accounts = await tx.financialAccount.findMany({ where: { householdId, status: 'actif' } });
  let patrimoineLiquideTotal = 0;
  let tresorerieOperationnelle = 0;
  for (const account of accounts) {
    const balance = await getAccountBalance(tx, account.id);
    patrimoineLiquideTotal += balance;
    if (account.includeInOperationalTreasury) tresorerieOperationnelle += balance;
  }
  return { patrimoineLiquideTotal: round2(patrimoineLiquideTotal), tresorerieOperationnelle: round2(tresorerieOperationnelle) };
}

// ---------- G.3 — Montants réservés (préparation Lot 6, §4/§24) ----------

export interface ReservedAmounts {
  total: number;
}

/**
 * Lot 5 : reste à 0 tant que Provision (Lot 6) n'existe pas — jamais de fausse
 * réserve inventée à partir d'un simple solde de compte épargne (§4). Interface
 * volontairement extensible : quand Provision existera, seul le total des
 * poches/provisions `virtual_allocation` s'additionnera ici (RG-070/071) ;
 * `backed_by_account` ne devra JAMAIS y être réadditionné — elle est déjà
 * retirée de la Trésorerie opérationnelle par l'exclusion de son compte dédié
 * (RG-072/IF-06). Cette fonction ne lit donc, par construction, aucun solde de
 * compte : le jour où Lot 6 l'implémente, IF-06 reste garanti par conception.
 */
export async function computeReservedAmounts(_tx: TxClient, _householdId: string): Promise<ReservedAmounts> {
  return { total: 0 };
}

// ---------- G.5 — Horizon (H*) ----------

function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * H* (doc02 G.5) = date de la prochaine IncomeOccurrence « prévue » significative.
 * À défaut de revenu prévu connu, repli déterministe sur seuil_à_venir (paramètre
 * foyer déjà utilisé par RG-117/Actions à traiter, doc02 §F.2) — jamais une règle
 * arbitraire distincte de celle du modèle (§10).
 */
export async function computeHorizon(tx: TxClient, householdId: string, referenceDate: Date): Promise<Date> {
  const ref = toUtcMidnight(referenceDate);
  const nextIncome = await tx.incomeOccurrence.findFirst({
    where: { status: 'prevu', usualDate: { gt: ref }, incomeSource: { householdId } },
    orderBy: { usualDate: 'asc' },
  });
  if (nextIncome) return nextIncome.usualDate;

  const settings = await tx.householdSettings.findUnique({ where: { householdId } });
  const days = settings?.seuilAVenirDays ?? 30;
  return new Date(ref.getTime() + days * 86400000);
}

// ---------- G.4 — Montants engagés ----------

export interface CommittedItem {
  id: string;
  chargePlanId: string;
  chargePlanLabel: string;
  dueDate: Date;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  resteAPayer: number | null;
}

export interface CommittedAmounts {
  horizon: Date;
  knownAmount: number; // Σ engagement_non_couvert (= reste_a_payer, couverture_affectée=0 tant que Lot 6 n'existe pas)
  hasUnknown: boolean;
  unknownCount: number;
  hasEstimates: boolean;
  items: CommittedItem[];
  envisagedTotal: number; // jamais mélangé au total certain (§7, IF-25)
  envisagedHasUnknown: boolean;
}

/**
 * G.4 — Montants_engagés(T, H). Base de calcul : reste_a_payer, JAMAIS known_plan_cost
 * (§5/§19 — un FinancialPlan n'est jamais lu ici, exclusion structurelle du double
 * comptage IF-28). Portée certaine = obligatoire ∪ optionnelle_souscrite (RG-106) ;
 * optionnelle_envisagée est calculée séparément (jamais fusionnée, §7) ;
 * optionnelle_refusée et les Deadline annulées/soldées sont exclues (RG-107/RG-050).
 * Une Deadline est engagée dès aujourd'hui si sa due_date tombe dans l'horizon —
 * jamais seulement le jour de son échéance (§5). Le terme "Projection_prudente_restante
 * des budgets variables" de la formule G.4 complète n'est volontairement pas mélangé
 * ici (§20 — pas encore à cet endroit dans ce lot).
 */
export async function computeCommittedAmounts(tx: TxClient, householdId: string, referenceDate: Date): Promise<CommittedAmounts> {
  const horizon = await computeHorizon(tx, householdId, referenceDate);

  const certainPlans = await tx.chargePlan.findMany({
    where: { householdId, obligationStatus: { in: ['obligatoire', 'optionnelle_souscrite'] } },
    include: { deadlines: true },
  });

  let knownAmount = 0;
  let unknownCount = 0;
  let hasEstimates = false;
  const items: CommittedItem[] = [];

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
      knownAmount += resteAPayer;
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
    horizon,
    knownAmount: round2(knownAmount),
    hasUnknown: unknownCount > 0,
    unknownCount,
    hasEstimates,
    items,
    envisagedTotal: round2(envisagedTotal),
    envisagedHasUnknown,
  };
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
  horizon: Date;
  patrimoineLiquideTotal: number;
  tresorerieOperationnelle: number;
  montantsReserves: number;
  montantsEngages: number;
  coussinSecurite: number;
  disponibleLibre: number; // jamais borné à 0 (§9)
  incomplet: boolean; // au moins un montant inconnu dans l'horizon (§6)
  hasEstimates: boolean;
}

/**
 * G.5 — Disponible_libre = Trésorerie_opérationnelle − Montants_réservés −
 * Montants_engagés − Coussin_de_sécurité. Point de départ TOUJOURS la trésorerie
 * opérationnelle, jamais le patrimoine liquide total (§9). Le coussin réutilise
 * HouseholdSettings.security_margin_amount (déjà modélisé au Lot 0, doc04 §P) —
 * même concept que le « safety_buffer_amount » de la demande, pas un nouveau champ.
 */
export async function computeDisponibleLibre(tx: TxClient, householdId: string, referenceDate: Date): Promise<DisponibleLibreResult> {
  const treasury = await computeTreasurySummary(tx, householdId);
  const reserved = await computeReservedAmounts(tx, householdId);
  const committed = await computeCommittedAmounts(tx, householdId, referenceDate);
  const settings = await tx.householdSettings.findUnique({ where: { householdId } });
  const coussinSecurite = settings ? toNumber(settings.securityMarginAmount) : 0;

  const disponibleLibre = round2(treasury.tresorerieOperationnelle - reserved.total - committed.knownAmount - coussinSecurite);

  return {
    referenceDate,
    horizon: committed.horizon,
    patrimoineLiquideTotal: treasury.patrimoineLiquideTotal,
    tresorerieOperationnelle: treasury.tresorerieOperationnelle,
    montantsReserves: reserved.total,
    montantsEngages: committed.knownAmount,
    coussinSecurite,
    disponibleLibre,
    incomplet: committed.hasUnknown,
    hasEstimates: committed.hasEstimates,
  };
}
