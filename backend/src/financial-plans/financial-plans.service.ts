import { Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { computeDeadlineSummary, pickNextDeadline } from '../common/ledger/financial-plan.util';

export interface CreateFinancialPlanInput {
  label: string;
  items?: { label: string }[];
  deadlines?: { label: string; dueDate: string }[];
}

@Injectable()
export class FinancialPlansService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateFinancialPlanInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      return tx.financialPlan.create({
        data: {
          householdId,
          label: dto.label,
          items: dto.items ? { create: dto.items.map((i) => ({ label: i.label })) } : undefined,
          deadlines: dto.deadlines ? { create: dto.deadlines.map((d) => ({ label: d.label, dueDate: new Date(d.dueDate) })) } : undefined,
        },
        include: { items: true, deadlines: true },
      });
    });
  }

  /**
   * Liste des plans avec, pour chacun, la prochaine échéance et son résumé
   * (besoin/disponible/reste/recommandation) — dérivés des planned_operations,
   * jamais stockés (cf. financial-plan.util.ts).
   */
  async list(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const plans = await tx.financialPlan.findMany({
        where: { householdId },
        include: {
          items: true,
          deadlines: { include: { plannedOperations: { include: { realizedOperation: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const now = new Date();
      return plans.map((plan) => {
        const deadlineSummaries = plan.deadlines.map((d) => computeDeadlineSummary(d, now));
        const nextDeadline = pickNextDeadline(plan.deadlines, now);
        const nextDeadlineSummary = nextDeadline ? deadlineSummaries.find((s) => s.deadlineId === nextDeadline.id) ?? null : null;
        return {
          id: plan.id,
          label: plan.label,
          items: plan.items.map((i) => ({ id: i.id, label: i.label })),
          deadlines: deadlineSummaries,
          nextDeadline: nextDeadlineSummary,
        };
      });
    });
  }

  async getOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const plan = await tx.financialPlan.findUnique({
        where: { id },
        include: {
          items: true,
          deadlines: { include: { plannedOperations: { include: { realizedOperation: true } } } },
        },
      });
      if (!plan || plan.householdId !== householdId) throw new NotFoundException('Plan financier introuvable');

      const now = new Date();
      const deadlineSummaries = plan.deadlines.map((d) => computeDeadlineSummary(d, now));
      return {
        id: plan.id,
        label: plan.label,
        items: plan.items.map((i) => ({ id: i.id, label: i.label })),
        deadlines: deadlineSummaries,
      };
    });
  }
}
