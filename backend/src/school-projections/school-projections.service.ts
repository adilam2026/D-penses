import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { toNumber } from '../common/ledger/ledger.util';
import { addYears, computeProjectedAmount, parseSchoolYear, shiftSchoolYear } from '../common/ledger/school-projection.util';
import { GenerateSchoolProjectionsDto } from './dto/generate-school-projections.dto';

/**
 * M9 — moteur de prévision pluriannuelle des postes École (§ verrouillage
 * architecture Plans, avant M7/M8). JAMAIS de Deadline créée par avance : ce
 * service ne lit/écrit QUE school_projection, jamais deadline/charge_plan/
 * payment/provision — treasury.util.ts, projection.util.ts et
 * monthly-projection.util.ts restent totalement inchangés et n'importent rien
 * d'ici (garde-fou §8, vérifié structurellement).
 */
@Injectable()
export class SchoolProjectionsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  /**
   * Génère (ou régénère, si status='projete') les lignes de prévision pour
   * chaque poste (ChargePlan) du plan réel, année par année sur l'horizon
   * demandé — le montant de référence de l'année N part TOUJOURS du montant
   * CALCULÉ de l'année N-1 (réelle pour la première année projetée, projetée
   * ensuite), jamais recalculé depuis l'origine (§6).
   */
  async generate(userId: string, householdId: string, financialPlanId: string, dto: GenerateSchoolProjectionsDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();

      const plan = await tx.financialPlan.findFirst({ where: { id: financialPlanId, householdId } });
      if (!plan) throw new NotFoundException('Plan financier introuvable');
      if (plan.planType !== 'school') throw new BadRequestException('Seul un plan École peut être projeté');
      if (!plan.schoolYear) throw new BadRequestException("Le plan doit avoir une année scolaire structurée (schoolYear) pour être projeté");

      if (!dto.years && !dto.targetSchoolYear) throw new BadRequestException('Horizon requis : years (1/3/5) ou targetSchoolYear');
      if (dto.years && dto.targetSchoolYear) throw new BadRequestException('Choisir soit years soit targetSchoolYear, jamais les deux');

      const { startYear: baseStartYear } = parseSchoolYear(plan.schoolYear);
      let maxOffset: number;
      if (dto.years) {
        maxOffset = dto.years;
      } else {
        const { startYear: targetStartYear } = parseSchoolYear(dto.targetSchoolYear!);
        maxOffset = targetStartYear - baseStartYear;
        if (maxOffset < 1) throw new BadRequestException('targetSchoolYear doit être postérieure à l\'année du plan');
      }
      const offsets = Array.from({ length: maxOffset }, (_, i) => i + 1);

      const beneficiary = await tx.financialPlanBeneficiary.findFirst({
        where: { financialPlanId, beneficiaryType: 'child' },
        orderBy: { createdAt: 'asc' },
      });
      if (!beneficiary?.childId) throw new BadRequestException('Le plan doit avoir un enfant bénéficiaire pour être projeté');
      const childId = beneficiary.childId;

      const chargePlans = await tx.chargePlan.findMany({ where: { financialPlanId } });
      const ruleByChargePlan = new Map((dto.rules ?? []).map((r) => [r.chargePlanId, r]));

      const created: unknown[] = [];
      const skipped: { chargePlanId: string; label: string; reason: string }[] = [];

      for (const cp of chargePlans) {
        const explicitRule = ruleByChargePlan.get(cp.id);
        const rule = explicitRule ?? (dto.applyToAllIncreaseType ? { increaseType: dto.applyToAllIncreaseType, increaseValue: dto.applyToAllIncreaseValue } : null);
        if (!rule) {
          skipped.push({ chargePlanId: cp.id, label: cp.label, reason: 'aucune règle fournie pour ce poste' });
          continue;
        }

        // §2/§3 — référence = échéance la plus récente à montant CONNU de ce poste (jamais
        // 0 inventé) ; sourceChargePlanId reste la granularité (T1/T2/T3 restent 3 postes
        // distincts, jamais fusionnés).
        const referenceDeadline = await tx.deadline.findFirst({
          where: { chargePlanId: cp.id, amountCurrent: { not: null } },
          orderBy: { dueDate: 'desc' },
        });
        if (!referenceDeadline) {
          skipped.push({ chargePlanId: cp.id, label: cp.label, reason: 'aucun montant connu pour ce poste' });
          continue;
        }

        let referenceAmount = toNumber(referenceDeadline.amountCurrent);
        let previousProjectionId: string | null = null;
        // M9B §3 — figé UNE fois sur la Deadline réelle qui a amorcé la chaîne, jamais
        // recalculé/réélu à chaque année : sourceChargePlanId seul ne suffit pas à
        // distinguer QUELLE échéance a servi de référence si ce poste en porte plusieurs.
        const sourceDeadlineId = referenceDeadline.id;

        for (const offset of offsets) {
          const targetSchoolYear = shiftSchoolYear(plan.schoolYear, offset);
          const targetDate = addYears(referenceDeadline.dueDate, offset);
          const computedAmount = computeProjectedAmount(referenceAmount, rule.increaseType, rule.increaseValue ?? null);

          const existing = await tx.schoolProjection.findUnique({
            where: { sourceChargePlanId_schoolYear: { sourceChargePlanId: cp.id, schoolYear: targetSchoolYear } },
          });
          if (existing?.status === 'remplacee') {
            throw new ConflictException(`La prévision "${cp.label}" pour ${targetSchoolYear} a déjà été remplacée par un plan réel — régénération impossible`);
          }

          let row;
          if (existing) {
            row = await tx.schoolProjection.update({
              where: { id: existing.id },
              data: {
                schoolName: plan.schoolName,
                label: cp.label,
                targetDate,
                sourceDeadlineId,
                referenceAmount,
                increaseType: rule.increaseType,
                increaseValue: rule.increaseValue ?? null,
                computedAmount,
                previousProjectionId,
              },
            });
          } else {
            row = await tx.schoolProjection.create({
              data: {
                householdId,
                childId,
                schoolName: plan.schoolName,
                label: cp.label,
                schoolYear: targetSchoolYear,
                targetDate,
                sourceFinancialPlanId: financialPlanId,
                sourceChargePlanId: cp.id,
                sourceDeadlineId,
                referenceAmount,
                increaseType: rule.increaseType,
                increaseValue: rule.increaseValue ?? null,
                computedAmount,
                previousProjectionId,
              },
            });
          }

          created.push(row);
          referenceAmount = computedAmount;
          previousProjectionId = row.id;
        }
      }

      return { created, skipped };
    });
  }

  /** Toutes les prévisions (actives + remplacées, pour historique) issues de ce plan réel. */
  async listForPlan(userId: string, householdId: string, financialPlanId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const plan = await tx.financialPlan.findFirst({ where: { id: financialPlanId, householdId } });
      if (!plan) throw new NotFoundException('Plan financier introuvable');
      return tx.schoolProjection.findMany({
        where: { sourceFinancialPlanId: financialPlanId },
        // M9B §4 — child inclus (id + firstName) pour composer l'affichage côté
        // consommateur ("Scolarité T1 · Wael") SANS jamais dupliquer le nom dans
        // `label`, qui reste le libellé du poste seul.
        include: { child: { select: { id: true, firstName: true } } },
        orderBy: [{ schoolYear: 'asc' }, { label: 'asc' }],
      });
    });
  }

  /**
   * §4 — détection à la création d'un nouveau plan réel : prévisions ACTIVES
   * (status=projete) pour (enfant, année cible, établissement si fourni), pour
   * préremplissage du wizard. Une prévision remplacee n'est jamais candidate.
   */
  async findCandidates(userId: string, householdId: string, childId: string, schoolYear: string, schoolName?: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      return tx.schoolProjection.findMany({
        where: { householdId, childId, schoolYear, status: 'projete', ...(schoolName ? { schoolName } : {}) },
        include: { child: { select: { id: true, firstName: true } } },
        orderBy: { label: 'asc' },
      });
    });
  }
}
