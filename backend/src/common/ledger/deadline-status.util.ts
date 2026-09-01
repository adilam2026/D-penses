import { Prisma } from '@prisma/client';
import { getDeadlineBalance } from './ledger.util';

/**
 * Transition d'état financier persistant d'une Deadline (docs/02-modele-metier.md
 * §F.2, RG-014). Point d'entrée unique appelé après toute écriture de Payment ou
 * toute révision de amount_current — jamais dupliqué ailleurs.
 *
 * - ouverte → partiellement_payée : dès qu'un paiement net existe (payé > 0) et
 *   qu'il reste un solde à payer. Jamais → soldée automatiquement : la clôture
 *   exige une confirmation explicite (DeadlinesService.close), même si le cumul
 *   des paiements atteint le montant (le montant peut encore être révisé).
 * - soldée → partiellement_payée : réouverture si la dette réapparaît (ex.
 *   remboursement RG-016bis, ou révision du montant à la hausse) — jamais dans
 *   l'autre sens sans confirmation explicite.
 * - annulée : jamais modifiée automatiquement.
 */
export async function recalcFinancialStatus(tx: Prisma.TransactionClient, deadlineId: string) {
  const deadline = await tx.deadline.findUniqueOrThrow({ where: { id: deadlineId } });
  if (deadline.financialStatus === 'annulee') return deadline;

  const balance = await getDeadlineBalance(tx, deadlineId);
  if (!balance || balance.amountCurrent === null || balance.resteAPayer === null) return deadline; // amount_status = inconnu (RG-103)

  const payeNet = balance.amountCurrent - balance.resteAPayer;
  let next = deadline.financialStatus;

  if (deadline.financialStatus === 'ouverte' && payeNet > 0 && balance.resteAPayer > 0) {
    next = 'partiellement_payee';
  } else if (deadline.financialStatus === 'soldee' && balance.resteAPayer > 0) {
    next = 'partiellement_payee';
  }

  if (next === deadline.financialStatus) return deadline;
  return tx.deadline.update({ where: { id: deadlineId }, data: { financialStatus: next } });
}
