import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsContextService } from '../common/prisma/rls-context.service';

type TxClient = Prisma.TransactionClient;

export const DEFAULT_FALLBACK_CATEGORY_NAME = 'Autres';

/** Auto-seed de la catégorie "Autres" — appelé à la création d'un foyer. Jamais dupliquée, jamais supprimable. */
export async function seedDefaultFallbackCategory(tx: TxClient, householdId: string): Promise<void> {
  await tx.category.create({
    data: { householdId, name: DEFAULT_FALLBACK_CATEGORY_NAME, isDefaultFallback: true, sortOrder: 9999 },
  });
}

/** "Autres" obligatoire (Checkpoint 3) : id de la catégorie de repli du foyer. */
export async function resolveFallbackCategoryId(tx: TxClient, householdId: string): Promise<string | null> {
  const fallback = await tx.category.findFirst({ where: { householdId, isDefaultFallback: true } });
  return fallback?.id ?? null;
}

@Injectable()
export class CategoriesService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async list(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      return tx.category.findMany({ where: { householdId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    });
  }

  async create(userId: string, householdId: string, name: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      return tx.category.create({ data: { householdId, name } });
    });
  }

  async update(userId: string, householdId: string, id: string, data: { name?: string; sortOrder?: number; active?: boolean }) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const category = await tx.category.findUnique({ where: { id } });
      if (!category || category.householdId !== householdId) throw new NotFoundException('Catégorie introuvable');
      if (category.isDefaultFallback && data.active === false) {
        throw new BadRequestException('"Autres" ne peut jamais être désactivée');
      }
      return tx.category.update({ where: { id }, data });
    });
  }

  /** Jamais de suppression réelle : "Autres" absorbe toujours l'historique — ici, simple désactivation. */
  async archive(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const category = await tx.category.findUnique({ where: { id } });
      if (!category || category.householdId !== householdId) throw new NotFoundException('Catégorie introuvable');
      if (category.isDefaultFallback) throw new BadRequestException('"Autres" ne peut jamais être supprimée');
      return tx.category.update({ where: { id }, data: { active: false } });
    });
  }
}
