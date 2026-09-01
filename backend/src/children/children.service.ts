import { Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

@Injectable()
export class ChildrenService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateChildDto) {
    return this.rlsContext.run(userId, householdId, () =>
      this.rlsContext.getClient().child.create({
        data: {
          householdId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
          schoolName: dto.schoolName,
          schoolClass: dto.schoolClass,
          schoolYear: dto.schoolYear,
        },
      }),
    );
  }

  async findAll(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, () =>
      this.rlsContext.getClient().child.findMany({ where: { householdId }, orderBy: { createdAt: 'asc' } }),
    );
  }

  async findOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const child = await this.rlsContext.getClient().child.findFirst({ where: { id, householdId } });
      if (!child) throw new NotFoundException('Enfant introuvable');
      return child;
    });
  }

  // H-06 (document 02) : jamais de suppression d'un enfant, seulement un passage à `inactive`.
  async update(userId: string, householdId: string, id: string, dto: UpdateChildDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const existing = await tx.child.findFirst({ where: { id, householdId } });
      if (!existing) throw new NotFoundException('Enfant introuvable');
      return tx.child.update({
        where: { id },
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
          schoolName: dto.schoolName,
          schoolClass: dto.schoolClass,
          schoolYear: dto.schoolYear,
          status: dto.status,
        },
      });
    });
  }
}
