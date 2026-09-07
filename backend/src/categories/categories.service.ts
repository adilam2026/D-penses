import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { CreateCategoryDto } from './dto/create-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly rlsContext: RlsContextService) {}

  /** Catégories système (household_id NULL) + catégories propres au foyer (document 02 §31). */
  async findAll(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, () =>
      this.rlsContext.getClient().category.findMany({
        where: { OR: [{ householdId: null }, { householdId }] },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      }),
    );
  }

  async create(userId: string, householdId: string, dto: CreateCategoryDto) {
    return this.rlsContext.run(userId, householdId, () =>
      this.rlsContext.getClient().category.create({
        data: { householdId, name: dto.name, icon: dto.icon, kind: dto.kind, isSystem: false },
      }),
    );
  }

  /**
   * R5 clôture §3 — sécuriser la suppression : jamais une suppression brutale
   * qui casserait une référence utilisée par des données financières réelles
   * (historique). Comptée à travers toute la hiérarchie (Catégorie directe ET
   * ses Types, puisque Category→CategoryType est en CASCADE côté base — un
   * DELETE ici supprimerait aussi silencieusement des Types eux-mêmes utilisés).
   * Refus explicite plutôt qu'une désactivation (aucun champ `active` sur
   * Category aujourd'hui — l'ajouter sortirait du périmètre schéma de cette
   * clôture) : les anciennes transactions gardent alors leur catégorie intacte.
   */
  async remove(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const category = await tx.category.findFirst({ where: { id } });
      if (!category) throw new NotFoundException('Catégorie introuvable');
      if (category.isSystem || category.householdId !== householdId) {
        throw new ForbiddenException('Impossible de supprimer une catégorie système ou hors de votre foyer');
      }

      const [incomeSources, chargePlans, variableBudgets, adhocDirect, budgetDirect, adhocViaType, budgetViaType] = await Promise.all([
        tx.incomeSource.count({ where: { categoryId: id } }),
        tx.chargePlan.count({ where: { categoryId: id } }),
        tx.variableBudget.count({ where: { categoryId: id } }),
        tx.adHocExpense.count({ where: { categoryId: id } }),
        tx.budgetExpense.count({ where: { categoryId: id } }),
        tx.adHocExpense.count({ where: { categoryType: { categoryId: id } } }),
        tx.budgetExpense.count({ where: { categoryType: { categoryId: id } } }),
      ]);
      const usageCount = incomeSources + chargePlans + variableBudgets + adhocDirect + budgetDirect + adhocViaType + budgetViaType;
      if (usageCount > 0) {
        throw new BadRequestException(
          `Cette catégorie est utilisée par ${usageCount} élément(s) (revenus, charges, budgets ou dépenses réelles) — suppression impossible pour préserver l'historique financier.`,
        );
      }

      await tx.category.delete({ where: { id } });
    });
  }
}
