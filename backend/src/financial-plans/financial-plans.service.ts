import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecurrenceFrequency } from '@prisma/client';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { computeDeadlineSummary, ensurePlanItemOccurrences, pickNextDeadline } from '../common/ledger/financial-plan.util';
import { computeAccountBalance, computeSubaccountBalance, insertFinancialOperation } from '../common/ledger/ledger.util';

export interface CreateFinancialPlanInput {
  label: string;
  accountId?: string;
  subaccountId?: string;
  items?: { label: string; expectedAmount?: string; frequency?: RecurrenceFrequency }[];
  deadlines?: { label: string; dueDate: string }[];
}

export interface UpdateFinancialPlanInput {
  label?: string;
  accountId?: string;
  subaccountId?: string;
}

export interface CreatePlanItemInput {
  label: string;
  expectedAmount?: string;
  frequency?: RecurrenceFrequency;
}

@Injectable()
export class FinancialPlansService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateFinancialPlanInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const plan = await tx.financialPlan.create({
        data: {
          householdId,
          label: dto.label,
          accountId: dto.accountId,
          subaccountId: dto.subaccountId,
          items: dto.items
            ? { create: dto.items.map((i) => ({ label: i.label, expectedAmount: i.expectedAmount ? new Prisma.Decimal(i.expectedAmount) : undefined, frequency: i.frequency })) }
            : undefined,
          deadlines: dto.deadlines ? { create: dto.deadlines.map((d) => ({ label: d.label, dueDate: new Date(d.dueDate) })) } : undefined,
        },
        include: { items: true, deadlines: true },
      });

      // Peuple immédiatement les échéances déjà créées avec les postes récurrents (§14).
      await ensurePlanItemOccurrences(tx, plan.id);

      return plan;
    });
  }

  async update(userId: string, householdId: string, id: string, dto: UpdateFinancialPlanInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const plan = await tx.financialPlan.findUnique({ where: { id } });
      if (!plan || plan.householdId !== householdId) throw new NotFoundException('Plan financier introuvable');
      return tx.financialPlan.update({
        where: { id },
        data: { label: dto.label, accountId: dto.accountId, subaccountId: dto.subaccountId },
      });
    });
  }

  /** Ajouter un poste au plan (§13/§14) — s'il est récurrent, backfill immédiat sur les échéances déjà créées. */
  async addItem(userId: string, householdId: string, planId: string, dto: CreatePlanItemInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const plan = await tx.financialPlan.findUnique({ where: { id: planId } });
      if (!plan || plan.householdId !== householdId) throw new NotFoundException('Plan financier introuvable');

      const item = await tx.financialPlanItem.create({
        data: {
          planId,
          label: dto.label,
          expectedAmount: dto.expectedAmount ? new Prisma.Decimal(dto.expectedAmount) : undefined,
          frequency: dto.frequency,
        },
      });

      await ensurePlanItemOccurrences(tx, planId);
      return item;
    });
  }

  /** Ajouter une échéance (§13) — backfill immédiat des postes récurrents déjà définis sur cette nouvelle échéance. */
  async addDeadline(userId: string, householdId: string, planId: string, dto: { label: string; dueDate: string }) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const plan = await tx.financialPlan.findUnique({ where: { id: planId } });
      if (!plan || plan.householdId !== householdId) throw new NotFoundException('Plan financier introuvable');

      const deadline = await tx.financialPlanDeadline.create({
        data: { planId, label: dto.label, dueDate: new Date(dto.dueDate) },
      });

      await ensurePlanItemOccurrences(tx, planId);
      return deadline;
    });
  }

  /**
   * "Détail d'une échéance" (§12) — ajoute ou ajuste le montant d'un poste
   * pour CETTE échéance précisément (ex. Frais école 30000 pour Janvier).
   * Idempotent : si la paire (item, échéance) existe déjà et est encore
   * PENDING, met à jour le montant plutôt que d'en créer une seconde.
   */
  async addItemToDeadline(userId: string, householdId: string, deadlineId: string, dto: { itemId: string; amount: string }) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const deadline = await tx.financialPlanDeadline.findUnique({ where: { id: deadlineId }, include: { plan: true } });
      if (!deadline || deadline.plan.householdId !== householdId) throw new NotFoundException('Échéance introuvable');
      const item = await tx.financialPlanItem.findUnique({ where: { id: dto.itemId } });
      if (!item || item.planId !== deadline.planId) throw new NotFoundException('Poste introuvable pour ce plan');

      const existing = await tx.plannedOperation.findFirst({
        where: { financialPlanItemId: item.id, financialPlanDeadlineId: deadline.id },
      });
      if (existing) {
        if (existing.status !== 'PENDING') {
          throw new BadRequestException('Ce poste est déjà réalisé pour cette échéance — annulez le paiement avant de modifier le montant');
        }
        return tx.plannedOperation.update({ where: { id: existing.id }, data: { expectedAmount: new Prisma.Decimal(dto.amount) } });
      }

      return tx.plannedOperation.create({
        data: {
          householdId,
          kind: 'EXPENSE',
          label: item.label,
          expectedAmount: new Prisma.Decimal(dto.amount),
          expectedDate: deadline.dueDate,
          financialPlanItemId: item.id,
          financialPlanDeadlineId: deadline.id,
          sourceAccountId: deadline.plan.accountId ?? undefined,
          sourceSubaccountId: deadline.plan.subaccountId ?? undefined,
        },
      });
    });
  }

  /**
   * "Marquer comme payée" (§12) — réalise en bloc toutes les lignes encore
   * PENDING de cette échéance, chacune pour son montant prévu (pas d'ajustement
   * individuel ici — cf. Planning pour ajuster une ligne précise avant paiement).
   */
  async markDeadlinePaid(userId: string, householdId: string, deadlineId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const deadline = await tx.financialPlanDeadline.findUnique({
        where: { id: deadlineId },
        include: { plan: true, plannedOperations: { where: { status: 'PENDING' } } },
      });
      if (!deadline || deadline.plan.householdId !== householdId) throw new NotFoundException('Échéance introuvable');
      if (deadline.plannedOperations.length === 0) throw new BadRequestException('Aucune ligne à payer pour cette échéance');

      for (const planned of deadline.plannedOperations) {
        const operation = await insertFinancialOperation(tx, {
          householdId,
          createdByUserId: userId,
          kind: planned.kind as 'EXPENSE',
          label: planned.label,
          date: new Date(),
          amount: planned.expectedAmount,
          categoryId: planned.categoryId,
          sourceAccountId: planned.sourceAccountId,
          sourceSubaccountId: planned.sourceSubaccountId,
          destinationAccountId: planned.destinationAccountId,
          destinationSubaccountId: planned.destinationSubaccountId,
        });
        await tx.plannedOperation.update({ where: { id: planned.id }, data: { status: 'REALIZED', realizedOperationId: operation.id } });
      }

      return tx.financialPlanDeadline.findUniqueOrThrow({
        where: { id: deadlineId },
        include: { plannedOperations: { include: { realizedOperation: true } } },
      });
    });
  }

  /**
   * Liste des plans avec, pour chacun, la prochaine échéance et son résumé
   * (besoin/disponible/reste/recommandation) — dérivés des planned_operations,
   * jamais stockés (cf. financial-plan.util.ts). "disponible" du plan = solde
   * réel du compte/sous-compte lié (jamais une projection).
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
      return Promise.all(
        plans.map(async (plan) => {
          const deadlineSummaries = plan.deadlines
            .map((d) => computeDeadlineSummary(d, now))
            .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
          const nextDeadline = pickNextDeadline(plan.deadlines, now);
          const nextDeadlineSummary = nextDeadline ? deadlineSummaries.find((s) => s.deadlineId === nextDeadline.id) ?? null : null;
          const disponibleActuel = plan.subaccountId
            ? (await computeSubaccountBalance(tx, plan.subaccountId)).toNumber()
            : plan.accountId
              ? (await computeAccountBalance(tx, plan.accountId)).toNumber()
              : null;

          return {
            id: plan.id,
            label: plan.label,
            accountId: plan.accountId,
            subaccountId: plan.subaccountId,
            disponibleActuel,
            items: plan.items.map((i) => ({ id: i.id, label: i.label, expectedAmount: i.expectedAmount?.toNumber() ?? null, frequency: i.frequency, active: i.active })),
            deadlines: deadlineSummaries,
            nextDeadline: nextDeadlineSummary,
          };
        }),
      );
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
      const deadlineSummaries = plan.deadlines
        .map((d) => computeDeadlineSummary(d, now))
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
      const disponibleActuel = plan.subaccountId
        ? (await computeSubaccountBalance(tx, plan.subaccountId)).toNumber()
        : plan.accountId
          ? (await computeAccountBalance(tx, plan.accountId)).toNumber()
          : null;

      return {
        id: plan.id,
        label: plan.label,
        accountId: plan.accountId,
        subaccountId: plan.subaccountId,
        disponibleActuel,
        items: plan.items.map((i) => ({ id: i.id, label: i.label, expectedAmount: i.expectedAmount?.toNumber() ?? null, frequency: i.frequency, active: i.active })),
        deadlines: deadlineSummaries,
      };
    });
  }
}
