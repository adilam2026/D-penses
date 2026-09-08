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
 * R6.2 corrections finales §1 (CRITIQUE) — isHistoricalImport=true dans TOUS
 * les cas, que le compte soit connu ou non. accountId n'est PLUS le proxy de
 * "reprise historique" : ce sont deux informations orthogonales.
 *
 * CAS A (accountId connu, ex. Uniforme 3400 DH payé le 25/08/2026 depuis SG
 * Adil) : Payment.accountId renseigné à titre d'INFORMATION (mémorisé,
 * consultable dans l'historique du plan) MAIS Payment.isHistoricalImport=true
 * exclut la ligne de account_current_balance (ledger_entry.excluded_from_
 * balance) — le paiement a déjà eu lieu avant la reprise de données, il ne
 * doit jamais redébiter le solde ACTUEL de SG Adil aujourd'hui.
 *
 * CAS B (accountId absent/inconnu) : Payment.accountId = NULL, même exclusion
 * via isHistoricalImport=true.
 *
 * Dans les deux cas : reste_a_payer reste 0 (deadline_with_balance lit
 * directement la table payment, indépendamment du compte/de l'exclusion —
 * RG-016) et aucun solde de compte réel n'est débité aujourd'hui — jamais un
 * retrait artificiel du solde ACTUEL d'un compte pour une dépense déjà
 * réglée avant l'entrée dans l'app.
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
      isHistoricalImport: true,
      type: 'paiement',
      fundingSource: 'compte',
      recordedById,
      notes: input.notes ?? 'Paiement historique — déjà réglé avant la saisie dans D-Penses+',
    },
  });
  return { deadline, payment };
}
