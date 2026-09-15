/**
 * Portail Web v4 (WEB-V4.4A) — extraction MÉCANIQUE (aucun changement de
 * comportement) des types/libellés/helpers déjà présents dans
 * DeadlineDetailScreen.tsx (mobile), partagés avec DeadlineDetailScreen.web.tsx.
 */
export const AMOUNT_STATUS_OPTIONS = [
  { value: 'confirme', label: 'Confirmé' },
  { value: 'estime', label: 'Estimé' },
  { value: 'inconnu', label: 'Inconnu' },
];

export interface Deadline {
  id: string;
  chargePlanId: string;
  dueDate: string;
  amountCurrent: number | string | null;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  financialStatus: 'ouverte' | 'partiellement_payee' | 'soldee' | 'annulee';
  resteAPayer: number | string | null;
  provisionId: string | null;
  chargePlan: { label: string };
}

export interface Payment {
  id: string;
  amount: number | string;
  paidDate: string;
  type: string;
  accountId: string;
  provisionId: string | null;
}

export interface Account {
  id: string;
  name: string;
  soldeCourant: number;
}

export interface Provision {
  id: string;
  name: string;
  allocationMode: 'virtual_allocation' | 'backed_by_account';
  linkedAccountId: string | null;
  currentAmount: number | string;
}

export const STATUS_LABEL: Record<Deadline['financialStatus'], string> = {
  ouverte: 'Ouverte',
  partiellement_payee: 'Partiellement payée',
  soldee: 'Soldée',
  annulee: 'Annulée',
};

export function n(v: number | string | null): number | null {
  if (v === null) return null;
  return typeof v === 'number' ? v : Number(v);
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
