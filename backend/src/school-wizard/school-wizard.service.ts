import { Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { SchoolWizardDto } from './dto/school-wizard.dto';
import { createAlreadyPaidDeadline } from '../common/ledger/already-paid.util';

/**
 * Assistant « Ajouter les frais scolaires » (§17) — crée en une seule action un
 * FinancialPlan et, pour chaque étape non ignorée par l'utilisateur, un
 * ChargePlan + une Deadline (obligatoire par défaut, garderie en
 * optionnelle_envisagée sauf indication contraire — §19, aucune entité
 * « Garderie » dédiée). Une étape « Je ne connais pas encore » produit
 * amount_status = inconnu, jamais 0 (§4/§17).
 */
@Injectable()
export class SchoolWizardService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: SchoolWizardDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();

      const childCount = await tx.child.count({ where: { id: { in: dto.childIds }, householdId } });
      if (childCount !== dto.childIds.length) throw new NotFoundException('Un ou plusieurs enfants sont introuvables dans ce foyer');

      const plan = await tx.financialPlan.create({
        data: {
          householdId,
          label: dto.label,
          planType: 'school',
          periodStart: new Date(dto.periodStart),
          periodEnd: new Date(dto.periodEnd),
        },
      });

      for (const childId of dto.childIds) {
        await tx.financialPlanBeneficiary.create({
          data: { financialPlanId: plan.id, beneficiaryType: 'child', childId },
        });
      }

      const chargePlans = [];
      for (const item of dto.items) {
        const childIds = item.childIds?.length ? item.childIds : dto.childIds;
        const isGarderie = item.label.toLowerCase().includes('garderie');
        const obligationStatus = item.obligationStatus ?? (isGarderie ? 'optionnelle_envisagee' : 'obligatoire');
        const amountStatus = item.amount === null || item.amount === undefined ? 'inconnu' : 'estime';

        const isPeriodic = item.recurrenceRule && item.recurrenceRule !== 'ponctuel';

        const chargePlan = await tx.chargePlan.create({
          data: {
            householdId,
            label: item.label,
            generationMode: isPeriodic ? 'auto_frequence' : 'calendrier_manuel',
            recurrenceRule: item.recurrenceRule,
            obligationStatus,
            financialPlanId: plan.id,
            // Ancre de la récurrence = la date de CE poste, jamais periodStart du plan
            // entier (des postes différents peuvent avoir des périodicités différentes).
            startDate: isPeriodic ? new Date(item.dueDate) : new Date(dto.periodStart),
            endDate: new Date(dto.periodEnd),
            children: { create: childIds.map((childId) => ({ childId })) },
          },
        });

        if (item.alreadyPaid) {
          if (item.alreadyPaid.accountId) {
            const account = await tx.financialAccount.findFirst({ where: { id: item.alreadyPaid.accountId, householdId } });
            if (!account) throw new NotFoundException('Compte introuvable dans ce foyer');
          }
          await createAlreadyPaidDeadline(tx, chargePlan.id, new Date(item.dueDate), userId, {
            amount: item.alreadyPaid.amount,
            paidDate: new Date(item.alreadyPaid.paidDate),
            accountId: item.alreadyPaid.accountId,
          });
        } else {
          await tx.deadline.create({
            data: {
              chargePlanId: chargePlan.id,
              dueDate: new Date(item.dueDate),
              amountCurrent: amountStatus === 'inconnu' ? null : item.amount,
              amountStatus,
            },
          });
        }

        chargePlans.push(chargePlan);
      }

      return { financialPlan: plan, chargePlans };
    });
  }
}
