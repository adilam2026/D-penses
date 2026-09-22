/**
 * Portail Web v4 (WEB-V4.4A) — extraction MÉCANIQUE (aucun changement de
 * comportement) des types/libellés/helpers déjà présents dans
 * ChargePlanDetailScreen.tsx (mobile), partagés avec ChargePlanDetailScreen.web.tsx.
 */
export interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
}

export type ObligationStatus = 'obligatoire' | 'optionnelle_envisagee' | 'optionnelle_souscrite' | 'optionnelle_refusee';

export interface ChargePlan {
  id: string;
  label: string;
  categoryId: string | null;
  recurrenceRule: string | null;
  recurrenceAnchorDate: string | null;
  status: 'actif' | 'inactif';
  obligationStatus: ObligationStatus;
  financialPlanId: string | null;
}

export const OBLIGATION_STATUS_OPTIONS: { value: ObligationStatus; label: string }[] = [
  { value: 'obligatoire', label: 'Obligatoire' },
  { value: 'optionnelle_envisagee', label: 'Option envisagée' },
  { value: 'optionnelle_souscrite', label: 'Option retenue (souscrite)' },
  { value: 'optionnelle_refusee', label: 'Option refusée' },
];

export interface Deadline {
  id: string;
  dueDate: string;
  amountCurrent: string | number | null;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  financialStatus: 'ouverte' | 'partiellement_payee' | 'soldee' | 'annulee';
  resteAPayer: number | string | null;
}

export const AMOUNT_STATUS_LABEL: Record<'estime' | 'confirme' | 'inconnu', string> = { estime: 'Estimé', confirme: 'Confirmé', inconnu: 'Inconnu' };

export const STATUS_LABEL: Record<Deadline['financialStatus'], string> = {
  ouverte: 'Ouverte',
  partiellement_payee: 'Partiellement payée',
  soldee: 'Soldée',
  annulee: 'Annulée',
};

export const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel'] as const;

export function n(v: number | string | null): number | null {
  if (v === null) return null;
  return typeof v === 'number' ? v : Number(v);
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}
