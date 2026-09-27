import { Injectable, NotFoundException } from '@nestjs/common';
import { OperationKind, Prisma } from '@prisma/client';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { insertFinancialOperation } from '../common/ledger/ledger.util';

export interface CreateFinancialOperationInput {
  kind: OperationKind;
  label: string;
  date: string;
  amount: string;
  categoryId?: string;
  sourceAccountId?: string;
  sourceSubaccountId?: string;
  destinationAccountId?: string;
  destinationSubaccountId?: string;
  reversalOfOperationId?: string;
  reversalReason?: string;
}

@Injectable()
export class FinancialOperationsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateFinancialOperationInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      return insertFinancialOperation(tx, {
        householdId,
        createdByUserId: userId,
        kind: dto.kind,
        label: dto.label,
        date: new Date(dto.date),
        amount: new Prisma.Decimal(dto.amount),
        categoryId: dto.categoryId,
        sourceAccountId: dto.sourceAccountId,
        sourceSubaccountId: dto.sourceSubaccountId,
        destinationAccountId: dto.destinationAccountId,
        destinationSubaccountId: dto.destinationSubaccountId,
        reversalOfOperationId: dto.reversalOfOperationId,
        reversalReason: dto.reversalReason,
      });
    });
  }

  async list(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      return tx.financialOperation.findMany({
        where: { householdId },
        orderBy: { date: 'desc' },
        include: { ledgerEntries: true },
      });
    });
  }

  async getOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const operation = await tx.financialOperation.findUnique({ where: { id }, include: { ledgerEntries: true } });
      if (!operation || operation.householdId !== householdId) throw new NotFoundException('Opération introuvable');
      return operation;
    });
  }
}
