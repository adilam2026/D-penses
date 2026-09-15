import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly rlsContext: RlsContextService) {}

  /**
   * Catégories système (household_id NULL) + catégories propres au foyer (document
   * 02 §31), ACTIVES uniquement (corrections UI/UX finales §10) — une catégorie
   * archivée disparaît de cette liste (donc des sélecteurs), jamais des relations
   * déjà existantes (transactions/budgets/charges lisent leur catégorie par
   * relation directe, jamais filtrée par status).
   */
  async findAll(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, () =>
      this.rlsContext.getClient().category.findMany({
        where: { status: 'active', OR: [{ householdId: null }, { householdId }] },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      }),
    );
  }

  /**
   * Corrections UI/UX finales §10 — renommer/changer le type d'une catégorie,
   * y compris une catégorie système (partagée par tous les foyers, comme sa
   * lecture l'est déjà) : jamais bloquée ici pour préserver un écran "impossible
   * à gérer". Reste interdit uniquement pour une catégorie d'un AUTRE foyer.
   */
  async update(userId: string, householdId: string, id: string, dto: UpdateCategoryDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const category = await tx.category.findFirst({ where: { id } });
      if (!category) throw new NotFoundException('Catégorie introuvable');
      if (category.householdId !== null && category.householdId !== householdId) {
        throw new ForbiddenException("Impossible de modifier une catégorie d'un autre foyer");
      }
      return tx.category.update({
        where: { id },
        data: { name: dto.name?.trim(), kind: dto.kind },
      });
    });
  }

  async create(userId: string, householdId: string, dto: CreateCategoryDto) {
    return this.rlsContext.run(userId, householdId, () =>
      this.rlsContext.getClient().category.create({
        data: { householdId, name: dto.name, icon: dto.icon, kind: dto.kind, isSystem: false },
      }),
    );
  }

  /**
   * Corrections UI/UX finales §10 — jamais un refus bloquant pour l'utilisateur :
   * une catégorie non utilisée est réellement supprimée (comportement historique,
   * R5 clôture §3) ; une catégorie déjà utilisée (revenus/charges/budgets/dépenses
   * réelles, y compris via ses CategoryType) est ARCHIVÉE (status=inactive) au
   * lieu d'un hard delete — elle disparaît de findAll() (donc des sélecteurs),
   * jamais de l'historique : aucune relation existante n'est touchée, aucune
   * transaction passée ne perd sa catégorie. Reste interdit uniquement pour une
   * catégorie d'un AUTRE foyer (jamais une catégorie système, désormais gérable
   * comme les autres).
   */
  async remove(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const category = await tx.category.findFirst({ where: { id } });
      if (!category) throw new NotFoundException('Catégorie introuvable');
      if (category.householdId !== null && category.householdId !== householdId) {
        throw new ForbiddenException("Impossible de supprimer une catégorie d'un autre foyer");
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
        await tx.category.update({ where: { id }, data: { status: 'inactive' } });
        return { archived: true };
      }

      await tx.category.delete({ where: { id } });
      return { archived: false };
    });
  }
}
