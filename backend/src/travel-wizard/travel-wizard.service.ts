import { Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { TravelWizardDto } from './dto/travel-wizard.dto';

/**
 * Assistant « Voyage » (§39/40/41 cadrage V1, Lot 11 §5 — Option B validée) — crée
 * en une seule transaction un FinancialPlan (plan_type=travel) et, pour chaque
 * poste, un ChargePlan + une Deadline (obligatoire par défaut, generationMode
 * calendrier_manuel — un voyage a des postes ponctuels, jamais périodiques).
 * Calqué sur SchoolWizardService (même transaction atomique, même convention
 * amount null → inconnu) mais SANS obligation d'enfants : un voyage n'est pas
 * nécessairement rattaché à un enfant en particulier.
 */
@Injectable()
export class TravelWizardService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: TravelWizardDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();

      if (dto.linkedProvisionId) {
        const provision = await tx.provision.findFirst({ where: { id: dto.linkedProvisionId, householdId } });
        if (!provision) throw new NotFoundException('Enveloppe (provision) introuvable dans ce foyer');
      }

      const plan = await tx.financialPlan.create({
        data: {
          householdId,
          label: dto.label,
          planType: 'travel',
          destination: dto.destination,
          periodStart: new Date(dto.periodStart),
          periodEnd: new Date(dto.periodEnd),
          linkedProvisionId: dto.linkedProvisionId,
        },
      });

      // M7+M8 (guard-rail §13) — participants : réutilise EXCLUSIVEMENT
      // FinancialPlanBeneficiary (déjà user|child, déjà exposé via
      // GET .../beneficiaries), même validation que addBeneficiary — jamais un
      // nouveau modèle « participant » dédié au voyage.
      for (const userId2 of dto.participantUserIds ?? []) {
        const membership = await tx.householdMembership.findFirst({ where: { userId: userId2, householdId } });
        if (!membership) throw new NotFoundException("Cet utilisateur n'appartient pas à ce foyer");
        await tx.financialPlanBeneficiary.create({ data: { financialPlanId: plan.id, beneficiaryType: 'user', userId: userId2 } });
      }
      for (const childId of dto.participantChildIds ?? []) {
        const child = await tx.child.findFirst({ where: { id: childId, householdId } });
        if (!child) throw new NotFoundException("Cet enfant n'appartient pas à ce foyer");
        await tx.financialPlanBeneficiary.create({ data: { financialPlanId: plan.id, beneficiaryType: 'child', childId } });
      }

      const chargePlans = [];
      for (const item of dto.items) {
        const amountStatus = item.amount === null || item.amount === undefined ? 'inconnu' : 'estime';

        const chargePlan = await tx.chargePlan.create({
          data: {
            householdId,
            label: item.label,
            generationMode: 'calendrier_manuel',
            obligationStatus: 'obligatoire',
            financialPlanId: plan.id,
            startDate: new Date(dto.periodStart),
            endDate: new Date(dto.periodEnd),
          },
        });

        await tx.deadline.create({
          data: {
            chargePlanId: chargePlan.id,
            dueDate: new Date(item.dueDate),
            amountCurrent: amountStatus === 'inconnu' ? null : item.amount,
            amountStatus,
          },
        });

        chargePlans.push(chargePlan);
      }

      return { financialPlan: plan, chargePlans };
    });
  }
}
