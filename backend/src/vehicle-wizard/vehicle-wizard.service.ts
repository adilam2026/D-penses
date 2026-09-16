import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { VehicleWizardDto } from './dto/vehicle-wizard.dto';
import { createWizardPoste, findDuplicateEntityPlan, openEndedPeriod } from '../common/ledger/plan-wizard.util';

/**
 * Assistant « Plan Voiture » (M7) — crée en une seule transaction un
 * FinancialPlan (planType=vehicle, vehicleId), pour chaque poste sélectionné un
 * ChargePlan + Deadline (guard-rail §17 : réutilise EXCLUSIVEMENT ChargePlan/
 * Deadline/le moteur de récurrence existant, jamais un moteur parallèle).
 * Sélectionne un véhicule existant OU en crée un (nom uniquement, guard-rail §1).
 */
@Injectable()
export class VehicleWizardService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: VehicleWizardDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();

      let vehicle;
      if (dto.vehicleId) {
        vehicle = await tx.vehicle.findFirst({ where: { id: dto.vehicleId, householdId } });
        if (!vehicle) throw new NotFoundException('Véhicule introuvable dans ce foyer');
      } else if (dto.vehicleName) {
        vehicle = await tx.vehicle.create({ data: { householdId, name: dto.vehicleName } });
      } else {
        throw new BadRequestException('vehicleId ou vehicleName requis');
      }

      // Corrections UI/UX (point 3) — un véhicule EXISTANT sélectionné (jamais un
      // véhicule tout juste créé par nom) peut déjà avoir un plan actif.
      if (dto.vehicleId && !dto.confirmDuplicate) {
        const duplicate = await findDuplicateEntityPlan(tx, householdId, { planType: 'vehicle', vehicleId: dto.vehicleId });
        if (duplicate) {
          throw new ConflictException({
            statusCode: 409,
            message: `Un plan existe déjà pour ${vehicle.name}.`,
            existingPlanId: duplicate.id,
          });
        }
      }

      const { periodStart, periodEnd } = openEndedPeriod();
      const plan = await tx.financialPlan.create({
        data: {
          householdId,
          label: `Voiture · ${vehicle.name}`,
          planType: 'vehicle',
          vehicleId: vehicle.id,
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
          vehicleId: vehicle.id,
        });
        chargePlans.push(chargePlan);
      }

      return { financialPlan: plan, vehicle, chargePlans };
    });
  }
}
