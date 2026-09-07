import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { getAccountBalance, toNumber } from '../common/ledger/ledger.util';
import { VariableBudgetsService } from '../variable-budgets/variable-budgets.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseMetadataDto } from './dto/update-expense-metadata.dto';
import { CorrectExpenseDto } from './dto/correct-expense.dto';

type TxClient = ReturnType<RlsContextService['getClient']>;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

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
      // R5 clôture §2 — jamais une NOUVELLE dépense sur un compte archivé.
      if (account.status !== 'actif') {
        throw new BadRequestException(`Le compte « ${account.name} » est archivé — réactivez-le pour l'utiliser`);
      }

      const spentDate = dto.spentDate ? new Date(dto.spentDate) : new Date();

      await this.validateCategoryHierarchy(tx, dto.categoryId, dto.categoryTypeId, dto.categorySubtypeId);

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

  private async validateCategoryHierarchy(tx: TxClient, categoryId?: string, categoryTypeId?: string, categorySubtypeId?: string) {
    // Vague 2 §1/§4 : hiérarchie Catégorie → Type → Sous-type validée à l'écriture —
    // un type doit appartenir à la catégorie indiquée, un sous-type à ce type précis.
    if (categoryTypeId) {
      const type = await tx.categoryType.findFirst({ where: { id: categoryTypeId } });
      if (!type) throw new NotFoundException('Type introuvable dans ce foyer');
      if (categoryId && type.categoryId !== categoryId) {
        throw new BadRequestException('Ce type ne correspond pas à la catégorie indiquée');
      }
    }
    if (categorySubtypeId) {
      if (!categoryTypeId) throw new BadRequestException('Un sous-type requiert un type');
      const subtype = await tx.categorySubtype.findFirst({ where: { id: categorySubtypeId } });
      if (!subtype) throw new NotFoundException('Sous-type introuvable dans ce foyer');
      if (subtype.categoryTypeId !== categoryTypeId) {
        throw new BadRequestException('Ce sous-type ne correspond pas au type indiqué');
      }
    }
  }

  /**
   * R5 clôture §1 — « Modifier » une dépense réelle : uniquement la description
   * (catégorie/type/sous-type/notes), jamais amount/accountId/spentDate — ces
   * champs ont déjà produit un effet réel sur le solde (cf. Corriger/Annuler).
   * Fonctionne pour les deux natures de dépense (adhoc_expense/budget_expense) :
   * la description n'a aucun impact sur le suivi de consommation du budget.
   */
  async updateMetadata(userId: string, householdId: string, kind: string, id: string, dto: UpdateExpenseMetadataDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      await this.validateCategoryHierarchy(tx, dto.categoryId, dto.categoryTypeId, dto.categorySubtypeId);

      const data = { categoryId: dto.categoryId, categoryTypeId: dto.categoryTypeId, categorySubtypeId: dto.categorySubtypeId, notes: dto.notes };
      if (kind === 'adhoc_expense') {
        const existing = await tx.adHocExpense.findFirst({ where: { id, householdId } });
        if (!existing) throw new NotFoundException('Dépense introuvable');
        return tx.adHocExpense.update({ where: { id }, data });
      }
      if (kind === 'budget_expense') {
        const existing = await tx.budgetExpense.findFirst({ where: { id, variableBudget: { householdId } } });
        if (!existing) throw new NotFoundException('Dépense introuvable');
        return tx.budgetExpense.update({ where: { id }, data });
      }
      throw new BadRequestException(`Type de dépense inconnu : ${kind}`);
    });
  }

  /**
   * R5 clôture §1 — « Corriger » une dépense ponctuelle (montant mal saisi) :
   * jamais une réécriture de l'AdHocExpense original — un Adjustment(type=
   * correction) signé porte le delta sur le même compte, remonte automatiquement
   * dans le solde/la trésorerie/la projection via ledger_entry (branche `adjustment`,
   * aucun moteur modifié). Réservée à adhoc_expense : une budget_expense est
   * suivie par une agrégation indépendante (consommé du budget variable) qu'un
   * Adjustment ne corrigerait pas — corriger son montant sortirait du périmètre
   * sûr de cette clôture (nécessiterait de toucher variable-budgets.service).
   */
  async correctAdhoc(userId: string, householdId: string, id: string, dto: CorrectExpenseDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const original = await tx.adHocExpense.findFirst({ where: { id, householdId } });
      if (!original) throw new NotFoundException('Dépense introuvable');

      const originalAmount = toNumber(original.amount);
      const delta = round2(originalAmount - dto.correctedAmount);
      if (delta === 0) throw new BadRequestException('Le montant corrigé est identique au montant déjà enregistré');

      const adjustment = await tx.adjustment.create({
        data: {
          accountId: original.accountId,
          amount: delta,
          reason: `Correction de la dépense du ${original.spentDate.toISOString().slice(0, 10)} (${originalAmount} DH → ${dto.correctedAmount} DH)`,
          type: 'correction',
          createdById: userId,
        },
      });

      return { adjustment, soldeCourant: await getAccountBalance(tx, original.accountId) };
    });
  }

  /**
   * R5 clôture §1 — « Annuler » une dépense ponctuelle entièrement erronée :
   * jamais une suppression physique — un Adjustment(type=correction) crédite
   * intégralement le compte, l'AdHocExpense original reste visible en historique
   * (les deux écritures apparaissent dans Transactions, pleinement auditable).
   */
  async reverseAdhoc(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const original = await tx.adHocExpense.findFirst({ where: { id, householdId } });
      if (!original) throw new NotFoundException('Dépense introuvable');

      const adjustment = await tx.adjustment.create({
        data: {
          accountId: original.accountId,
          amount: toNumber(original.amount),
          reason: `Annulation de la dépense du ${original.spentDate.toISOString().slice(0, 10)}`,
          type: 'correction',
          createdById: userId,
        },
      });

      return { adjustment, soldeCourant: await getAccountBalance(tx, original.accountId) };
    });
  }
}
