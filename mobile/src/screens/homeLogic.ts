import { colors } from '../ui/theme';
import { temporalStatus, temporalStatusColor } from '../ui/temporalStatus';

/**
 * Architecture Web v3 §11 — extraction MÉCANIQUE des types et fonctions pures
 * déjà présents dans HomeScreen.tsx (aucune modification comportementale),
 * pour être réutilisés à l'identique par HomeScreen.web.tsx : mêmes données,
 * même métier, jamais un second calcul parallèle (§12). Les tests existants
 * de HomeScreen continuent de couvrir ce code (import inchangé de comportement).
 */

export interface Account {
  id: string;
  name: string;
  soldeCourant: number;
  includeInOperationalTreasury: boolean;
  // Corrections consolidées §5/§6 — préférences purement visuelles, INDÉPENDANTES
  // de includeInOperationalTreasury (pilotage) : optionnelles pour ne jamais
  // casser un appelant existant (ex. HomeScreen.web.tsx) qui ne les lit pas.
  hideBalanceByDefault?: boolean;
  showOnHome?: boolean;
  bankName?: string | null;
  ownerLabel?: string | null;
}

export interface DeadlineItem {
  id: string;
  chargePlanId: string;
  chargePlanLabel: string;
  dueDate: string;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  resteAPayer: number | null;
  coverageStatus: 'couverte' | 'partielle' | 'non_couverte' | 'sans_objet';
  engagementNonCouvert: number | null;
}

export interface VariableBudgetItem {
  variableBudgetId: string;
  amount: number;
  // M3 — libellé libre, primaire à l'affichage ; categoryName reste secondaire.
  // Optionnel : absent pour une réponse pas encore migrée, repli sur categoryName.
  label?: string;
  categoryName: string;
}

export interface BudgetResumeStatus {
  budgetPeriode: number;
  consommeADate: number;
  budgetContractuelRestant: number;
  healthStatus: 'sous_budget' | 'proche_limite' | 'depasse';
  // Lot 3 — % consommé vs % période écoulée, additif et distinct de healthStatus (jamais fusionnés).
  consumptionRatio: number;
  elapsedRatio: number;
  rythmeAlerte: boolean;
}

export interface BudgetResume {
  id: string;
  // M3 — libellé libre, primaire à l'affichage ; categoryName reste secondaire.
  // Optionnel : absent pour une réponse pas encore migrée, repli sur categoryName.
  label?: string;
  categoryName: string;
  referenceAmount: number;
  referencePeriod: 'semaine' | 'mois';
  status: BudgetResumeStatus;
}

export interface FinancialPlanResume {
  id: string;
  label: string;
  planType: 'school' | 'travel' | 'other';
  knownPlanCost: number;
  paidAmount: number;
  remainingDue: number;
  provisionCoverage: number;
  tauxCouverture: number | null;
  nextDeadlineDate: string | null;
  hasOverdue: boolean;
  completude: string;
}

export interface DashboardSummary {
  seuil_a_payer_days: number;
  operational_treasury: number;
  free_available: number;
  reserved_amount: number;
  committed_amount: number;
  safety_buffer: number;
  patrimoine_liquide_total: number;
  is_complete: boolean;
  contains_estimates: boolean;
  unknown_commitments_count: number;
  horizon_date: string;
  horizon_source: 'income' | 'fallback';
  horizon_is_fallback: boolean;
  deadlineItems: DeadlineItem[];
  // Home « Échéances importantes » (R5 clôture Home §1) — sélection déjà triée/filtrée
  // côté backend (fenêtre 30 jours fixe, reste à payer décroissant, top 3) : jamais
  // retriée/refiltrée ici, distincte de deadlineItems (borné à H*, sert EngagedDetail).
  topDeadlines: DeadlineItem[];
  variableBudgetItems: VariableBudgetItem[];
  optionsEnvisagees: { total: number; hasUnknown: boolean };
  budgetsResume: BudgetResume[];
  financialPlansResume: FinancialPlanResume[];
  provisionsResume: Array<{ id: string; name: string; currentAmount: number; totalResteAPayer: number; totalUncovered: number }>;
  next_30_days: {
    closing_physical_treasury: number;
    // TXT réf. §M4 — 3 niveaux réellement distincts : Aujourd'hui (operational_treasury,
    // ci-dessus) / Fin de période engagements connus (zéro budget) / Fin de période
    // prudente (engagements connus − restant des budgets includeInPrudentProjection=true).
    fin_periode_engagements_connus: number;
    fin_periode_prudente: number;
    ecart_prudentiel: number;
    closing_free_capacity: number;
    physical_low_point: number;
    physical_low_point_date: string;
    free_capacity_low_point: number;
    free_capacity_low_point_date: string;
    first_negative_date: string | null;
    deficit_at_first_negative: number | null;
    status: 'OK' | 'TENSION' | 'DEFICIT_PHYSIQUE' | 'INCOMPLETE';
    is_complete: boolean;
  };
}

