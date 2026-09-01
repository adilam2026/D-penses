import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { getAccountBalance, getDeadlineBalance } from '../common/ledger/ledger.util';
import { recalcFinancialStatus } from '../common/ledger/deadline-status.util';
import { CreatePaymentDto } from './dto/create-payment.dto';

/**
 * Payment (docs/02-modele-metier.md §E.3, RG-015). amount toujours > 0, le
 * signe comptable (impact sur reste_a_payer ET sur solde_courant) est déduit
 * du type par le moteur — jamais saisi, jamais recopié : les deux vues
 * (deadline_with_balance, ledger_entry) portent chacune la seule copie de
 * leur propre formule de signe (IF-20, les deux ne sont jamais confondues).
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
        throw new BadRequestException('funding_source = provision sera implémenté au Lot 6 — utilisez "compte" pour ce lot (RG-095)');
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
          recordedById: userId,
          notes: dto.notes,
        },
      });

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
