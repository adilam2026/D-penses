import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { CreateCategorySubtypeDto } from './dto/create-category-subtype.dto';
import { UpdateCategorySubtypeDto } from './dto/update-category-subtype.dto';

/** Vague 2 §1/§2/§3 — Sous-type, rattaché à un Type (jamais directement à une Catégorie). */
@Injectable()
export class CategorySubtypesService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, categoryTypeId: string, dto: CreateCategorySubtypeDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const type = await tx.categoryType.findFirst({ where: { id: categoryTypeId } });
      if (!type) throw new NotFoundException('Type introuvable');
      return tx.categorySubtype.create({ data: { categoryTypeId, householdId, name: dto.name, isSystem: false } });
    });
  }

  async update(userId: string, householdId: string, id: string, dto: UpdateCategorySubtypeDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const subtype = await tx.categorySubtype.findFirst({ where: { id } });
      if (!subtype) throw new NotFoundException('Sous-type introuvable');
      if (subtype.isSystem || subtype.householdId !== householdId) {
        throw new ForbiddenException('Impossible de modifier un sous-type système ou hors de votre foyer');
      }
      return tx.categorySubtype.update({ where: { id }, data: { name: dto.name, active: dto.active } });
    });
  }
}
