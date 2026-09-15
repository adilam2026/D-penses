import { Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { CreateHousingDto } from './dto/create-housing.dto';

/** M8 — référentiel logement ultra-simple (guard-rail §2) : nom uniquement. */
@Injectable()
export class HousingService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateHousingDto) {
    return this.rlsContext.run(userId, householdId, () =>
      this.rlsContext.getClient().housing.create({ data: { householdId, name: dto.name } }),
    );
  }

  async findAll(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, () =>
      this.rlsContext.getClient().housing.findMany({ where: { householdId, status: 'active' }, orderBy: { createdAt: 'asc' } }),
    );
  }

  async findOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const housing = await this.rlsContext.getClient().housing.findFirst({ where: { id, householdId } });
      if (!housing) throw new NotFoundException('Logement introuvable');
      return housing;
    });
  }
}
