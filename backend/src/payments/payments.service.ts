import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { getAccountBalance, getDeadlineBalance } from '../common/ledger/ledger.util';
import { recalcFinancialStatus } from '../common/ledger/deadline-status.util';
import { computePocketCurrentAmount } from '../common/ledger/provision.util';
import { withdrawFromPocket } from '../common/ledger/pocket-movements.util';
import { CreatePaymentDto } from './dto/create-payment.dto';

/**
 * Payment (docs/02-modele-metier.md §E.3, RG-015). amount toujours > 0, le
 * signe comptable (impact sur reste_a_payer ET sur solde_courant) est déduit
 * du type par le moteur — jamais saisi, jamais recopié : les deux vues
 * (deadline_with_balance, ledger_entry) portent chacune la seule copie de
 * leur propre formule de signe (IF-20, les deux ne sont jamais confondues).
 *
 * funding_source = provision (RG-095/§18-21 Lot 6) : « Payer avec Provision » reste
 * une opération atomique unique, toujours dans la MÊME transaction rlsContext.run —
 * Payment + PocketMovement retrait (si virtual_allocation) + recalcul du statut
 * financier, jamais d'état intermédiaire incohérent (§18/TEST 12).
 */
@Injectable()
export class PaymentsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, deadlineId: string, dto: CreatePaymentDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const deadline = await tx.deadline.findFirst({ where: { id: deadlineId } });
      if (!deadline) throw new NotFoundException('Échéance introuvable');
      if (deadline.financialStatus === 'annulee') {
        throw new BadRequestException('Impossible d\'enregistrer un paiement sur une échéance annulée');
      }

      // §19 : un compte physique réel reste TOUJOURS obligatoire, même funding_source=provision
      // (une Provision n'est jamais un compte bancaire) — l'UX peut le pré-remplir, jamais l'omettre.
      const account = await tx.financialAccount.findFirst({ where: { id: dto.accountId, householdId } });
      if (!account) throw new NotFoundException('Compte introuvable dans ce foyer');

      const type = dto.type ?? 'paiement';
      if (type === 'ajustement' && !dto.direction) {
        throw new BadRequestException('direction est obligatoire pour un ajustement (RG-015)');
      }
      if (type !== 'ajustement' && dto.direction) {
        throw new BadRequestException('direction est réservé aux paiements de type ajustement (RG-015)');
      }
      const fundingSource = dto.fundingSource ?? 'compte';

      if (fundingSource === 'provision') {
        if (!dto.provisionId) throw new BadRequestException('provisionId est requis quand fundingSource = provision (RG-095)');
        const provision = await tx.provision.findFirst({ where: { id: dto.provisionId, householdId } });
        if (!provision) throw new NotFoundException('Provision introuvable dans ce foyer');
        if (deadline.provisionId !== provision.id) {
          throw new BadRequestException("Cette Provision n'est pas liée à cette échéance (RG-095) — liez-la d'abord");
        }
        if (provision.allocationMode === 'backed_by_account' && provision.linkedAccountId !== dto.accountId) {
          throw new BadRequestException('Une provision backed_by_account ne peut être payée que depuis son compte dédié (RG-095.3)');
        }

        const currentAmount = await computePocketCurrentAmount(tx, 'provision', provision.id, provision.allocationMode, provision.linkedAccountId);
        if (dto.amount > currentAmount) {
          // §21 : jamais un solde de poche négatif silencieux — refus propre avec le montant disponible indiqué.
          throw new BadRequestException(
            `Provision insuffisante : ${currentAmount} DH disponibles pour financer ${dto.amount} DH — réduisez le montant ou complétez avec un second paiement depuis un compte (RG-096)`,
          );
        }
      } else if (dto.provisionId) {
        throw new BadRequestException('provisionId est réservé à fundingSource = provision');
      }

      const payment = await tx.payment.create({
        data: {
          deadlineId,
          amount: dto.amount,
          paidDate: dto.paidDate ? new Date(dto.paidDate) : new Date(),
          accountId: dto.accountId,
          type,
          direction: dto.direction,
          fundingSource,
          provisionId: fundingSource === 'provision' ? dto.provisionId : undefined,
          recordedById: userId,
          notes: dto.notes,
        },
      });

      // RG-095.2 : virtual_allocation → retrait PocketMovement du même montant, dans la même
      // transaction — jamais l'un sans l'autre (IF-19). RG-095.3 : backed_by_account → rien de
      // plus, le solde baisse naturellement via G.1 (le Payment débite déjà linkedAccountId).
      if (fundingSource === 'provision' && dto.provisionId) {
        const provision = await tx.provision.findUniqueOrThrow({ where: { id: dto.provisionId } });
        if (provision.allocationMode === 'virtual_allocation') {
          await withdrawFromPocket(tx, 'provision', provision.id, provision.allocationMode, {
            amount: dto.amount,
            date: payment.paidDate,
            intentionLabel: `Paiement ${deadlineId}`,
            recordedByUserId: userId,
          });
        }
      }

      const updatedDeadline = await recalcFinancialStatus(tx, deadlineId);
      const balance = await getDeadlineBalance(tx, deadlineId);

      return {
        payment,
        deadline: { ...updatedDeadline, resteAPayer: balance?.resteAPayer ?? null },
        soldeCourant: await getAccountBalance(tx, dto.accountId),
      };
    });
  }

  async listByDeadline(userId: string, householdId: string, deadlineId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const deadline = await tx.deadline.findFirst({ where: { id: deadlineId } });
      if (!deadline) throw new NotFoundException('Échéance introuvable');
      return tx.payment.findMany({ where: { deadlineId }, orderBy: { paidDate: 'asc' } });
    });
  }
}
