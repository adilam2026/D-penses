import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { CreateAllocationDto } from './dto/create-allocation.dto';

/**
 * deadline_child_allocation (docs/02-modele-metier.md §E.3quater, RG-116/116bis).
 * Purement informative pour les vues par enfant — ne crée jamais une deuxième
 * Deadline/Payment/LedgerEntry (§11). Le plafond Σ allocation ≤ amount_current
 * est vérifié ici (message propre) ET par un trigger DB (filet de sécurité).
 */
@Injectable()
export class DeadlineAllocationsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, deadlineId: string, dto: CreateAllocationDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const deadline = await tx.deadline.findFirst({ where: { id: deadlineId } });
      if (!deadline) throw new NotFoundException('Échéance introuvable');

      const child = await tx.child.findFirst({ where: { id: dto.childId, householdId } });
      if (!child) throw new NotFoundException('Enfant introuvable dans ce foyer');

      // RG-116bis (§12.A) : refus si la ventilation dépasserait amount_current — jamais deviné/tronqué silencieusement.
      if (deadline.amountCurrent !== null) {
        const existing = await tx.deadlineChildAllocation.aggregate({
          where: { deadlineId, childId: { not: dto.childId } }, // exclut une éventuelle ligne déjà existante pour cet enfant (upsert)
          _sum: { allocationAmount: true },
        });
        const alreadyAllocated = existing._sum.allocationAmount ? Number(existing._sum.allocationAmount) : 0;
        const projectedTotal = alreadyAllocated + dto.allocationAmount;
        if (projectedTotal > Number(deadline.amountCurrent)) {
          throw new BadRequestException(
            `Ventilation (${projectedTotal} DH) supérieure au montant de l'échéance (${deadline.amountCurrent} DH) — RG-116bis`,
          );
        }
      }

      return tx.deadlineChildAllocation.upsert({
        where: { deadlineId_childId: { deadlineId, childId: dto.childId } },
        create: { deadlineId, childId: dto.childId, allocationAmount: dto.allocationAmount },
        update: { allocationAmount: dto.allocationAmount },
      });
    });
  }

  async findAll(userId: string, householdId: string, deadlineId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const deadline = await tx.deadline.findFirst({ where: { id: deadlineId } });
      if (!deadline) throw new NotFoundException('Échéance introuvable');
      return tx.deadlineChildAllocation.findMany({ where: { deadlineId }, include: { child: true } });
    });
  }
}
