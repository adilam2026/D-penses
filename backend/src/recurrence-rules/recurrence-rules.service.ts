import { Injectable } from '@nestjs/common';
import { RecurrenceFrequency } from '@prisma/client';
import { RlsContextService } from '../common/prisma/rls-context.service';

@Injectable()
export class RecurrenceRulesService {
  constructor(private readonly rlsContext: RlsContextService) {}

  /** Ajouter > Type=Récurrente (§11 maquette) — la règle elle-même, jamais une occurrence (cf. schéma). */
  async create(userId: string, householdId: string, dto: { frequency: RecurrenceFrequency; anchorDate: string; label?: string }) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      return tx.recurrenceRule.create({
        data: { householdId, frequency: dto.frequency, anchorDate: new Date(dto.anchorDate), label: dto.label },
      });
    });
  }

  async list(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      return tx.recurrenceRule.findMany({ where: { householdId }, orderBy: { createdAt: 'desc' } });
    });
  }
}
