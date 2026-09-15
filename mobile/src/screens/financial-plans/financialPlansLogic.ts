/**
 * Portail Web v4 (WEB-V4.2) — extraction MÉCANIQUE (aucun changement de
 * comportement) des types/libellés déjà présents dans FinancialPlansScreen.tsx
 * (mobile), partagés avec FinancialPlansScreen.web.tsx.
 */
// Portail Web v4 §2/§6 (WEB-V4.2 révisé) — GET /financial-plans (déjà utilisé
// pour la liste) embarque déjà `deadlinesCertain` par plan (voir
// backend/financial-plans.service.ts) : sous-ensemble des champs utiles pour
// la zone "Prochaines échéances", aucun nouvel appel/endpoint.
export interface PlanDeadline {
  id: string;
  dueDate: string;
  chargePlanLabel: string;
  resteAPayer: number | null;
  financialStatus: 'ouverte' | 'partiellement_payee' | 'soldee' | 'annulee';
}

export interface FinancialPlan {
  id: string;
  label: string;
  planType: 'school' | 'travel' | 'other';
  destination: string | null;
  // M9 — année scolaire structurée : conditionne l'affichage de "Projeter les
  // années suivantes" (jamais affiché tant que le plan n'en a pas une).
  schoolYear?: string | null;
  knownPlanCost: number;
  paidAmount: number;
  provisionCoverage: number;
  remainingDue: number;
  completude: 'complet' | 'contient_estimations' | 'contient_inconnues';
  deadlinesCertain: PlanDeadline[];
}

/**
 * Portail Web v4 §2 garde-fou — échéances NON SOLDÉES uniquement (ouverte /
 * partiellement_payee), en retard d'abord (jamais masquées), puis à venir
 * triées par date croissante ; maximum `max`.
 */
export function upcomingDeadlines(plan: FinancialPlan, max = 5): PlanDeadline[] {
  const now = Date.now();
  const open = (plan.deadlinesCertain ?? []).filter(
    (d) => d.financialStatus === 'ouverte' || d.financialStatus === 'partiellement_payee',
  );
  const overdue = open.filter((d) => new Date(d.dueDate).getTime() < now).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const upcoming = open.filter((d) => new Date(d.dueDate).getTime() >= now).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  return [...overdue, ...upcoming].slice(0, max);
}

export const COMPLETUDE_LABEL: Record<FinancialPlan['completude'], string> = {
  complet: 'Complet',
  contient_estimations: 'Contient des estimations',
  contient_inconnues: 'Incomplet — montants inconnus',
};

export const PLAN_TYPE_ICON: Record<FinancialPlan['planType'], string> = {
  school: '🎓',
  travel: '✈️',
  other: '📁',
};
