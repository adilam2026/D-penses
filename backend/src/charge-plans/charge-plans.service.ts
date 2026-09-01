import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { CreateChargePlanDto } from './dto/create-charge-plan.dto';
import { CreateDeadlineDto } from './dto/create-deadline.dto';
import { UpdateChargePlanDto } from './dto/update-charge-plan.dto';

/**
 * ChargePlan (docs/02-modele-metier.md §C.4). Deux modes de génération partagent le
 * même modèle sans refonte (Lot 2 auto_frequence, Lot 4 calendrier_manuel, §2) : les
 * Deadline sont toujours créées explicitement via createDeadline, jamais générées
 * automatiquement par un job, quel que soit le mode.
 */
@Injectable()
export class ChargePlansService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateChargePlanDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      if (dto.defaultAccountId) {
        const account = await tx.financialAccount.findFirst({ where: { id: dto.defaultAccountId, householdId } });
        if (!account) throw new NotFoundException('Compte par défaut introuvable dans ce foyer');
      }
      if (dto.financialPlanId) {
        const plan = await tx.financialPlan.findFirst({ where: { id: dto.financialPlanId, householdId } });
        if (!plan) throw new NotFoundException('FinancialPlan introuvable dans ce foyer');
      }
      if (dto.childIds?.length) {
        const count = await tx.child.count({ where: { id: { in: dto.childIds }, householdId } });
        if (count !== dto.childIds.length) throw new NotFoundException('Un ou plusieurs enfants sont introuvables dans ce foyer');
      }

      return tx.chargePlan.create({
        data: {
          householdId,
          label: dto.label,
          categoryId: dto.categoryId,
          generationMode: dto.generationMode ?? 'auto_frequence',
          recurrenceRule: dto.recurrenceRule,
          defaultAccountId: dto.defaultAccountId,
          obligationStatus: dto.obligationStatus ?? 'obligatoire',
          financialPlanId: dto.financialPlanId,
          startDate: new Date(dto.startDate),
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          priorityLevel: dto.priorityLevel ?? 1,
          children: dto.childIds?.length ? { create: dto.childIds.map((childId) => ({ childId })) } : undefined,
        },
        include: { children: true },
      });
    });
  }

  async findAll(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, () =>
      this.rlsContext.getClient().chargePlan.findMany({ where: { householdId }, orderBy: { createdAt: 'desc' }, include: { children: true } }),
    );
  }

  /** §6 : transition explicite d'obligation_status (ex. envisagée → souscrite/refusée) ; §9 : rattachement FinancialPlan. */
  async update(userId: string, householdId: string, id: string, dto: UpdateChargePlanDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      await this.assertOwned(tx, id, householdId);

      if (dto.financialPlanId) {
        const plan = await tx.financialPlan.findFirst({ where: { id: dto.financialPlanId, householdId } });
        if (!plan) throw new NotFoundException('FinancialPlan introuvable dans ce foyer');
      }

      return tx.chargePlan.update({
        where: { id },
        data: {
          obligationStatus: dto.obligationStatus,
          financialPlanId: dto.financialPlanId === undefined ? undefined : dto.financialPlanId,
        },
        include: { children: true },
      });
    });
  }

  private async assertOwned(tx: ReturnType<RlsContextService['getClient']>, id: string, householdId: string) {
    const chargePlan = await tx.chargePlan.findFirst({ where: { id, householdId } });
    if (!chargePlan) throw new NotFoundException('Plan de charge introuvable');
    return chargePlan;
  }

  /**
   * Crée une Deadline rattachée au plan. RG-102/103 : amount_current est NULL
   * si et seulement si amount_status = inconnu — jamais 0 dans ce cas.
   */
  async createDeadline(userId: string, householdId: string, chargePlanId: string, dto: CreateDeadlineDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      await this.assertOwned(tx, chargePlanId, householdId);

      const amountStatus = dto.amountStatus ?? (dto.amountCurrent !== undefined ? 'estime' : 'inconnu');
      if (amountStatus === 'inconnu') {
        if (dto.amountCurrent !== undefined) {
          throw new BadRequestException('amount_current doit être absent quand amount_status = inconnu (RG-102/103)');
        }
      } else if (dto.amountCurrent === undefined) {
        throw new BadRequestException('amount_current est obligatoire sauf si amount_status = inconnu');
      }

      return tx.deadline.create({
        data: {
          chargePlanId,
          dueDate: new Date(dto.dueDate),
          expectedBillingDate: dto.expectedBillingDate ? new Date(dto.expectedBillingDate) : undefined,
          billingDate: dto.billingDate ? new Date(dto.billingDate) : undefined,
          amountCurrent: amountStatus === 'inconnu' ? null : dto.amountCurrent,
          amountStatus,
          confirmedAt: amountStatus === 'confirme' ? new Date() : undefined,
        },
      });
    });
  }

  async listDeadlines(userId: string, householdId: string, chargePlanId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      await this.assertOwned(tx, chargePlanId, householdId);
      return tx.deadline.findMany({ where: { chargePlanId }, orderBy: { dueDate: 'asc' } });
    });
  }
}
