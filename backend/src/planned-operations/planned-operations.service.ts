import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OperationKind, Prisma } from '@prisma/client';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { insertFinancialOperation } from '../common/ledger/ledger.util';
import { ensurePlannedOccurrences } from '../common/ledger/recurrence.util';
import { resolveFallbackCategoryId } from '../categories/categories.service';

export interface UpdatePlannedOperationInput {
  expectedAmount?: string;
  expectedDate?: string;
  label?: string;
  categoryId?: string;
  sourceAccountId?: string;
  sourceSubaccountId?: string;
  destinationAccountId?: string;
  destinationSubaccountId?: string;
}

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
        const categoryId = dto.categoryId ?? (dto.kind === 'EXPENSE' ? await resolveFallbackCategoryId(tx, householdId) : undefined);
        return await tx.plannedOperation.create({
          data: {
            householdId,
            kind: dto.kind,
            label: dto.label,
            expectedDate: new Date(dto.expectedDate),
            expectedAmount: new Prisma.Decimal(dto.expectedAmount),
            categoryId: categoryId ?? undefined,
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
      // Fenêtre glissante toujours à jour (même logique que Planning) — sinon
      // "À faire" (Accueil) peut rester figé si l'utilisateur n'ouvre jamais Planning.
      await ensurePlannedOccurrences(tx, householdId);
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

  /**
   * Modifier UNE occurrence (appui long sur une case encore prévue, ou édition
   * ciblée) — ex. Internet d'octobre 350 -> 420. Ne touche jamais la règle de
   * récurrence source ni les autres occurrences ; refuse si l'occurrence n'est
   * plus PENDING (cf. §modification d'une occurrence).
   */
  async update(userId: string, householdId: string, id: string, dto: UpdatePlannedOperationInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const planned = await tx.plannedOperation.findUnique({ where: { id } });
      if (!planned || planned.householdId !== householdId) throw new NotFoundException('Échéance prévue introuvable');
      if (planned.status !== 'PENDING') throw new BadRequestException('Cette échéance a déjà été réalisée ou annulée');

      return tx.plannedOperation.update({
        where: { id },
        data: {
          expectedAmount: dto.expectedAmount !== undefined ? new Prisma.Decimal(dto.expectedAmount) : undefined,
          expectedDate: dto.expectedDate !== undefined ? new Date(dto.expectedDate) : undefined,
          label: dto.label,
          categoryId: dto.categoryId,
          sourceAccountId: dto.sourceAccountId,
          sourceSubaccountId: dto.sourceSubaccountId,
          destinationAccountId: dto.destinationAccountId,
          destinationSubaccountId: dto.destinationSubaccountId,
        },
      });
    });
  }

  /**
   * Annuler un paiement déjà réalisé (appui long sur une case verte, "Annuler
   * le paiement") — utilise exclusivement le mécanisme de renversement déjà
   * validé (reversalOfOperationId) : NE supprime JAMAIS la transaction
   * d'origine, crée une contre-écriture, et remet l'occurrence à PENDING avec
   * son montant prévu d'origine (le montant réel réalisé est perdu, comme
   * pour toute annulation — l'occurrence redevient une échéance à réaliser).
   */
  async unrealize(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const planned = await tx.plannedOperation.findUnique({ where: { id } });
      if (!planned || planned.householdId !== householdId) throw new NotFoundException('Échéance prévue introuvable');
      if (planned.status !== 'REALIZED' || !planned.realizedOperationId) {
        throw new BadRequestException("Cette échéance n'est pas réalisée, impossible de l'annuler");
      }

      const original = await tx.financialOperation.findUnique({ where: { id: planned.realizedOperationId } });
      if (!original || original.householdId !== householdId) throw new NotFoundException('Transaction réalisée introuvable');

      await insertFinancialOperation(tx, {
        householdId,
        createdByUserId: userId,
        kind: original.kind,
        label: `Annulation — ${original.label}`,
        date: new Date(),
        amount: original.amount,
        categoryId: original.categoryId,
        sourceAccountId: original.sourceAccountId,
        sourceSubaccountId: original.sourceSubaccountId,
        destinationAccountId: original.destinationAccountId,
        destinationSubaccountId: original.destinationSubaccountId,
        reversalOfOperationId: original.id,
        reversalReason: 'Annulation depuis le Planning',
      });

      return tx.plannedOperation.update({
        where: { id },
        data: { status: 'PENDING', realizedOperationId: null },
      });
    });
  }
}
