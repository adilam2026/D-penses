import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { getDeadlineBalance, toNumber } from '../common/ledger/ledger.util';
import { engagementNonCouvert } from '../common/ledger/provision.util';
import { CreateFinancialPlanDto } from './dto/create-financial-plan.dto';
import { UpdateFinancialPlanDto } from './dto/update-financial-plan.dto';
import { DuplicateFinancialPlanDto } from './dto/duplicate-financial-plan.dto';
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
  async listOnTx(tx: TxClient, householdId: string, referenceDate: Date = new Date()) {
    const plans = await tx.financialPlan.findMany({ where: { householdId }, orderBy: { createdAt: 'desc' } });
    return Promise.all(plans.map((p) => this.detailOnTx(tx, p.id, referenceDate)));
  }

  async findOne(userId: string, householdId: string, id: string, referenceDate: Date = new Date()) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const plan = await tx.financialPlan.findFirst({ where: { id, householdId } });
      if (!plan) throw new NotFoundException('FinancialPlan introuvable');
      return this.detailOnTx(tx, id, referenceDate);
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
  private async detailOnTx(tx: TxClient, id: string, referenceDate: Date = new Date()) {
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
    // Correctif post-Vague 3 (priorisation "Mes plans", accueil) — échéance certaine la
    // plus proche et présence d'un retard, calculées ici (portée certaine uniquement,
    // comme le reste du moteur ; unknownItems volontairement exclus, cf. RG-103) pour que
    // le tri d'accueil réutilise ces données au lieu de les recalculer côté mobile.
    let nextDeadlineDate: Date | null = null;
    let hasOverdue = false;

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

        // §9/§10 — couverture par échéance : réutilise exclusivement engagementNonCouvert
        // (provision.util.ts, RG-090), jamais un recalcul indépendant. "Couverte" (réservé)
        // et "payée" (financialStatus) restent deux informations distinctes, jamais fusionnées.
        let coverageAffectee = 0;
        let engagementNonCouvertAmount = resteAPayer;
        const isOpen = d.financialStatus === 'ouverte' || d.financialStatus === 'partiellement_payee';
        if (isOpen) {
          remainingDue += resteAPayer; // RG-119 : uniquement le besoin encore dû, jamais une échéance soldée
          if (resteAPayer > 0) {
            if (d.dueDate.getTime() < referenceDate.getTime()) hasOverdue = true;
            if (nextDeadlineDate === null || d.dueDate.getTime() < nextDeadlineDate.getTime()) nextDeadlineDate = d.dueDate;
          }
          if (d.provisionId) {
            const coverage = await engagementNonCouvert(tx, d.id);
            coverageAffectee = coverage?.coverageAffectee ?? 0;
            engagementNonCouvertAmount = coverage?.engagementNonCouvert ?? resteAPayer;
            provisionCoverage += coverageAffectee;
          }
        } else {
          engagementNonCouvertAmount = 0; // soldée : rien ne reste à couvrir
        }

        const coverageStatus: 'couverte' | 'partielle' | 'non_couverte' | 'sans_objet' =
          !isOpen || resteAPayer === 0
            ? 'sans_objet'
            : coverageAffectee <= 0
              ? 'non_couverte'
              : engagementNonCouvertAmount <= 0
                ? 'couverte'
                : 'partielle';

        deadlinesCertain.push({
          ...d,
          chargePlanLabel: cp.label,
          resteAPayer,
          coverageAffectee: round2(coverageAffectee),
          engagementNonCouvert: round2(engagementNonCouvertAmount),
          coverageStatus,
        });
      }
    }

    const remainingToFund = round2(remainingDue - provisionCoverage);
    // §8 — taux de couverture = part du reste à payer déjà couverte par des enveloppes
    // (même rapport que l'invariant IF-16 coverage+uncovered=reste_a_payer, agrégé au
    // niveau du plan). NULL quand il n'y a plus rien à couvrir (aucun sens à afficher un %).
    const tauxCouverture = remainingDue > 0 ? round2(Math.min(100, (provisionCoverage / remainingDue) * 100)) : null;

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
      tauxCouverture,
      nextDeadlineDate,
      hasOverdue,
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

  // ---------- R5 §2 — Modifier / Supprimer ----------

  /** Identité/période uniquement — jamais planType (structurel, fixé à la création, cf. wizards). */
  async update(userId: string, householdId: string, id: string, dto: UpdateFinancialPlanDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const plan = await tx.financialPlan.findFirst({ where: { id, householdId } });
      if (!plan) throw new NotFoundException('FinancialPlan introuvable');
      await tx.financialPlan.update({
        where: { id },
        data: {
          label: dto.label,
          periodStart: dto.periodStart ? new Date(dto.periodStart) : undefined,
          periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
          destination: dto.destination,
        },
      });
      return this.detailOnTx(tx, id);
    });
  }

  /**
   * Suppression sûre (R5 §2) : bloquée dès qu'un paiement réel existe sous ce plan
   * (via n'importe quelle Deadline d'un de ses ChargePlan) — jamais un DELETE qui
   * ferait disparaître un historique financier réel. Sans paiement, la suppression
   * est autorisée : les ChargePlan/Deadline ne sont JAMAIS supprimés par cascade
   * (FK financial_plan_id en ON DELETE SET NULL, cf. migration lot4) — ils restent
   * intacts, seulement détachés de ce plan.
   */
  async remove(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const plan = await tx.financialPlan.findFirst({ where: { id, householdId } });
      if (!plan) throw new NotFoundException('FinancialPlan introuvable');

      const paymentCount = await tx.payment.count({ where: { deadline: { chargePlan: { financialPlanId: id } } } });
      if (paymentCount > 0) {
        throw new BadRequestException(
          'Ce plan a des paiements enregistrés — suppression impossible pour préserver l\'historique financier.',
        );
      }

      await tx.financialPlan.delete({ where: { id } });
      return { deleted: true };
    });
  }

  // ---------- R5 §3 — Dupliquer avec sélection explicite des bénéficiaires ----------

  /**
   * Copie atomique (une seule transaction RLS) : nouveau FinancialPlan + copie de
   * chaque ChargePlan actif/optionnel avec ses Deadline non annulées (montant/statut
   * connu recopié, mais financialStatus toujours réinitialisé à `ouverte`, jamais de
   * Payment ni de couverture Provision copiés — RG "jamais l'historique/les paiements").
   * Les enfants bénéficiaires de la copie sont EXPLICITEMENT ceux de `dto.childIds`,
   * jamais hérités de l'original (§3 — ex. dupliquer pour un frère/une sœur).
   * Les deux plans sont ensuite totalement indépendants : aucune ligne copiée ne
   * partage d'id avec l'original, donc modifier l'un ne peut jamais affecter l'autre.
   */
  async duplicate(userId: string, householdId: string, id: string, dto: DuplicateFinancialPlanDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const original = await tx.financialPlan.findFirst({
        where: { id, householdId },
        include: { chargePlans: { include: { deadlines: true } } },
      });
      if (!original) throw new NotFoundException('FinancialPlan introuvable');

      const childIds = dto.childIds ?? [];
      for (const childId of childIds) {
        const child = await tx.child.findFirst({ where: { id: childId, householdId } });
        if (!child) throw new NotFoundException(`Enfant ${childId} introuvable dans ce foyer`);
      }

      const copy = await tx.financialPlan.create({
        data: {
          householdId,
          label: dto.label,
          planType: original.planType,
          destination: original.destination,
          periodStart: original.periodStart,
          periodEnd: original.periodEnd,
          // linkedProvisionId volontairement omis : une copie ne partage jamais
          // l'enveloppe de l'original (sinon double comptage de couverture).
        },
      });

      for (const childId of childIds) {
        await tx.financialPlanBeneficiary.create({
          data: { financialPlanId: copy.id, beneficiaryType: 'child', childId },
        });
      }

      for (const cp of original.chargePlans) {
        const cpCopy = await tx.chargePlan.create({
          data: {
            householdId,
            label: cp.label,
            categoryId: cp.categoryId,
            generationMode: cp.generationMode,
            recurrenceRule: cp.recurrenceRule,
            defaultAccountId: cp.defaultAccountId,
            obligationStatus: cp.obligationStatus,
            financialPlanId: copy.id,
            startDate: cp.startDate,
            endDate: cp.endDate,
            priorityLevel: cp.priorityLevel,
            status: cp.status,
          },
        });

        for (const childId of childIds) {
          await tx.chargePlanChild.create({ data: { chargePlanId: cpCopy.id, childId } });
        }

        for (const d of cp.deadlines) {
          if (d.financialStatus === 'annulee') continue; // jamais reconduire une échéance annulée
          await tx.deadline.create({
            data: {
              chargePlanId: cpCopy.id,
              dueDate: d.dueDate,
              expectedBillingDate: d.expectedBillingDate,
              billingDate: null,
              amountCurrent: d.amountCurrent,
              amountStatus: d.amountStatus,
              amountInitialEstimated: d.amountInitialEstimated,
              confirmedAt: null,
              financialStatus: 'ouverte',
              provisionId: null, // jamais la couverture de l'original — la copie repart sans enveloppe
            },
          });
          // Aucun Payment ni DeadlineChildAllocation copié : jamais l'historique/la
          // ventilation de l'original, uniquement l'échéancier et les montants connus.
        }
      }

      return this.detailOnTx(tx, copy.id);
    });
  }
}
