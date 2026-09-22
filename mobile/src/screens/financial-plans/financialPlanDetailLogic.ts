/**
 * Portail Web v4 (WEB-V4.4A) — extraction MÉCANIQUE (aucun changement de
 * comportement) des types/libellés/helpers déjà présents dans
 * FinancialPlanDetailScreen.tsx (mobile), partagés avec
 * FinancialPlanDetailScreen.web.tsx. Distinct de financialPlansLogic.ts (liste)
 * — la fiche détail expose bien plus de champs (deadlinesCertain complet,
 * envisagedItems, unknownItems, coverage) qu'un item de liste.
 */
export const AMOUNT_STATUS_OPTIONS = [
  { value: 'confirme', label: 'Confirmé' },
  { value: 'estime', label: 'Estimé' },
  { value: 'inconnu', label: 'Inconnu' },
];

export interface Child {
  id: string;
  firstName: string;
  lastName: string;
}

export type CoverageStatus = 'couverte' | 'partielle' | 'non_couverte' | 'sans_objet';

export interface DeadlineRow {
  id: string;
  dueDate: string;
  chargePlanLabel: string;
  amountCurrent: string | number | null;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  resteAPayer: number | null;
  financialStatus: 'ouverte' | 'partiellement_payee' | 'soldee' | 'annulee';
  provisionId: string | null;
  coverageAffectee: number;
  engagementNonCouvert: number;
  coverageStatus: CoverageStatus;
}

export const STATUS_MARK: Record<DeadlineRow['financialStatus'], string> = {
  ouverte: '○',
  partiellement_payee: '◐',
  soldee: '✓',
  annulee: '✕',
};

export const COVERAGE_ICON: Record<CoverageStatus, string> = {
  couverte: '✅',
  partielle: '🟠',
  non_couverte: '🔴',
  sans_objet: '',
};

export const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  couverte: 'Couverte',
  partielle: 'Partiellement couverte',
  non_couverte: 'Non couverte',
  sans_objet: '',
};

export const STATUS_LABEL: Record<DeadlineRow['financialStatus'], string> = {
  ouverte: 'Ouverte',
  partiellement_payee: 'Partiellement payée',
  soldee: 'Soldée',
  annulee: 'Annulée',
};

export function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export interface UnknownItem {
  chargePlanId: string;
  label: string;
  deadlineId: string;
}

export interface EnvisagedItem {
  chargePlanId: string;
  label: string;
  amountKnown: boolean;
}

export interface FinancialPlanDetail {
  id: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  planType: 'school' | 'travel' | 'other';
  knownPlanCost: number;
  paidAmount: number;
  remainingDue: number;
  provisionCoverage: number;
  remainingToFund: number;
  tauxCouverture: number | null;
  completude: 'complet' | 'contient_estimations' | 'contient_inconnues';
  deadlinesCertain: DeadlineRow[];
  envisagedItems: EnvisagedItem[];
  envisagedTotal: number;
  unknownItems: UnknownItem[];
}

export const COMPLETUDE_LABEL: Record<FinancialPlanDetail['completude'], string> = {
  complet: 'Budget total : complet',
  contient_estimations: 'Contient des estimations — total non définitif',
  contient_inconnues: 'Au moins ce montant identifié — budget incomplet',
};