export const PROJECTION_STATUS_LABEL: Record<DashboardSummary['next_30_days']['status'], string> = {
  OK: 'Situation maîtrisée',
  TENSION: 'Attention : marge faible',
  DEFICIT_PHYSIQUE: 'Risque de déficit',
  INCOMPLETE: 'Projection incomplète',
};

export const PROJECTION_STATUS_COLOR: Record<DashboardSummary['next_30_days']['status'], string> = {
  OK: colors.success,
  TENSION: colors.warning,
  DEFICIT_PHYSIQUE: colors.danger,
  INCOMPLETE: colors.textSecondary,
};

// Maquette 3 §4 — mapping strict, jamais une déduction par mots-clés dans le libellé :
// seul planType (school|travel|other, seules valeurs du modèle) décide l'icône.
export const PLAN_TYPE_ICON: Record<FinancialPlanResume['planType'], string> = {
  school: '🎓',
  travel: '✈️',
  other: '📁',
};

/**
 * §19 — un foyer tout juste créé (aucun compte ET aucune autre donnée) n'est plus
 * "empty" pour un motif technique (ex. un compte à 0 DH volontairement) : on
 * distingue explicitement l'absence totale de configuration d'une simple valeur nulle.
 */
export function isFullyEmpty(summary: DashboardSummary, accounts: Account[]): boolean {
  return (
    accounts.length === 0 &&
    summary.deadlineItems.length === 0 &&
    summary.budgetsResume.length === 0 &&
    summary.financialPlansResume.length === 0 &&
    summary.provisionsResume.length === 0
  );
}

export function isPartiallyConfigured(summary: DashboardSummary, accounts: Account[]): boolean {
  return accounts.length > 0 && !isFullyEmpty(summary, accounts);
}

/**
 * Recette téléphone réel §13 — prérequis ESSENTIELS (distincts des étapes
 * facultatives d'onboarding, toujours accessibles depuis Paramètres) : au moins
 * un compte et au moins un revenu planifié. Le foyer ne "déclare" nulle part
 * s'il a des enfants avant d'en créer un — la clause "si le foyer a déclaré des
 * enfants" du cahier des charges est donc un no-op tant qu'aucun tel indicateur
 * n'existe dans le modèle (documenté explicitement, pas une omission silencieuse).
 */
export function essentialPrerequisitesMet(accounts: Account[], incomeSourcesCount: number): boolean {
  return accounts.length > 0 && incomeSourcesCount > 0;
}

export function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

export function formatLongDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' });
}

// §12 — hiérarchie simple, jamais un tableau multicolore : en retard (rouge),
// très proche (orange, seuil du foyer — seuil_a_payer_days, déjà chargé avec le
// dashboard : jamais un second appel réseau, jamais une valeur dupliquée en dur ici),
// à venir (neutre). Mini-lot Paiements/Échéances : délègue au statut temporel
// partagé (temporalStatus, généralisé — aussi réutilisé par les occurrences
// de virement récurrent) — seule règle de seuil dans l'app, jamais une
// seconde. topDeadlines du Dashboard sont déjà des échéances ouvertes,
// isClosed n'a donc jamais besoin d'être passé ici.
export function urgencyColor(dueDate: string, seuilAPayerDays: number): string {
  return temporalStatusColor(temporalStatus(dueDate, seuilAPayerDays));
}

