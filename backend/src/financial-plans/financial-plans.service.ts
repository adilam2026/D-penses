import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { getDeadlineBalance, toNumber } from '../common/ledger/ledger.util';
import { engagementNonCouvert } from '../common/ledger/provision.util';
import { CreateFinancialPlanDto } from './dto/create-financial-plan.dto';
import { AddBeneficiaryDto } from './dto/add-beneficiary.dto';

type TxClient = ReturnType<RlsContextService['getClient']>;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * FinancialPlan (docs/02-modele-metier.md §E.12, RG-110→114). Aucun agrégat stocké
 * (RG-111) : known_plan_cost/paid_amount/remaining_due/provision_coverage/
 * remaining_to_fund sont TOUJOURS recalculés à la lecture — jamais des colonnes.
 *
 * provision_coverage (Lot 6) = Σ couverture_affectée (RG-090) des Deadline de la
 * portée certaine liées à une Provision — réutilise EXCLUSIVEMENT provision.util.ts,
 * jamais recopié. Sans Provision liée, couverture_affectée=0 (RG-091), donc
 * remaining_to_fund == remaining_due, inchangé.
 */
@Injectable()
export class FinancialPlansService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateFinancialPlanDto) {
    return this.rlsContext.run(userId, householdId, () =>
      this.rlsContext.getClient().financialPlan.create({
        data: {
          householdId,
          label: dto.label,
          periodStart: new Date(dto.periodStart),
          periodEnd: new Date(dto.periodEnd),
          linkedProvisionId: dto.linkedProvisionId,
        },
      }),
    );
  }

  async findAll(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, () => this.listOnTx(this.rlsContext.getClient(), householdId));
  }

  /** Variante réutilisable sur une transaction déjà ouverte (DashboardService) — jamais un second rlsContext.run() imbriqué. */
  async listOnTx(tx: TxClient, householdId: string) {
    const plans = await tx.financialPlan.findMany({ where: { householdId }, orderBy: { createdAt: 'desc' } });
    return Promise.all(plans.map((p) => this.detailOnTx(tx, p.id)));
  }

  async findOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const plan = await tx.financialPlan.findFirst({ where: { id, householdId } });
      if (!plan) throw new NotFoundException('FinancialPlan introuvable');
      return this.detailOnTx(tx, id);
    });
  }

  /**
   * §7/§13/§14 — Vue financière consolidée. known_plan_cost/paid_amount/
   * remaining_due utilisent la « portée certaine » (obligatoire ou
   * optionnelle_souscrite, RG-106) ; les charges optionnelle_envisagée sont
   * calculées séparément (jamais fusionnées, IF-25) ; optionnelle_refusée et
   * les Deadline annulées sont exclues de tout calcul (RG-107), conservées en
   * historique via les listes brutes ChargePlan/Deadline (jamais supprimées).
   */
  private async detailOnTx(tx: TxClient, id: string) {
    const plan = await tx.financialPlan.findUniqueOrThrow({
      where: { id },
      include: { beneficiaries: { include: { user: true, child: true } } },
    });
    const chargePlans = await tx.chargePlan.findMany({
      where: { financialPlanId: id },
      include: { deadlines: true, category: true, children: { include: { child: true } } },
    });

    const certainPlans = chargePlans.filter((cp) => cp.obligationStatus === 'obligatoire' || cp.obligationStatus === 'optionnelle_souscrite');
    const envisagedPlans = chargePlans.filter((cp) => cp.obligationStatus === 'optionnelle_envisagee');
    const refusedPlans = chargePlans.filter((cp) => cp.obligationStatus === 'optionnelle_refusee');

    let knownPlanCost = 0;
    let paidAmount = 0;
    let remainingDue = 0;
    let provisionCoverage = 0;
    let hasUnknown = false;
    let hasEstimate = false;
    const deadlinesCertain: Array<Record<string, unknown>> = [];
    const unknownItems: Array<{ chargePlanId: string; label: string; deadlineId: string }> = [];

    for (const cp of certainPlans) {
      for (const d of cp.deadlines) {
        if (d.financialStatus === 'annulee') continue; // exclue de tout calcul, comme une charge refusée (RG-107)
        if (d.amountStatus === 'inconnu') {
          hasUnknown = true;
          unknownItems.push({ chargePlanId: cp.id, label: cp.label, deadlineId: d.id });
          continue; // jamais compté 0 (RG-103), exclu de toute somme numérique
        }
        if (d.amountStatus === 'estime') hasEstimate = true;

        const amountCurrent = toNumber(d.amountCurrent);
        const balance = await getDeadlineBalance(tx, d.id);
        const resteAPayer = balance?.resteAPayer ?? 0;
        const paid = amountCurrent - resteAPayer;

        knownPlanCost += amountCurrent; // RG-119 : coût historique, quel que soit l'état financier
        paidAmount += paid;
        if (d.financialStatus === 'ouverte' || d.financialStatus === 'partiellement_payee') {
          remainingDue += resteAPayer; // RG-119 : uniquement le besoin encore dû, jamais une échéance soldée
          if (d.provisionId) {
            const coverage = await engagementNonCouvert(tx, d.id);
            provisionCoverage += coverage?.coverageAffectee ?? 0;
          }
        }
        deadlinesCertain.push({ ...d, chargePlanLabel: cp.label, resteAPayer });
      }
    }

    const remainingToFund = round2(remainingDue - provisionCoverage);

    let envisagedTotal = 0;
    const envisagedItems: Array<{ chargePlanId: string; label: string; amountKnown: boolean }> = [];
    for (const cp of envisagedPlans) {
      let cpKnown = false;
      for (const d of cp.deadlines) {
        if (d.financialStatus === 'annulee' || d.amountStatus === 'inconnu') continue;
        envisagedTotal += toNumber(d.amountCurrent);
        cpKnown = true;
      }
      envisagedItems.push({ chargePlanId: cp.id, label: cp.label, amountKnown: cpKnown });
    }

    // §14 : le niveau le plus prudent domine — une seule valeur inconnue suffit à
    // marquer tout le plan « contient_inconnues », jamais un faux total définitif.
    const completude: 'complet' | 'contient_estimations' | 'contient_inconnues' = hasUnknown
      ? 'contient_inconnues'
      : hasEstimate
        ? 'contient_estimations'
        : 'complet';

    return {
      ...plan,
      knownPlanCost: round2(knownPlanCost),
      paidAmount: round2(paidAmount),
      remainingDue: round2(remainingDue),
      provisionCoverage: round2(provisionCoverage),
      remainingToFund,
      completude,
      envisagedTotal: round2(envisagedTotal),
      envisagedItems,
      unknownItems,
      deadlinesCertain,
      refusedChargePlans: refusedPlans.map((cp) => ({ id: cp.id, label: cp.label })), // historique conservé (RG-107)
    };
  }

  // ---------- Bénéficiaires (RG-114, §8) ----------

  async addBeneficiary(userId: string, householdId: string, planId: string, dto: AddBeneficiaryDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const plan = await tx.financialPlan.findFirst({ where: { id: planId, householdId } });
      if (!plan) throw new NotFoundException('FinancialPlan introuvable');

      if (dto.beneficiaryType === 'user') {
        const membership = await tx.householdMembership.findFirst({ where: { userId: dto.userId, householdId } });
        if (!membership) throw new NotFoundException("Cet utilisateur n'appartient pas à ce foyer");
      } else {
        const child = await tx.child.findFirst({ where: { id: dto.childId, householdId } });
        if (!child) throw new NotFoundException("Cet enfant n'appartient pas à ce foyer");
      }

      try {
        return await tx.financialPlanBeneficiary.create({
          data: {
            financialPlanId: planId,
            beneficiaryType: dto.beneficiaryType,
            userId: dto.beneficiaryType === 'user' ? dto.userId : undefined,
            childId: dto.beneficiaryType === 'child' ? dto.childId : undefined,
          },
        });
      } catch (err: any) {
        if (err?.code === 'P2002') {
          throw new ConflictException('Ce bénéficiaire est déjà rattaché à ce plan');
        }
        throw err;
      }
    });
  }

  async listBeneficiaries(userId: string, householdId: string, planId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const plan = await tx.financialPlan.findFirst({ where: { id: planId, householdId } });
      if (!plan) throw new NotFoundException('FinancialPlan introuvable');
      return tx.financialPlanBeneficiary.findMany({ where: { financialPlanId: planId }, include: { user: true, child: true } });
    });
  }
}
