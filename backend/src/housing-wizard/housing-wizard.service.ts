import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { HousingWizardDto } from './dto/housing-wizard.dto';
import { createWizardPoste, openEndedPeriod } from '../common/ledger/plan-wizard.util';

/**
 * Assistant « Plan Maison » (M8) — même patron EXACT que VehicleWizardService :
 * FinancialPlan(planType=housing, housingId) + ChargePlan/Deadline par poste,
 * jamais un moteur financier parallèle.
 */
@Injectable()
export class HousingWizardService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: HousingWizardDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();

      let housing;
      if (dto.housingId) {
        housing = await tx.housing.findFirst({ where: { id: dto.housingId, householdId } });
        if (!housing) throw new NotFoundException('Logement introuvable dans ce foyer');
      } else if (dto.housingName) {
        housing = await tx.housing.create({ data: { householdId, name: dto.housingName } });
      } else {
        throw new BadRequestException('housingId ou housingName requis');
      }

      const { periodStart, periodEnd } = openEndedPeriod();
      const plan = await tx.financialPlan.create({
        data: {
          householdId,
          label: `Maison · ${housing.name}`,
          planType: 'housing',
          housingId: housing.id,
          periodStart,
          periodEnd,
        },
      });

      const chargePlans = [];
      for (const item of dto.items) {
        const { chargePlan } = await createWizardPoste(tx, {
          householdId,
          financialPlanId: plan.id,
          item,
          housingId: housing.id,
        });
        chargePlans.push(chargePlan);
      }

      return { financialPlan: plan, housing, chargePlans };
    });
  }
}
