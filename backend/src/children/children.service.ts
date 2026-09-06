import { Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { getDeadlineBalance, toNumber } from '../common/ledger/ledger.util';
import { engagementNonCouvert } from '../common/ledger/provision.util';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

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

  /**
   * Vue « Coûts » de la fiche enfant (§16). Une charge à un seul enfant lui est
   * attribuée en totalité ; une charge commune (charge_plan_child à n enfants)
   * n'est comptée dans les totaux que si une deadline_child_allocation existe
   * pour cet enfant — jamais le montant complet chez chacun (anti double
   * comptage visuel), sinon listée séparément comme « charge commune non ventilée ».
   */
  async getCosts(userId: string, householdId: string, childId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const child = await tx.child.findFirst({ where: { id: childId, householdId } });
      if (!child) throw new NotFoundException('Enfant introuvable');

      const chargePlans = await tx.chargePlan.findMany({
        where: {
          householdId,
          obligationStatus: { in: ['obligatoire', 'optionnelle_souscrite'] },
          children: { some: { childId } },
        },
        include: { children: true, deadlines: { include: { childAllocations: true } }, category: true, financialPlan: true },
      });

      let coutConnu = 0;
      let paye = 0;
      let resteAPayer = 0;
      let resteAFinancer = 0;
      const byCategory: Record<string, number> = {};
      const chargesCommunesNonVentilees: Array<{ chargePlanId: string; deadlineId: string; label: string; amount: number }> = [];
      let prochaineEcheance: { deadlineId: string; chargePlanId: string; label: string; dueDate: Date; resteAPayer: number } | null = null;
      const plansAssociesById = new Map<string, { id: string; label: string }>();

      for (const cp of chargePlans) {
        const isSingleChild = cp.children.length === 1;
        if (cp.financialPlan) plansAssociesById.set(cp.financialPlan.id, { id: cp.financialPlan.id, label: cp.financialPlan.label });
        for (const d of cp.deadlines) {
          if (d.financialStatus === 'annulee' || d.amountStatus === 'inconnu') continue;
          const amountCurrent = toNumber(d.amountCurrent);
          const balance = await getDeadlineBalance(tx, d.id);
          const reste = balance?.resteAPayer ?? 0;
          const paid = amountCurrent - reste;

          let attributed: number | null = null;
          if (isSingleChild) {
            attributed = amountCurrent;
          } else {
            const allocation = d.childAllocations.find((a) => a.childId === childId);
            if (allocation) attributed = toNumber(allocation.allocationAmount);
          }

          if (attributed === null) {
            chargesCommunesNonVentilees.push({ chargePlanId: cp.id, deadlineId: d.id, label: cp.label, amount: amountCurrent });
            continue; // jamais compté dans les totaux tant que non ventilé (§16)
          }

          const ratio = amountCurrent > 0 ? attributed / amountCurrent : 0;
          coutConnu += attributed;
          paye += paid * ratio;
          if (d.financialStatus === 'ouverte' || d.financialStatus === 'partiellement_payee') {
            resteAPayer += reste * ratio;
            // Vague 2 §7 : reste_a_financer soustrait la couverture provision déjà en
            // place (RG-090), au prorata de la part attribuée à cet enfant — réutilise
            // exclusivement engagementNonCouvert (provision.util.ts), jamais recalculé.
            let engagementNonCouvertAmount = reste;
            if (d.provisionId) {
              const coverage = await engagementNonCouvert(tx, d.id);
              engagementNonCouvertAmount = coverage?.engagementNonCouvert ?? reste;
            }
            resteAFinancer += engagementNonCouvertAmount * ratio;

            if (reste > 0 && (!prochaineEcheance || d.dueDate < prochaineEcheance.dueDate)) {
              prochaineEcheance = { deadlineId: d.id, chargePlanId: cp.id, label: cp.label, dueDate: d.dueDate, resteAPayer: round2(reste * ratio) };
            }
          }
          const categoryName = cp.category?.name ?? 'Autre';
          byCategory[categoryName] = (byCategory[categoryName] ?? 0) + attributed;
        }
      }

      // §7 : plans associés — via les ChargePlan déjà attribués à cet enfant (ci-dessus)
      // ET via un rattachement bénéficiaire direct (FinancialPlanBeneficiary), sans jamais
      // dupliquer un même plan (Set dédoublonné par id, §19 anti double comptage).
      const beneficiaryEntries = await tx.financialPlanBeneficiary.findMany({
        where: { childId, financialPlan: { householdId } },
        include: { financialPlan: true },
      });
      for (const b of beneficiaryEntries) {
        plansAssociesById.set(b.financialPlan.id, { id: b.financialPlan.id, label: b.financialPlan.label });
      }

      return {
        child,
        coutConnu: round2(coutConnu),
        paye: round2(paye),
        resteAPayer: round2(resteAPayer),
        resteAFinancer: round2(resteAFinancer),
        byCategory,
        chargesCommunesNonVentilees,
        prochaineEcheance,
        plansAssocies: Array.from(plansAssociesById.values()),
      };
    });
  }
}
