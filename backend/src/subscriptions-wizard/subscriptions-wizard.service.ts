import { Injectable } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { SubscriptionsWizardDto } from './dto/subscriptions-wizard.dto';
import { createWizardPoste, openEndedPeriod } from '../common/ledger/plan-wizard.util';

/**
 * Assistant « Plan Abonnements » (M8, guard-rail §12) — même patron que
 * VehicleWizard/HousingWizard, MAIS sans référentiel d'entité (le Plan
 * Abonnements est une vue regroupée pure, jamais un moteur financier dédié).
 */
@Injectable()
export class SubscriptionsWizardService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: SubscriptionsWizardDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();

      const { periodStart, periodEnd } = openEndedPeriod();
      const plan = await tx.financialPlan.create({
        data: {
          householdId,
          label: dto.label,
          planType: 'subscriptions',
          periodStart,
          periodEnd,
        },
      });

      const chargePlans = [];
      for (const item of dto.items) {
        const { chargePlan } = await createWizardPoste(tx, { householdId, financialPlanId: plan.id, item });
        chargePlans.push(chargePlan);
      }

      return { financialPlan: plan, chargePlans };
    });
  }
}
