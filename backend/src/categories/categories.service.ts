import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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

  async remove(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const category = await tx.category.findFirst({ where: { id } });
      if (!category) throw new NotFoundException('Catégorie introuvable');
      if (category.isSystem || category.householdId !== householdId) {
        throw new ForbiddenException('Impossible de supprimer une catégorie système ou hors de votre foyer');
      }
      await tx.category.delete({ where: { id } });
    });
  }
}
