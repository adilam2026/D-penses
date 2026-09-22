/**
 * Portail Web v4 (WEB-V4.4A) — extraction MÉCANIQUE (aucun changement de
 * comportement) des types/libellés/helpers déjà présents dans
 * TransactionDetailScreen.tsx (mobile), partagés avec TransactionDetailScreen.web.tsx.
 */
export interface TransactionDetail {
  kind: string;
  displayKind: string;
  id: string;
  origin: string;
  label: string;
  amount: number;
  date: string;
  accountId: string;
  accountName: string;
  note: string | null;
  deadline: { id: string; dueDate: string; chargePlanLabel: string } | null;
  financialPlan: { id: string; label: string } | null;
  provisionId: string | null;
  transferCounterpart?: { accountId: string; accountName: string } | null;
}

export interface Provision {
  id: string;
  name: string;
}

export const KIND_LABEL: Record<string, string> = {
  revenu: 'Revenu',
  paiement: 'Paiement',
  depense: 'Dépense',
  transfert: 'Transfert',
  ajustement: 'Ajustement',
};

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}
