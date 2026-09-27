import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { computeAccountBalance, computeSubaccountBalance } from '../common/ledger/ledger.util';

export interface CreateGoalInput {
  accountId?: string;
  subaccountId?: string;
  targetAmount: string;
  targetDate?: string;
  label?: string;
}

@Injectable()
export class GoalsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateGoalInput) {
    if (!dto.accountId && !dto.subaccountId) throw new BadRequestException('Un objectif doit être lié à un compte ou un sous-compte');
    if (dto.accountId && dto.subaccountId) throw new BadRequestException('Un objectif est lié à un compte OU un sous-compte, jamais les deux');

    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      return tx.goal.create({
        data: {
          householdId,
          accountId: dto.accountId,
          subaccountId: dto.subaccountId,
          targetAmount: new Prisma.Decimal(dto.targetAmount),
          targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
          label: dto.label,
        },
      });
    });
  }

  /** current/pourcentage toujours dérivés du solde réel — jamais un montant "épargné" stocké séparément. */
  async list(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const goals = await tx.goal.findMany({ where: { householdId }, orderBy: { createdAt: 'desc' } });
      return Promise.all(
        goals.map(async (goal) => {
          const current = goal.subaccountId
            ? (await computeSubaccountBalance(tx, goal.subaccountId)).toNumber()
            : (await computeAccountBalance(tx, goal.accountId!)).toNumber();
          const target = goal.targetAmount.toNumber();
          const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
          return { ...goal, targetAmount: target, current, percent };
        }),
      );
    });
  }

  async remove(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const goal = await tx.goal.findUnique({ where: { id } });
      if (!goal || goal.householdId !== householdId) throw new NotFoundException('Objectif introuvable');
      await tx.goal.delete({ where: { id } });
      return { deleted: true };
    });
  }
}
