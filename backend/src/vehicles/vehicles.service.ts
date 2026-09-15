import { Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';

/** M7 — référentiel véhicule ultra-simple (guard-rail §1) : nom uniquement. */
@Injectable()
export class VehiclesService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateVehicleDto) {
    return this.rlsContext.run(userId, householdId, () =>
      this.rlsContext.getClient().vehicle.create({ data: { householdId, name: dto.name } }),
    );
  }

  async findAll(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, () =>
      this.rlsContext.getClient().vehicle.findMany({ where: { householdId, status: 'active' }, orderBy: { createdAt: 'asc' } }),
    );
  }

  async findOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const vehicle = await this.rlsContext.getClient().vehicle.findFirst({ where: { id, householdId } });
      if (!vehicle) throw new NotFoundException('Véhicule introuvable');
      return vehicle;
    });
  }
}
