import { OperationKind } from '../api/client';

/** Libellé français partagé par tous les historiques (Détail compte/sous-compte, Santé). */
export const OPERATION_KIND_LABELS: Record<OperationKind, string> = {
  EXPENSE: 'Dépense',
  INCOME: 'Revenu',
  TRANSFER: 'Transfert',
  SAVINGS_CONTRIBUTION: 'Versement',
  MEDICAL_REIMBURSEMENT: 'Remboursement mutuelle',
  OPENING_BALANCE: "Solde d'ouverture",
};

export interface LedgerEntryLike {
  accountId: string;
  subaccountId: string | null;
  amount: number;
}

/**
 * Montant "local" d'une opération pour un compte ou un sous-compte donné —
 * somme des lignes ledger qui le concernent (déjà signées à la construction,
 * cf. buildLedgerLegs). Simplification assumée pour un écran "très simple" :
 * une réallocation pure au sein d'un même compte (non-affecté <-> sous-compte)
 * peut apparaître avec un effet compte=0 alors que le sous-compte, lui, bouge
 * bien — cohérent car account.balance ne change réellement pas dans ce cas.
 */
export function localAmount(ledgerEntries: LedgerEntryLike[], filter: { accountId: string } | { subaccountId: string }): number {
  const relevant =
    'subaccountId' in filter
      ? ledgerEntries.filter((le) => le.subaccountId === filter.subaccountId)
      : ledgerEntries.filter((le) => le.accountId === filter.accountId);
  return relevant.reduce((sum, le) => sum + le.amount, 0);
}
