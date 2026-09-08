import { Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

export interface AlreadyPaidInput {
  amount: number;
  paidDate: Date;
  accountId?: string | null;
  notes?: string;
}

/**
 * R6.2 (§4-9) — "échéance déjà payée" : une dépense réglée AVANT d'être saisie
 * dans l'app (ex. Uniforme scolaire payé en août pour un plan créé en
 * septembre). Jamais une simple ligne descriptive : une vraie Deadline
 * financialStatus='soldee' + un vrai Payment, créés atomiquement dans la MÊME
 * transaction que l'appelant — jamais un second moteur ni un champ dédié
 * "déjà payé" séparé du modèle Deadline/Payment existant.
 *
 * recalcFinancialStatus n'est jamais appelé ici : il ne ferme jamais
 * automatiquement une échéance (RG-014, deadline-status.util.ts) — on
 * court-circuite volontairement car montant payé = montant dû est déjà
 * déterministe au moment de la saisie (jamais une ambiguïté à trancher plus
 * tard), contrairement à un paiement normal où le solde peut encore évoluer.
 *
 * CAS A (accountId connu, ex. Uniforme 3400 DH payé le 25/08/2026 depuis SG
 * Adil) : Payment.accountId renseigné — débite l'historique du compte comme
 * tout paiement réel (account_current_balance l'inclut normalement).
 *
 * CAS B (accountId absent/inconnu) : Payment.accountId = NULL — reste_a_payer
 * reste 0 (deadline_with_balance ne filtre jamais par compte, RG-016) MAIS
 * aucun solde de compte réel n'est débité : NULL ne matche jamais un compte
 * dans account_current_balance (RG-015 §5 CAS B) — jamais un retrait
 * artificiel du solde ACTUEL d'un compte pour une dépense déjà réglée avant
 * l'entrée dans l'app.
 *
 * Dans les deux cas : exclue des échéances ouvertes (financialStatus='soldee'
 * dès la création, jamais 'ouverte'), donc jamais reproposée dans "Payer",
 * jamais dans Engagé/Reste à financer (qui ne comptent que resteAPayer>0 —
 * cf. FinancialPlansService.detailOnTx, déjà correct sans modification) —
 * mais toujours visible dans le plan/l'historique et comptée dans le coût
 * total (amountCurrent, jamais exclu de knownPlanCost) et dans "Déjà payé".
 */
export async function createAlreadyPaidDeadline(tx: TxClient, chargePlanId: string, dueDate: Date, recordedById: string, input: AlreadyPaidInput) {
  const deadline = await tx.deadline.create({
    data: {
      chargePlanId,
      dueDate,
      amountCurrent: input.amount,
      amountStatus: 'confirme',
      confirmedAt: new Date(),
      financialStatus: 'soldee',
    },
  });
  const payment = await tx.payment.create({
    data: {
      deadlineId: deadline.id,
      amount: input.amount,
      paidDate: input.paidDate,
      accountId: input.accountId ?? null,
      type: 'paiement',
      fundingSource: 'compte',
      recordedById,
      notes: input.notes ?? 'Paiement historique — déjà réglé avant la saisie dans D-Penses+',
    },
  });
  return { deadline, payment };
}
