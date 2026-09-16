import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { HousingWizardDto } from './dto/housing-wizard.dto';
import { createWizardPoste, findDuplicateEntityPlan, openEndedPeriod } from '../common/ledger/plan-wizard.util';

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

      // Corrections UI/UX (point 3) — un logement EXISTANT sélectionné (jamais un
      // logement tout juste créé par nom) peut déjà avoir un plan actif.
      if (dto.housingId && !dto.confirmDuplicate) {
        const duplicate = await findDuplicateEntityPlan(tx, householdId, { planType: 'housing', housingId: dto.housingId });
        if (duplicate) {
          throw new ConflictException({
            statusCode: 409,
            message: `Un plan existe déjà pour ${housing.name}.`,
            existingPlanId: duplicate.id,
          });
        }
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
