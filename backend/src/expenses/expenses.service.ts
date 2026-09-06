import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { getAccountBalance } from '../common/ledger/ledger.util';
import { VariableBudgetsService } from '../variable-budgets/variable-budgets.service';
import { CreateExpenseDto } from './dto/create-expense.dto';

/**
 * Dépenses réelles (docs/02-modele-metier.md §E.4, §2/§6/§7/§8 de la demande
 * Lot 3). Le rattachement à un VariableBudget actif est automatique quand un
 * seul candidat existe ; jamais deviné silencieusement s'il y en a plusieurs
 * (§8) ; jamais de ChargePlan/Deadline créés pour une dépense ordinaire (§2).
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly rlsContext: RlsContextService,
    private readonly variableBudgets: VariableBudgetsService,
  ) {}

  async create(userId: string, householdId: string, dto: CreateExpenseDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const account = await tx.financialAccount.findFirst({ where: { id: dto.accountId, householdId } });
      if (!account) throw new NotFoundException('Compte introuvable dans ce foyer');

      const spentDate = dto.spentDate ? new Date(dto.spentDate) : new Date();

      // Vague 2 §1/§4 : hiérarchie Catégorie → Type → Sous-type validée à l'écriture —
      // un type doit appartenir à la catégorie indiquée, un sous-type à ce type précis.
      if (dto.categoryTypeId) {
        const type = await tx.categoryType.findFirst({ where: { id: dto.categoryTypeId } });
        if (!type) throw new NotFoundException('Type introuvable dans ce foyer');
        if (dto.categoryId && type.categoryId !== dto.categoryId) {
          throw new BadRequestException('Ce type ne correspond pas à la catégorie indiquée');
        }
      }
      if (dto.categorySubtypeId) {
        if (!dto.categoryTypeId) throw new BadRequestException('Un sous-type requiert un type');
        const subtype = await tx.categorySubtype.findFirst({ where: { id: dto.categorySubtypeId } });
        if (!subtype) throw new NotFoundException('Sous-type introuvable dans ce foyer');
        if (subtype.categoryTypeId !== dto.categoryTypeId) {
          throw new BadRequestException('Ce sous-type ne correspond pas au type indiqué');
        }
      }

      let variableBudgetId = dto.variableBudgetId;
      if (variableBudgetId) {
        const budget = await tx.variableBudget.findFirst({ where: { id: variableBudgetId, householdId } });
        if (!budget) throw new NotFoundException('Budget introuvable dans ce foyer');
        if (dto.categoryId && budget.categoryId !== dto.categoryId) {
          throw new BadRequestException('Ce budget ne correspond pas à la catégorie indiquée');
        }
      } else if (dto.categoryId) {
        const candidates = await this.variableBudgets.findActiveBudgetsOnTx(tx, householdId, dto.categoryId, spentDate);
        if (candidates.length > 1) {
          throw new ConflictException({
            message: 'Plusieurs budgets actifs correspondent à cette catégorie — précisez variableBudgetId',
            candidates: candidates.map((c) => ({ id: c.id, referenceAmount: c.referenceAmount, referencePeriod: c.referencePeriod })),
          });
        }
        if (candidates.length === 1) variableBudgetId = candidates[0].id;
      }

      if (variableBudgetId) {
        const expense = await tx.budgetExpense.create({
          data: {
            variableBudgetId,
            amount: dto.amount,
            spentDate,
            categoryId: dto.categoryId,
            categoryTypeId: dto.categoryTypeId,
            categorySubtypeId: dto.categorySubtypeId,
            accountId: dto.accountId,
            recordedById: userId,
            notes: dto.notes,
          },
        });
        const budgetStatus = await this.variableBudgets.getBudgetStatusOnTx(tx, householdId, variableBudgetId, spentDate);
        return {
          kind: 'budget_expense' as const,
          expense,
          soldeCourant: await getAccountBalance(tx, dto.accountId),
          budgetStatus,
        };
      }

      const expense = await tx.adHocExpense.create({
        data: {
          householdId,
          amount: dto.amount,
          spentDate,
          categoryId: dto.categoryId,
          categoryTypeId: dto.categoryTypeId,
          categorySubtypeId: dto.categorySubtypeId,
          accountId: dto.accountId,
          recordedById: userId,
          notes: dto.notes,
        },
      });
      return {
        kind: 'adhoc_expense' as const,
        expense,
        soldeCourant: await getAccountBalance(tx, dto.accountId),
      };
    });
  }
}
