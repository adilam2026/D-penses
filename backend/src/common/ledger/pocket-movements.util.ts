import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toNumber } from './ledger.util';
import { AllocationMode, PocketType, computePocketCurrentAmount } from './provision.util';

type TxClient = Prisma.TransactionClient;

/**
 * Mécanique de mouvement partagée SavingsPocket/Provision (docs/02-modele-metier.md
 * §E.5bis, RG-073/086, §16-18/28 de la demande Lot 6). Réutilisée telle quelle par
 * pockets.service.ts et provisions.service.ts — jamais deux implémentations séparées
 * du même « mettre de côté »/« retirer ».
 */

function pocketWhere(pocketType: PocketType, pocketId: string) {
  return pocketType === 'savings_pocket' ? { savingsPocketId: pocketId } : { provisionId: pocketId };
}

export interface ContributeParams {
  amount: number;
  date?: Date;
  intentionLabel?: string;
  /** RG-000 : une contribution planifiée (confirmed=false) ne modifie jamais le solde réel (§16). */
  confirmed: boolean;
  recordedByUserId: string;
}

/** RG-073 : une poche virtual_allocation ne grandit QUE via un PocketMovement confirmé. */
export async function contributeToPocket(tx: TxClient, pocketType: PocketType, pocketId: string, allocationMode: AllocationMode, params: ContributeParams) {
  if (allocationMode === 'backed_by_account') {
    throw new BadRequestException(
      "Une poche backed_by_account ne grandit que via un AccountTransfer réel vers son compte dédié (RG-073/086) — utilisez /accounts/transfers, jamais un PocketMovement",
    );
  }
  const date = params.date ?? new Date();
  return tx.pocketMovement.create({
    data: {
      pocketType,
      ...pocketWhere(pocketType, pocketId),
      plannedDate: date,
      plannedAmount: params.amount,
      actualDate: params.confirmed ? date : undefined,
      actualAmount: params.confirmed ? params.amount : undefined,
      status: params.confirmed ? 'confirme' : 'prevu',
      movementType: 'contribution',
      intentionLabel: params.intentionLabel,
      recordedByUserId: params.recordedByUserId,
    },
  });
}

export interface WithdrawParams {
  amount: number;
  date?: Date;
  intentionLabel?: string;
  recordedByUserId: string;
}

/**
 * Un retrait est toujours une action réelle immédiate — aucun « retrait planifié »
 * dans le modèle (§18). Refuse tout retrait qui rendrait le solde négatif (§21) :
 * jamais une capacité négative silencieuse.
 */
export async function withdrawFromPocket(tx: TxClient, pocketType: PocketType, pocketId: string, allocationMode: AllocationMode, params: WithdrawParams) {
  if (allocationMode === 'backed_by_account') {
    throw new BadRequestException(
      "Une poche backed_by_account ne baisse que via ses mouvements réels sur le compte dédié (RG-073/086) — jamais un PocketMovement",
    );
  }
  const currentAmount = await computePocketCurrentAmount(tx, pocketType, pocketId, allocationMode, null);
  if (params.amount > currentAmount) {
    throw new BadRequestException(`Solde disponible insuffisant (${currentAmount} DH) pour retirer ${params.amount} DH`);
  }
  const date = params.date ?? new Date();
  return tx.pocketMovement.create({
    data: {
      pocketType,
      ...pocketWhere(pocketType, pocketId),
      plannedDate: date,
      plannedAmount: params.amount,
      actualDate: date,
      actualAmount: params.amount,
      status: 'confirme',
      movementType: 'retrait',
      intentionLabel: params.intentionLabel,
      recordedByUserId: params.recordedByUserId,
    },
  });
}

/** Confirmation d'une contribution planifiée (§17) — jamais automatique à la date prévue (RG-000). */
export async function confirmPocketMovement(tx: TxClient, movementId: string, actualDate?: Date, actualAmount?: number) {
  const movement = await tx.pocketMovement.findFirst({ where: { id: movementId } });
  if (!movement) throw new NotFoundException('Mouvement introuvable');
  if (movement.status === 'confirme') throw new BadRequestException('Ce mouvement est déjà confirmé');
  if (movement.status === 'annule') throw new BadRequestException('Ce mouvement est annulé');
  return tx.pocketMovement.update({
    where: { id: movementId },
    data: {
      status: 'confirme',
      actualDate: actualDate ?? new Date(),
      actualAmount: actualAmount ?? toNumber(movement.plannedAmount),
    },
  });
}
