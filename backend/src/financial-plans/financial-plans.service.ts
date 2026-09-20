import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { contextualLabel, getDeadlineBalance, toNumber } from '../common/ledger/ledger.util';
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
      include: { deadlines: true, category: true, children: { include: { child: true } }, vehicle: true, housing: true },
    });
    // M7+M8 (guard-rail §4/§14) — "Libellé · Entité", jamais stocké dans cp.label.
    // Recette finale — "Scolarité T1 · Wael" : childName uniquement si le poste a
    // EXACTEMENT un enfant lié (jamais un nom inventé pour un poste multi-enfants).
    const labelOf = (cp: (typeof chargePlans)[number]) =>
      contextualLabel(cp.label, {
        vehicleName: cp.vehicle?.name,
        housingName: cp.housing?.name,
        travelDestination: plan.planType === 'travel' ? plan.destination : undefined,
        childName: cp.children.length === 1 ? cp.children[0].child.firstName : undefined,
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
          unknownItems.push({ chargePlanId: cp.id, label: labelOf(cp), deadlineId: d.id });
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
          chargePlanLabel: labelOf(cp),
          // Point 14.3 — un poste récurrent (auto_frequence, recurrenceRule ≠
          // ponctuel) doit rester identifiable comme tel dans le détail du plan
          // (ex. "Mensuel"), sans jamais afficher chaque occurrence générée
          // comme un poste séparé : le poste reste unique, seules ses échéances
          // sont multiples (déjà le cas ici — une ligne par échéance, jamais
          // par poste).
          recurrenceRule: cp.recurrenceRule,
          // Point 7 (révision) — additifs, déjà chargés ci-dessus pour labelOf
          // (cp.category/cp.defaultAccountId/cp.status), jamais une seconde
          // requête : le mobile regroupe ces échéances par poste et affiche
          // ces champs UNE SEULE FOIS sur l'en-tête du poste.
          categoryName: cp.category?.name ?? null,
          defaultAccountId: cp.defaultAccountId ?? null,
          status: cp.status,
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
      envisagedItems.push({ chargePlanId: cp.id, label: labelOf(cp), amountKnown: cpKnown });
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
      refusedChargePlans: refusedPlans.map((cp) => ({ id: cp.id, label: labelOf(cp) })), // historique conservé (RG-107)
      // M9B — liste minimale des postes (id+label), additive : sert au formulaire de
      // prévision pluriannuelle (un poste par ligne, jamais fusionné).
      chargePlans: chargePlans.map((cp) => ({ id: cp.id, label: labelOf(cp) })),
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
   * Corrections UI/UX (point 1, bug doublons) — suppression désormais TOUJOURS
   * possible, mais jamais destructrice pour un historique réel. L'ancien
   * comportement (`financial_plan_id` en ON DELETE SET NULL) laissait les
   * ChargePlan/Deadline actifs, seulement détachés du plan : ils continuaient à
   * apparaître dans Calendrier/Projection comme des obligations bien réelles —
   * c'est exactement ce qui produisait les doublons après suppression+recréation
   * d'un plan (ex. Dina). Nouvelle règle, par ChargePlan du plan :
   *  - AUCUN Payment sur aucune de ses Deadline → rien à préserver, le
   *    ChargePlan est supprimé pour de bon (cascade Prisma sur ses Deadline/
   *    ChargePlanChild/SchoolProjection liées) : aucune trace orpheline.
   *  - AU MOINS UN Payment → le ChargePlan et ses Deadline déjà payées restent
   *    intacts (historique financier réel, jamais touché) ; seules ses Deadline
   *    SANS aucun Payment (obligations futures pas encore honorées) sont
   *    annulées (financial_status=annulee, jamais supprimées — même convention
   *    que Deadline.cancel) puis le ChargePlan est détaché du plan (rattaché à
   *    aucun autre plan, consultable comme reliquat historique autonome).
   * Le FinancialPlan lui-même est ensuite toujours supprimé (cascade Prisma sur
   * FinancialPlanBeneficiary/SchoolProjection.sourceFinancialPlan).
   */
  async remove(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const plan = await tx.financialPlan.findFirst({ where: { id, householdId } });
      if (!plan) throw new NotFoundException('FinancialPlan introuvable');

      const chargePlans = await tx.chargePlan.findMany({
        where: { financialPlanId: id },
        include: { deadlines: { include: { payments: true } } },
      });

      for (const cp of chargePlans) {
        const hasAnyPayment = cp.deadlines.some((d) => d.payments.length > 0);

        if (!hasAnyPayment) {
          // Rien à préserver : suppression complète (cascade Deadline/enfants/prévisions).
          await tx.chargePlan.delete({ where: { id: cp.id } });
          continue;
        }

        // Historique réel présent : on ne touche qu'aux échéances SANS paiement.
        const openDeadlineIds = cp.deadlines
          .filter((d) => d.payments.length === 0 && d.financialStatus !== 'annulee')
          .map((d) => d.id);
        if (openDeadlineIds.length > 0) {
          await tx.deadline.updateMany({ where: { id: { in: openDeadlineIds } }, data: { financialStatus: 'annulee' } });
        }
        await tx.chargePlan.update({ where: { id: cp.id }, data: { financialPlanId: null } });
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
          // M7+M8 — la copie reste rattachée à la MÊME entité que l'original (jamais
          // perdue silencieusement : un Plan Voiture dupliqué reste un Plan Voiture).
          vehicleId: original.vehicleId,
          housingId: original.housingId,
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
            vehicleId: cp.vehicleId,
            housingId: cp.housingId,
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
