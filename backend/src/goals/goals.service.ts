import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { round2, toNumber } from '../common/ledger/ledger.util';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { CreateGoalContributionDto } from './dto/create-goal-contribution.dto';
import { ConfirmContributionDto } from './dto/confirm-contribution.dto';

type TxClient = ReturnType<RlsContextService['getClient']>;

/**
 * Goal / GoalContribution (docs/02-modele-metier.md §E.6, RG-040→042, §320). Aucun
 * moteur de recommandation avancé ici (Lot 8, hors périmètre — §23/25) : la seule
 * progression exposée est purement descriptive (déjà constitué / reste / %).
 * « Déjà mis de côté » = Σ GoalContribution CONFIRMÉES (RG-000) — jamais une
 * contribution prévue, jamais auto-confirmée à sa date (§16/24).
 */
@Injectable()
export class GoalsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateGoalDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      if (dto.linkedPocketId) {
        const pocket = await tx.savingsPocket.findFirst({ where: { id: dto.linkedPocketId, householdId } });
        if (!pocket) throw new NotFoundException('Poche introuvable dans ce foyer');
      }
      const goal = await tx.goal.create({
        data: {
          householdId,
          label: dto.label,
          targetAmount: dto.targetAmount,
          targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
          priorityLevel: dto.priorityLevel ?? 1,
          linkedPocketId: dto.linkedPocketId,
        },
      });
      return this.detailOnTx(tx, goal.id);
    });
  }

  async findAll(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const goals = await tx.goal.findMany({ where: { householdId }, orderBy: { createdAt: 'asc' } });
      return Promise.all(goals.map((g) => this.detailOnTx(tx, g.id)));
    });
  }

  async findOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const goal = await tx.goal.findFirst({ where: { id, householdId } });
      if (!goal) throw new NotFoundException('Objectif introuvable');
      return this.detailOnTx(tx, id);
    });
  }

  private async detailOnTx(tx: TxClient, id: string) {
    const goal = await tx.goal.findUniqueOrThrow({ where: { id } });
    const contributions = await tx.goalContribution.findMany({ where: { goalId: id } });
    let savedAmount = 0;
    for (const c of contributions) {
      if (c.status === 'confirme') savedAmount += toNumber(c.actualAmount);
    }
    savedAmount = round2(savedAmount);
    const targetAmount = toNumber(goal.targetAmount);
    const remainingToConstitute = round2(Math.max(targetAmount - savedAmount, 0));
    const progressPercent = targetAmount > 0 ? round2(Math.min((savedAmount / targetAmount) * 100, 100)) : 0;
    return { ...goal, savedAmount, remainingToConstitute, progressPercent };
  }

  async update(userId: string, householdId: string, id: string, dto: UpdateGoalDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const goal = await tx.goal.findFirst({ where: { id, householdId } });
      if (!goal) throw new NotFoundException('Objectif introuvable');
      if (dto.linkedPocketId) {
        const pocket = await tx.savingsPocket.findFirst({ where: { id: dto.linkedPocketId, householdId } });
        if (!pocket) throw new NotFoundException('Poche introuvable dans ce foyer');
      }
      await tx.goal.update({
        where: { id },
        data: {
          label: dto.label,
          targetAmount: dto.targetAmount,
          targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
          priorityLevel: dto.priorityLevel,
          linkedPocketId: dto.linkedPocketId,
          status: dto.status,
        },
      });
      return this.detailOnTx(tx, id);
    });
  }

  async addContribution(userId: string, householdId: string, id: string, dto: CreateGoalContributionDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const goal = await tx.goal.findFirst({ where: { id, householdId } });
      if (!goal) throw new NotFoundException('Objectif introuvable');

      const confirmed = dto.confirmed ?? false;
      const contribution = await tx.goalContribution.create({
        data: {
          goalId: id,
          plannedDate: new Date(dto.plannedDate),
          plannedAmount: dto.plannedAmount,
          actualDate: confirmed ? new Date(dto.actualDate ?? dto.plannedDate) : undefined,
          actualAmount: confirmed ? (dto.actualAmount ?? dto.plannedAmount) : undefined,
          status: confirmed ? 'confirme' : 'prevu',
          recordedByUserId: userId,
        },
      });
      return { contribution, goal: await this.detailOnTx(tx, id) };
    });
  }

  async listContributions(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const goal = await tx.goal.findFirst({ where: { id, householdId } });
      if (!goal) throw new NotFoundException('Objectif introuvable');
      return tx.goalContribution.findMany({ where: { goalId: id }, orderBy: { plannedDate: 'desc' } });
    });
  }

  /** §24/RG-000 : seule action qui rend réelle une contribution planifiée — jamais automatique à la date prévue. */
  async confirmContribution(userId: string, householdId: string, contributionId: string, dto: ConfirmContributionDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const contribution = await tx.goalContribution.findFirst({ where: { id: contributionId } });
      if (!contribution) throw new NotFoundException('Contribution introuvable');
      if (contribution.status === 'confirme') throw new BadRequestException('Cette contribution est déjà confirmée');
      if (contribution.status === 'annule') throw new BadRequestException('Cette contribution est annulée');
      const updated = await tx.goalContribution.update({
        where: { id: contributionId },
        data: {
          status: 'confirme',
          actualDate: dto.actualDate ? new Date(dto.actualDate) : new Date(),
          actualAmount: dto.actualAmount ?? toNumber(contribution.plannedAmount),
        },
      });
      return { contribution: updated, goal: await this.detailOnTx(tx, contribution.goalId) };
    });
  }
}
