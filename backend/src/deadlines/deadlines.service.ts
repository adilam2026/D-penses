import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { getDeadlineBalance } from '../common/ledger/ledger.util';
import { recalcFinancialStatus } from '../common/ledger/deadline-status.util';
import { UpdateDeadlineDto } from './dto/update-deadline.dto';

/**
 * Deadline (docs/02-modele-metier.md §F.2, E.3). reste_a_payer (RG-016) est
 * toujours lu depuis la vue deadline_with_balance — jamais recalculé ici.
 */
@Injectable()
export class DeadlinesService {
  constructor(private readonly rlsContext: RlsContextService) {}

  private async withBalance(tx: ReturnType<RlsContextService['getClient']>, id: string) {
    const deadline = await tx.deadline.findFirst({ where: { id } });
    if (!deadline) throw new NotFoundException('Échéance introuvable');
    const balance = await getDeadlineBalance(tx, id);
    return { ...deadline, resteAPayer: balance?.resteAPayer ?? null };
  }

  async findOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, () => this.withBalance(this.rlsContext.getClient(), id));
  }

  /**
   * Échéances encore ouvertes du foyer, toutes charges confondues — utilisé par
   * la saisie rapide « Paiement d'une échéance » (Lot 3 §2) pour choisir une
   * Deadline EXISTANTE, jamais en créer une artificiellement pour une dépense.
   */
  async findAllOpen(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const rows = await tx.deadline.findMany({
        where: { financialStatus: { in: ['ouverte', 'partiellement_payee'] }, chargePlan: { householdId } },
        include: { chargePlan: true },
        orderBy: { dueDate: 'asc' },
      });
      return Promise.all(
        rows.map(async (r) => {
          const balance = await getDeadlineBalance(tx, r.id);
          return { ...r, resteAPayer: balance?.resteAPayer ?? null };
        }),
      );
    });
  }

  /**
   * Révision (§11) : report de due_date (RG-020bis) et/ou révision du montant
   * (RG-104 — conserve amount_initial_estimated, horodate confirmed_at au
   * passage vers "confirmé"). reste_a_payer se recalcule automatiquement sur
   * le nouveau montant puisqu'il n'est jamais stocké (RG-016).
   */
  async update(userId: string, householdId: string, id: string, dto: UpdateDeadlineDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const deadline = await tx.deadline.findFirst({ where: { id } });
      if (!deadline) throw new NotFoundException('Échéance introuvable');
      if (deadline.financialStatus === 'annulee') {
        throw new BadRequestException('Une échéance annulée ne peut plus être modifiée');
      }

      const data: Record<string, unknown> = {};
      if (dto.dueDate !== undefined) data.dueDate = new Date(dto.dueDate); // report — pas un changement de statut (RG-020bis)
      if (dto.expectedBillingDate !== undefined) data.expectedBillingDate = new Date(dto.expectedBillingDate);
      if (dto.billingDate !== undefined) data.billingDate = new Date(dto.billingDate);

      if (dto.amountStatus !== undefined || dto.amountCurrent !== undefined) {
        const newStatus = dto.amountStatus ?? deadline.amountStatus;
        if (newStatus === 'inconnu') {
          if (dto.amountCurrent !== undefined) {
            throw new BadRequestException('amount_current doit être absent quand amount_status = inconnu (RG-102/103)');
          }
          data.amountCurrent = null;
        } else {
          const newAmount = dto.amountCurrent ?? (deadline.amountCurrent !== null ? Number(deadline.amountCurrent) : undefined);
          if (newAmount === undefined) {
            throw new BadRequestException('amount_current est obligatoire sauf si amount_status = inconnu');
          }
          if (newStatus === 'confirme' && deadline.amountStatus !== 'confirme') {
            data.amountInitialEstimated =
              deadline.amountInitialEstimated ?? (deadline.amountStatus === 'estime' ? deadline.amountCurrent : null);
            data.confirmedAt = new Date();
          }
          data.amountCurrent = newAmount;
        }
        data.amountStatus = newStatus;
      }

      // §12.B (RG-116bis/IF-29) : refuser toute baisse de amount_current qui rendrait la
      // ventilation déjà enregistrée supérieure au nouveau montant — jamais silencieusement
      // acceptée. Vérification applicative (message propre) en plus du trigger DB (filet).
      if (data.amountCurrent !== undefined && data.amountCurrent !== null) {
        const allocated = await tx.deadlineChildAllocation.aggregate({
          where: { deadlineId: id },
          _sum: { allocationAmount: true },
        });
        const totalAllocated = allocated._sum.allocationAmount ? Number(allocated._sum.allocationAmount) : 0;
        if (totalAllocated > (data.amountCurrent as number)) {
          throw new BadRequestException(
            `Nouveau montant (${data.amountCurrent} DH) inférieur à la ventilation déjà enregistrée (${totalAllocated} DH) — corrigez la ventilation avant de baisser le montant (RG-116bis)`,
          );
        }
      }

      await tx.deadline.update({ where: { id }, data });
      await recalcFinancialStatus(tx, id); // ex. montant revu à la hausse après clôture (RG-016bis)
      return this.withBalance(tx, id);
    });
  }

  /**
   * Confirmation explicite de clôture (RG-014) — la seule action qui fait passer
   * à "soldée". Le simple fait d'atteindre reste_a_payer = 0 ne suffit jamais.
   */
  async close(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const deadline = await tx.deadline.findFirst({ where: { id } });
      if (!deadline) throw new NotFoundException('Échéance introuvable');
      if (deadline.financialStatus === 'annulee') throw new BadRequestException('Échéance annulée');
      if (deadline.financialStatus === 'soldee') throw new BadRequestException('Échéance déjà soldée');

      const balance = await getDeadlineBalance(tx, id);
      if (!balance || balance.resteAPayer === null) {
        throw new BadRequestException('Montant inconnu — impossible de clôturer (RG-103)');
      }
      if (balance.resteAPayer > 0) {
        throw new BadRequestException(`reste_a_payer = ${balance.resteAPayer} — ne peut pas être soldée tant qu'il reste un montant dû`);
      }

      await tx.deadline.update({ where: { id }, data: { financialStatus: 'soldee' } });
      return this.withBalance(tx, id);
    });
  }

  /**
   * Annulation (§12) — exclut immédiatement l'échéance des besoins futurs ;
   * les Payment déjà enregistrés restent historisés, jamais supprimés.
   */
  async cancel(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const deadline = await tx.deadline.findFirst({ where: { id } });
      if (!deadline) throw new NotFoundException('Échéance introuvable');
      if (deadline.financialStatus === 'soldee' || deadline.financialStatus === 'annulee') {
        throw new BadRequestException('Une échéance soldée ou déjà annulée ne peut pas être annulée');
      }
      await tx.deadline.update({ where: { id }, data: { financialStatus: 'annulee' } });
      return this.withBalance(tx, id);
    });
  }
}
