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
  /** Ajouter > "Remboursable par mutuelle ?" (§11/§10 maquette) — crée le medical_claim dans la même transaction. */
  createMedicalClaim?: boolean;
}

@Injectable()
export class FinancialOperationsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateFinancialOperationInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const operation = await insertFinancialOperation(tx, {
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

      if (dto.createMedicalClaim && dto.kind === 'EXPENSE') {
        await tx.medicalClaim.create({
          data: {
            householdId,
            sourceOperationId: operation.id,
            subaccountId: dto.sourceSubaccountId ?? null,
            label: dto.label,
            amountEngaged: operation.amount,
          },
        });
      }

      return operation;
    });
  }

  async list(userId: string, householdId: string, filters?: { accountId?: string; subaccountId?: string }) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const where: Prisma.FinancialOperationWhereInput = { householdId };
      if (filters?.subaccountId) {
        where.OR = [{ sourceSubaccountId: filters.subaccountId }, { destinationSubaccountId: filters.subaccountId }];
      } else if (filters?.accountId) {
        where.OR = [{ sourceAccountId: filters.accountId }, { destinationAccountId: filters.accountId }];
      }
      return tx.financialOperation.findMany({
        where,
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
