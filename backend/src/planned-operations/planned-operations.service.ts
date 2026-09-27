import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OperationKind, Prisma } from '@prisma/client';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { insertFinancialOperation } from '../common/ledger/ledger.util';

export interface CreatePlannedOperationInput {
  kind: 'EXPENSE' | 'INCOME' | 'SAVINGS_CONTRIBUTION';
  label: string;
  expectedDate: string;
  expectedAmount: string;
  categoryId?: string;
  recurrenceRuleId?: string;
  financialPlanItemId?: string;
  financialPlanDeadlineId?: string;
  sourceAccountId?: string;
  sourceSubaccountId?: string;
  destinationAccountId?: string;
  destinationSubaccountId?: string;
}

@Injectable()
export class PlannedOperationsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreatePlannedOperationInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      try {
        return await tx.plannedOperation.create({
          data: {
            householdId,
            kind: dto.kind,
            label: dto.label,
            expectedDate: new Date(dto.expectedDate),
            expectedAmount: new Prisma.Decimal(dto.expectedAmount),
            categoryId: dto.categoryId,
            recurrenceRuleId: dto.recurrenceRuleId,
            financialPlanItemId: dto.financialPlanItemId,
            financialPlanDeadlineId: dto.financialPlanDeadlineId,
            sourceAccountId: dto.sourceAccountId,
            sourceSubaccountId: dto.sourceSubaccountId,
            destinationAccountId: dto.destinationAccountId,
            destinationSubaccountId: dto.destinationSubaccountId,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('Une échéance existe déjà pour cette règle de récurrence à cette date');
        }
        throw err;
      }
    });
  }

  async list(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      return tx.plannedOperation.findMany({ where: { householdId }, orderBy: { expectedDate: 'asc' } });
    });
  }

  /** Réalise une échéance prévue : crée la financial_operation réelle (montant possiblement différent) et clôt le prévu. */
  async realize(userId: string, householdId: string, id: string, dto: { actualAmount: string; actualDate?: string; label?: string }) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const planned = await tx.plannedOperation.findUnique({ where: { id } });
      if (!planned || planned.householdId !== householdId) throw new NotFoundException('Échéance prévue introuvable');
      if (planned.status !== 'PENDING') throw new BadRequestException('Cette échéance a déjà été réalisée ou annulée');

      const operation = await insertFinancialOperation(tx, {
        householdId,
        createdByUserId: userId,
        kind: planned.kind as unknown as OperationKind,
        label: dto.label ?? planned.label,
        date: dto.actualDate ? new Date(dto.actualDate) : planned.expectedDate,
        amount: new Prisma.Decimal(dto.actualAmount),
        categoryId: planned.categoryId,
        sourceAccountId: planned.sourceAccountId,
        sourceSubaccountId: planned.sourceSubaccountId,
        destinationAccountId: planned.destinationAccountId,
        destinationSubaccountId: planned.destinationSubaccountId,
      });

      await tx.plannedOperation.update({
        where: { id },
        data: { status: 'REALIZED', realizedOperationId: operation.id },
      });

      return operation;
    });
  }

  async cancel(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const planned = await tx.plannedOperation.findUnique({ where: { id } });
      if (!planned || planned.householdId !== householdId) throw new NotFoundException('Échéance prévue introuvable');
      if (planned.status !== 'PENDING') throw new BadRequestException('Cette échéance a déjà été réalisée ou annulée');
      return tx.plannedOperation.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
  }
}
