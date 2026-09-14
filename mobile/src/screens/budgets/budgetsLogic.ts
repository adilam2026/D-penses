import { colors } from '../../ui/theme';

/**
 * Portail Web v4 (WEB-V4.2) — extraction MÉCANIQUE (aucun changement de
 * comportement) des libellés/couleurs de santé budget, déjà présents dans
 * BudgetsScreen.tsx (mobile), partagés avec BudgetsScreen.web.tsx.
 */
export type HealthStatus = 'sous_budget' | 'proche_limite' | 'depasse';

export interface BudgetStatus {
  budgetPeriode: number;
  consommeADate: number;
  budgetContractuelRestant: number;
  rythmeProjete: number;
  healthStatus: HealthStatus;
  consumptionRatio: number;
  elapsedRatio: number;
  rythmeAlerte: boolean;
}

export interface Budget {
  id: string;
  referenceAmount: number;
  referencePeriod: 'semaine' | 'mois';
  category: { name: string };
  status: BudgetStatus;
}

export const HEALTH_LABEL: Record<HealthStatus, string> = {
  sous_budget: 'Sous budget',
  proche_limite: 'Proche limite',
  depasse: 'Dépassé',
};

export const HEALTH_COLOR: Record<HealthStatus, string> = {
  sous_budget: colors.success,
  proche_limite: colors.warning,
  depasse: colors.danger,
};
