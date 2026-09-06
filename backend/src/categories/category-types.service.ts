import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { CreateCategoryTypeDto } from './dto/create-category-type.dto';
import { UpdateCategoryTypeDto } from './dto/update-category-type.dto';

/**
 * Vague 2 §1/§2/§3 — Type, rattaché à une Catégorie. household_id NULL = type
 * système partagé (socle §2) ; sinon type propre au foyer (paramétrage §3).
 * Jamais de suppression brutale d'un type déjà utilisé dans une transaction
 * historique : seul "active" contrôle sa disponibilité en saisie (pas de
 * endpoint DELETE ici).
 */
@Injectable()
export class CategoryTypesService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async findAllForCategory(userId: string, householdId: string, categoryId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const category = await tx.category.findFirst({ where: { id: categoryId } });
      if (!category) throw new NotFoundException('Catégorie introuvable');
      return tx.categoryType.findMany({
        where: { categoryId, OR: [{ householdId: null }, { householdId }] },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
        include: { subtypes: { where: { OR: [{ householdId: null }, { householdId }] }, orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] } },
      });
    });
  }

  async create(userId: string, householdId: string, categoryId: string, dto: CreateCategoryTypeDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const category = await tx.category.findFirst({ where: { id: categoryId } });
      if (!category) throw new NotFoundException('Catégorie introuvable');
      return tx.categoryType.create({ data: { categoryId, householdId, name: dto.name, isSystem: false } });
    });
  }

  async update(userId: string, householdId: string, id: string, dto: UpdateCategoryTypeDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const type = await tx.categoryType.findFirst({ where: { id } });
      if (!type) throw new NotFoundException('Type introuvable');
      if (type.isSystem || type.householdId !== householdId) {
        throw new ForbiddenException('Impossible de modifier un type système ou hors de votre foyer');
      }
      return tx.categoryType.update({ where: { id }, data: { name: dto.name, active: dto.active } });
    });
  }
}
