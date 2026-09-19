import type { MonthlyLineItem } from '../../api/client';

/**
 * Portail Web v4 (WEB-V4.3) — extraction MÉCANIQUE (aucun changement de
 * comportement) des libellés/formats déjà présents dans ProjectionScreen.tsx
 * (mobile), partagés avec ProjectionScreen.web.tsx.
 */
export const CATEGORY_LABEL: Record<NonNullable<MonthlyLineItem['category']>, string> = {
  obligatoire: 'Obligatoire',
  flexible: 'Flexible',
  projet: 'Projet',
};

export function formatDh(n: number): string {
  return `${n.toLocaleString('fr-FR')} DH`;
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Corrections consolidées §11 — détail mensuel groupé par plan financier, jamais
// une deuxième catégorisation parallèle : réutilise exclusivement financialPlanId
// (déjà porté par MonthlyLineItem) + planType (déjà exposé par GET /financial-plans),
// jamais recalculé. Chaque item appartient à EXACTEMENT un groupe (partition stricte
// par planGroupOf), donc jamais dupliqué entre blocs.
export type PlanGroupKey = 'school' | 'vehicle' | 'travel' | 'housing' | 'other';

export const PLAN_GROUP_ORDER: PlanGroupKey[] = ['school', 'vehicle', 'travel', 'housing', 'other'];

export const PLAN_GROUP_LABEL: Record<PlanGroupKey, string> = {
  school: 'Scolarité',
  vehicle: 'Voiture',
  travel: 'Voyage',
  housing: 'Logement',
  other: 'Autres',
};

export function planGroupOf(planType: string | undefined): PlanGroupKey {
  if (planType === 'school' || planType === 'vehicle' || planType === 'travel' || planType === 'housing') return planType;
  return 'other';
}

export function groupItemsByPlan<T extends { financialPlanId?: string | null }>(
  items: T[],
  planTypeById: Map<string, string>,
): Record<PlanGroupKey, T[]> {
  const result: Record<PlanGroupKey, T[]> = { school: [], vehicle: [], travel: [], housing: [], other: [] };
  for (const item of items) {
    const planType = item.financialPlanId ? planTypeById.get(item.financialPlanId) : undefined;
    result[planGroupOf(planType)].push(item);
  }
  return result;
}
