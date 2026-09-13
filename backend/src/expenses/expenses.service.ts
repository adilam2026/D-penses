import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { budgetExpenseConsumptionAmount, getAccountBalance, toNumber } from '../common/ledger/ledger.util';
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
        // Lot 2 — priorité explicite (ci-dessus) > type précis > catégorie parente > aucun.
        // Le type précis n'est essayé que si la dépense porte elle-même un categoryTypeId —
        // sans type sur la dépense, impossible de savoir lequel viser, on va directement
        // à la catégorie parente (budgets scopés catégorie uniquement, categoryTypeId NULL).
        let candidates: Awaited<ReturnType<VariableBudgetsService['findActiveBudgetsForScopeOnTx']>> = [];
        if (dto.categoryTypeId) {
          candidates = await this.variableBudgets.findActiveBudgetsForScopeOnTx(tx, householdId, dto.categoryId, dto.categoryTypeId, spentDate);
        }
        if (candidates.length === 0) {
          candidates = await this.variableBudgets.findActiveBudgetsForScopeOnTx(tx, householdId, dto.categoryId, null, spentDate);
        }
        if (candidates.length > 1) {
          throw new ConflictException({
            message: 'Plusieurs budgets actifs correspondent à ce périmètre — précisez variableBudgetId',
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

  /**
   * T3B — « Corriger » une budget_expense (montant mal saisi UNIQUEMENT — un
   * compte/catégorie/budget/date erroné se corrige par Annuler + nouvelle
   * dépense, jamais un déplacement ici). Jamais une réécriture de la ligne
   * originale : une nouvelle ligne (type=ajustement) porte le delta, datée
   * EXACTEMENT comme l'originale (spentDate identique — jamais "maintenant",
   * la consommation est agrégée par fenêtre de période : une contre-écriture
   * datée d'aujourd'hui pourrait tomber dans une autre période que celle
   * corrigée). sourceBudgetExpenseId trace le lien réel (jamais une simple
   * note texte). Solde/consommation/projection recalculés par les mêmes
   * lectures dérivées qu'ailleurs (ledger_entry, getBudgetExpenseConsumption) —
   * aucun moteur dupliqué ici.
   */
  async correctBudget(userId: string, householdId: string, id: string, dto: CorrectExpenseDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const original = await tx.budgetExpense.findFirst({ where: { id, variableBudget: { householdId } } });
      if (!original) throw new NotFoundException('Dépense introuvable');
      if (original.type !== 'depense') {
        throw new BadRequestException('Seule une dépense originale peut être corrigée (jamais une correction/annulation déjà appliquée)');
      }
      const alreadyReversed = await tx.budgetExpense.findFirst({ where: { sourceBudgetExpenseId: id, type: 'remboursement' } });
      if (alreadyReversed) throw new ConflictException('Cette dépense a déjà été annulée — impossible de la corriger');

      const originalAmount = toNumber(original.amount);
      const delta = round2(dto.correctedAmount - originalAmount);
      if (delta === 0) throw new BadRequestException('Le montant corrigé est identique au montant déjà enregistré');
      const direction = delta > 0 ? 'augmente_depense' : 'diminue_depense';

      const correction = await tx.budgetExpense.create({
        data: {
          variableBudgetId: original.variableBudgetId,
          amount: Math.abs(delta),
          spentDate: original.spentDate,
          categoryId: original.categoryId,
          categoryTypeId: original.categoryTypeId,
          categorySubtypeId: original.categorySubtypeId,
          accountId: original.accountId,
          recordedById: userId,
          notes: `Correction de la dépense du ${original.spentDate.toISOString().slice(0, 10)} (${originalAmount} DH → ${dto.correctedAmount} DH)`,
          type: 'ajustement',
          direction,
          sourceBudgetExpenseId: original.id,
        },
      });

      const budgetStatus = await this.variableBudgets.getBudgetStatusOnTx(tx, householdId, original.variableBudgetId, original.spentDate);
      return { correction, budgetStatus, soldeCourant: await getAccountBalance(tx, original.accountId) };
    });
  }

  /**
   * T3B — « Annuler » une budget_expense entièrement erronée : une ligne
   * type=remboursement compense le NET actuellement compté pour cette dépense
   * (l'originale + ses éventuelles corrections déjà appliquées, jamais
   * seulement l'originale — sinon une correction déjà appliquée resterait
   * comptée après l'annulation). Jamais une suppression physique : l'originale
   * et ses corrections restent visibles en historique. Une même dépense
   * originale ne peut jamais être annulée deux fois (garde-fou explicite).
   */
  async reverseBudget(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const original = await tx.budgetExpense.findFirst({ where: { id, variableBudget: { householdId } } });
      if (!original) throw new NotFoundException('Dépense introuvable');
      if (original.type !== 'depense') {
        throw new BadRequestException('Seule une dépense originale peut être annulée');
      }

      const linked = await tx.budgetExpense.findMany({ where: { sourceBudgetExpenseId: id } });
      if (linked.some((l) => l.type === 'remboursement')) {
        throw new ConflictException('Cette dépense a déjà été annulée');
      }

      const net = round2(
        linked.reduce(
          (sum, l) => sum + budgetExpenseConsumptionAmount(l.type, l.direction, toNumber(l.amount)),
          budgetExpenseConsumptionAmount(original.type, original.direction, toNumber(original.amount)),
        ),
      );
      if (net <= 0) throw new BadRequestException('Rien à annuler pour cette dépense');

      const reversal = await tx.budgetExpense.create({
        data: {
          variableBudgetId: original.variableBudgetId,
          amount: net,
          spentDate: original.spentDate,
          categoryId: original.categoryId,
          categoryTypeId: original.categoryTypeId,
          categorySubtypeId: original.categorySubtypeId,
          accountId: original.accountId,
          recordedById: userId,
          notes: `Annulation de la dépense du ${original.spentDate.toISOString().slice(0, 10)}`,
          type: 'remboursement',
          sourceBudgetExpenseId: original.id,
        },
      });

      const budgetStatus = await this.variableBudgets.getBudgetStatusOnTx(tx, householdId, original.variableBudgetId, original.spentDate);
      return { reversal, budgetStatus, soldeCourant: await getAccountBalance(tx, original.accountId) };
    });
  }
}