/**
 * Lot 3 — priorité des "budgets clés" affichés en accueil, réutilisant
 * EXCLUSIVEMENT des champs déjà calculés côté backend (variable-budget.util.ts) :
 * jamais de logique métier parallèle recalculée ici. Ordre validé :
 *  1) healthStatus='depasse' d'abord (plafond déjà dépassé) ;
 *  2) puis rythmeAlerte=true (vitesse de consommation en avance sur le temps
 *     écoulé, distinct du plafond — cf. §1 de la demande) ;
 *  3) puis healthStatus='proche_limite' ;
 *  4) puis ratio consommé/plafond décroissant ;
 *  5) tie-breaker stable par id (jamais l'ordre de réponse API).
 */
export function prioritizeBudgets(budgets: BudgetResume[]): BudgetResume[] {
  return [...budgets].sort((a, b) => {
    const aDepasse = a.status.healthStatus === 'depasse';
    const bDepasse = b.status.healthStatus === 'depasse';
    if (aDepasse !== bDepasse) return aDepasse ? -1 : 1;

    if (a.status.rythmeAlerte !== b.status.rythmeAlerte) return a.status.rythmeAlerte ? -1 : 1;

    const aProche = a.status.healthStatus === 'proche_limite';
    const bProche = b.status.healthStatus === 'proche_limite';
    if (aProche !== bProche) return aProche ? -1 : 1;

    const aRatio = a.status.budgetPeriode > 0 ? a.status.consommeADate / a.status.budgetPeriode : 0;
    const bRatio = b.status.budgetPeriode > 0 ? b.status.consommeADate / b.status.budgetPeriode : 0;
    if (aRatio !== bRatio) return bRatio - aRatio;

    return a.id.localeCompare(b.id);
  });
}

// Correctif post-Vague 3 — règle déterministe et documentée à 5 niveaux, réutilisant
// EXCLUSIVEMENT des champs déjà calculés côté backend (FinancialPlansService.detailOnTx) :
// jamais de logique métier parallèle recalculée ici. Un plan avec une échéance ouverte
// proche (ex. demain) ne doit jamais être masqué par un plan moins urgent uniquement
// parce que son reste à financer est supérieur — d'où la proximité d'échéance en tête,
// avant le montant :
//  1) retard (échéance ouverte dépassée) d'abord ;
//  2) puis échéance ouverte la plus proche (null = aucune échéance ouverte, en dernier) ;
//  3) puis reste à financer décroissant ;
//  4) puis taux de couverture croissant (le moins couvert = le plus urgent) ;
//  5) tie-breaker stable par id (jamais l'ordre de création/réponse API).
// Correction (point 9, révision) — l'Accueil doit afficher les plans
// financiers triés par ordre alphabétique du libellé (insensible à la
// casse/accents), puis prendre les 6 premiers — jamais une priorisation par
// urgence/retard : même règle et même ordre que "Voir tous"
// (FinancialPlansScreen.tsx), pour que les deux écrans montrent la même
// sélection cohérente sur un foyer avec plus de 6 plans.
export function sortPlansAlphabetically(plans: FinancialPlanResume[]): FinancialPlanResume[] {
  return [...plans].sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }));
}

// Conservée pour HomeScreen.web.tsx (portail Web v4, périmètre séparé et en
// standby) — plus utilisée par le mobile depuis la correction ci-dessus,
// jamais supprimée pour ne pas casser cet appelant.
export function prioritizePlans(plans: FinancialPlanResume[]): FinancialPlanResume[] {
  return [...plans].sort((a, b) => {
    if (a.hasOverdue !== b.hasOverdue) return a.hasOverdue ? -1 : 1;

    if (a.nextDeadlineDate !== b.nextDeadlineDate) {
      if (a.nextDeadlineDate === null) return 1;
      if (b.nextDeadlineDate === null) return -1;
      const diff = new Date(a.nextDeadlineDate).getTime() - new Date(b.nextDeadlineDate).getTime();
      if (diff !== 0) return diff;
    }

    if (a.remainingDue !== b.remainingDue) return b.remainingDue - a.remainingDue;

    const aCov = a.tauxCouverture ?? 100;
    const bCov = b.tauxCouverture ?? 100;
    if (aCov !== bCov) return aCov - bCov;

    return a.id.localeCompare(b.id);
  });
}
