import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { getDeadlineBalances } from '../common/ledger/ledger.util';
import { createAlreadyPaidDeadline } from '../common/ledger/already-paid.util';
import { CreateChargePlanDto } from './dto/create-charge-plan.dto';
import { CreateDeadlineDto } from './dto/create-deadline.dto';
import { UpdateChargePlanDto } from './dto/update-charge-plan.dto';

/**
 * ChargePlan (docs/02-modele-metier.md §C.4). Deux modes de génération partagent le
 * même modèle sans refonte (Lot 2 auto_frequence, Lot 4 calendrier_manuel, §2) : les
 * Deadline sont toujours créées explicitement via createDeadline, jamais générées
 * automatiquement par un job, quel que soit le mode.
 */
@Injectable()
export class ChargePlansService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateChargePlanDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      if (dto.categoryId) {
        // S0 (audit isolation §3) — categoryId n'était jamais vérifié ici, contrairement aux
        // autres champs ci-dessous : un foyer pouvait rattacher une catégorie PRIVÉE d'un
        // autre foyer à son propre ChargePlan. household_id NULL = catégorie système, partagée.
        const category = await tx.category.findFirst({ where: { id: dto.categoryId, OR: [{ householdId }, { householdId: null }] } });
        if (!category) throw new NotFoundException('Catégorie introuvable dans ce foyer');
      }
      if (dto.defaultAccountId) {
        const account = await tx.financialAccount.findFirst({ where: { id: dto.defaultAccountId, householdId } });
        if (!account) throw new NotFoundException('Compte par défaut introuvable dans ce foyer');
      }
      if (dto.financialPlanId) {
        const plan = await tx.financialPlan.findFirst({ where: { id: dto.financialPlanId, householdId } });
        if (!plan) throw new NotFoundException('FinancialPlan introuvable dans ce foyer');
      }
      if (dto.childIds?.length) {
        const count = await tx.child.count({ where: { id: { in: dto.childIds }, householdId } });
        if (count !== dto.childIds.length) throw new NotFoundException('Un ou plusieurs enfants sont introuvables dans ce foyer');
      }

      return tx.chargePlan.create({
        data: {
          householdId,
          label: dto.label,
          categoryId: dto.categoryId,
          generationMode: dto.generationMode ?? 'auto_frequence',
          recurrenceRule: dto.recurrenceRule,
          defaultAccountId: dto.defaultAccountId,
          obligationStatus: dto.obligationStatus ?? 'obligatoire',
          financialPlanId: dto.financialPlanId,
          startDate: new Date(dto.startDate),
          recurrenceAnchorDate: dto.recurrenceAnchorDate ? new Date(dto.recurrenceAnchorDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          priorityLevel: dto.priorityLevel ?? 1,
          children: dto.childIds?.length ? { create: dto.childIds.map((childId) => ({ childId })) } : undefined,
        },
        include: { children: true },
      });
    });
  }

  /**
   * Recette post-Vague 3 (§6) — nextDeadline (une seule, la plus proche encore
   * ouverte) inclus en une requête (Prisma nested include), jamais un appel
   * N+1 par plan : permet une liste "Charges récurrentes" compacte (une ligne
   * = un ChargePlan + sa prochaine échéance), sans dupliquer de calcul.
   *
   * R6.2 (§2, correctif NaN DH) : `deadline.findMany`/l'include Prisma seul ne
   * renvoie jamais reste_a_payer (colonne propre à la vue deadline_with_balance,
   * RG-016 — même cause déjà documentée pour listDeadlines ci-dessous). Le
   * mobile calculait alors `Number(undefined)` = NaN et l'affichait "NaN DH"
   * pour une charge dont le montant était pourtant connu. Même utilitaire
   * batché que listDeadlines, un seul aller-retour SQL pour tous les plans.
   *
   * R6.3 (point I) — cette liste alimente UNIQUEMENT l'écran "Charges
   * récurrentes" (seul appelant, cf. charge-plans.controller.ts) : elle ne
   * doit représenter que les VRAIS objets récurrents autonomes, jamais les
   * postes ponctuels d'un plan (Uniforme, Fournitures du School Wizard,
   * postes du Travel Wizard...) qui restent consultables dans leur propre
   * contexte (FinancialPlanDetailScreen, GET /financial-plans/:id, non
   * filtré ici — endpoint distinct). Le discriminant est financialPlanId
   * (RG-110 : nul ⇔ ChargePlan autonome hors plan) et non recurrenceRule —
   * generationMode 'calendrier_manuel' est un mode légitime de charge
   * récurrente autonome (échéances ajoutées une à une, ex. facture à
   * montant variable) et n'a jamais de recurrenceRule, alors qu'un poste de
   * plan (financialPlanId non nul) n'est jamais récurrent au sens de cet
   * écran. Un filtre au niveau de la requête, jamais un simple filtrage
   * visuel côté mobile qui laisserait l'API mélanger les deux concepts.
   */
  async findAll(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const plans = await tx.chargePlan.findMany({
        where: { householdId, financialPlanId: null },
        orderBy: { createdAt: 'desc' },
        include: {
          children: true,
          deadlines: {
            where: { financialStatus: { in: ['ouverte', 'partiellement_payee'] } },
            orderBy: { dueDate: 'asc' },
            take: 1,
          },
        },
      });
      const deadlineIds = plans.flatMap((p) => p.deadlines.map((d) => d.id));
      const balances = await getDeadlineBalances(tx, deadlineIds);
      return plans.map((p) => ({
        ...p,
        deadlines: p.deadlines.map((d) => ({ ...d, resteAPayer: balances.get(d.id)?.resteAPayer ?? null })),
      }));
    });
  }

  /**
   * §6 : transition explicite d'obligation_status (ex. envisagée → souscrite/refusée) ;
   * §9 : rattachement FinancialPlan.
   *
   * R6.2 (§3) : édition étendue à fréquence/prochaine échéance/montant, avec la
   * même règle dans les deux cas — jamais rétroactif. Une Deadline déjà
   * touchée par un paiement (financialStatus ≠ 'ouverte', ou 'ouverte' avec un
   * Payment — cas d'un remboursement total qui rouvre l'échéance) garde son
   * montant ET reste alignée sur l'ancienne fréquence/ancre ; seules les
   * Deadline encore 'ouverte' SANS aucun Payment (purement générées,
   * jamais consultées par l'utilisateur) sont concernées.
   */
  async update(userId: string, householdId: string, id: string, dto: UpdateChargePlanDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const existing = await this.assertOwned(tx, id, householdId);

      if (dto.financialPlanId) {
        const plan = await tx.financialPlan.findFirst({ where: { id: dto.financialPlanId, householdId } });
        if (!plan) throw new NotFoundException('FinancialPlan introuvable dans ce foyer');
      }

      if (dto.categoryId) {
        const category = await tx.category.findFirst({ where: { id: dto.categoryId, householdId } });
        if (!category) throw new NotFoundException('Catégorie introuvable dans ce foyer');
      }
      if (dto.defaultAccountId) {
        const account = await tx.financialAccount.findFirst({ where: { id: dto.defaultAccountId, householdId } });
        if (!account) throw new NotFoundException('Compte par défaut introuvable dans ce foyer');
      }

      const existingAnchorIso = existing.recurrenceAnchorDate ? existing.recurrenceAnchorDate.toISOString().slice(0, 10) : null;
      const recurrenceChanged =
        (dto.recurrenceRule !== undefined && dto.recurrenceRule !== existing.recurrenceRule) ||
        (dto.recurrenceAnchorDate !== undefined && (dto.recurrenceAnchorDate ?? null) !== existingAnchorIso);

      let amountStatus: 'inconnu' | 'estime' | 'confirme' | undefined;
      if (dto.amountCurrent !== undefined || dto.amountStatus !== undefined) {
        amountStatus = dto.amountStatus ?? 'estime';
        if (amountStatus === 'inconnu' && dto.amountCurrent !== undefined) {
          throw new BadRequestException('amount_current doit être absent quand amount_status = inconnu (RG-102/103)');
        }
        if (amountStatus !== 'inconnu' && dto.amountCurrent === undefined) {
          throw new BadRequestException('amount_current est obligatoire sauf si amount_status = inconnu');
        }
      }

      const updated = await tx.chargePlan.update({
        where: { id },
        data: {
          label: dto.label,
          categoryId: dto.categoryId === undefined ? undefined : dto.categoryId,
          recurrenceRule: dto.recurrenceRule,
          recurrenceAnchorDate:
            dto.recurrenceAnchorDate === undefined ? undefined : dto.recurrenceAnchorDate ? new Date(dto.recurrenceAnchorDate) : null,
          defaultAccountId: dto.defaultAccountId === undefined ? undefined : dto.defaultAccountId,
          endDate: dto.endDate === undefined ? undefined : dto.endDate ? new Date(dto.endDate) : null,
          obligationStatus: dto.obligationStatus,
          financialPlanId: dto.financialPlanId === undefined ? undefined : dto.financialPlanId,
          status: dto.status,
        },
        include: { children: true },
      });

      // §3 : jamais l'historique — seule la génération future doit refléter la
      // nouvelle ancre/fréquence. ensureChargeDeadlinesUntil (appelé
      // paresseusement par chaque consommateur : Dashboard/Projection/Calendar)
      // les régénère alignées, sans second moteur.
      if (recurrenceChanged) {
        await tx.deadline.deleteMany({
          where: { chargePlanId: id, financialStatus: 'ouverte', payments: { none: {} } },
        });
      }

      if (amountStatus !== undefined) {
        await tx.deadline.updateMany({
          where: { chargePlanId: id, financialStatus: 'ouverte', payments: { none: {} } },
          data: {
            amountCurrent: amountStatus === 'inconnu' ? null : dto.amountCurrent,
            amountStatus,
            confirmedAt: amountStatus === 'confirme' ? new Date() : null,
          },
        });
      }

      return updated;
    });
  }

  /**
   * Recette post-Vague 3 (§4) — suppression réelle interdite dès qu'un historique
   * financier existe (RG implicite : jamais casser un paiement/historique réel).
   * Une seule Deadline avec un Payment enregistré, ou dont le statut financier
   * n'est plus 'ouverte' (partiellement_payee/soldee), bloque la suppression —
   * proposer status=inactif (désactivation, §4) à la place. Sans historique,
   * la suppression est autorisée : cascade Prisma sur les Deadline restantes
   * (toutes 'ouverte' sans paiement, rien à perdre).
   */
  async remove(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      await this.assertOwned(tx, id, householdId);

      const deadlineWithHistory = await tx.deadline.findFirst({
        where: {
          chargePlanId: id,
          OR: [{ financialStatus: { in: ['partiellement_payee', 'soldee'] } }, { payments: { some: {} } }],
        },
      });
      if (deadlineWithHistory) {
        throw new ConflictException(
          'Impossible de supprimer : un historique de paiement existe déjà. Désactivez la charge (arrêter la récurrence) à la place.',
        );
      }

      await tx.chargePlan.delete({ where: { id } });
      return { deleted: true };
    });
  }

  async findOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      return this.assertOwned(tx, id, householdId);
    });
  }

  private async assertOwned(tx: ReturnType<RlsContextService['getClient']>, id: string, householdId: string) {
    const chargePlan = await tx.chargePlan.findFirst({ where: { id, householdId } });
    if (!chargePlan) throw new NotFoundException('Plan de charge introuvable');
    return chargePlan;
  }

  /**
   * Crée une Deadline rattachée au plan. RG-102/103 : amount_current est NULL
   * si et seulement si amount_status = inconnu — jamais 0 dans ce cas.
   *
   * R6.2 (§4-9) : dto.alreadyPaid crée directement une échéance "déjà payée"
   * (soldée + son Payment historique, CAS A/B — cf. already-paid.util.ts),
   * jamais une échéance ouverte classique.
   */
  async createDeadline(userId: string, householdId: string, chargePlanId: string, dto: CreateDeadlineDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      await this.assertOwned(tx, chargePlanId, householdId);

      if (dto.alreadyPaid) {
        if (dto.alreadyPaid.accountId) {
          const account = await tx.financialAccount.findFirst({ where: { id: dto.alreadyPaid.accountId, householdId } });
          if (!account) throw new NotFoundException('Compte introuvable dans ce foyer');
        }
        const { deadline } = await createAlreadyPaidDeadline(tx, chargePlanId, new Date(dto.dueDate), userId, {
          amount: dto.alreadyPaid.amount,
          paidDate: new Date(dto.alreadyPaid.paidDate),
          accountId: dto.alreadyPaid.accountId,
        });
        return deadline;
      }

      const amountStatus = dto.amountStatus ?? (dto.amountCurrent !== undefined ? 'estime' : 'inconnu');
      if (amountStatus === 'inconnu') {
        if (dto.amountCurrent !== undefined) {
          throw new BadRequestException('amount_current doit être absent quand amount_status = inconnu (RG-102/103)');
        }
      } else if (dto.amountCurrent === undefined) {
        throw new BadRequestException('amount_current est obligatoire sauf si amount_status = inconnu');
      }

      return tx.deadline.create({
        data: {
          chargePlanId,
          dueDate: new Date(dto.dueDate),
          expectedBillingDate: dto.expectedBillingDate ? new Date(dto.expectedBillingDate) : undefined,
          billingDate: dto.billingDate ? new Date(dto.billingDate) : undefined,
          amountCurrent: amountStatus === 'inconnu' ? null : dto.amountCurrent,
          amountStatus,
          confirmedAt: amountStatus === 'confirme' ? new Date() : undefined,
        },
      });
    });
  }

  /**
   * R6.1 (§13, correctif) : `deadline.findMany` seul ne renvoie jamais reste_a_payer —
   * cette colonne n'existe que sur la vue deadline_with_balance (RG-016), jamais sur la
   * table `deadline` elle-même. L'omettre laissait le mobile calculer `Number(undefined)`
   * = NaN puis l'afficher tel quel — une échéance avec un montant pourtant connu
   * paraissait alors sans valeur. Même utilitaire batché que findAllOpen (deadlines.service.ts),
   * jamais un recalcul divergent.
   */
  async listDeadlines(userId: string, householdId: string, chargePlanId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      await this.assertOwned(tx, chargePlanId, householdId);
      const deadlines = await tx.deadline.findMany({ where: { chargePlanId }, orderBy: { dueDate: 'asc' } });
      const balances = await getDeadlineBalances(tx, deadlines.map((d) => d.id));
      return deadlines.map((d) => ({ ...d, resteAPayer: balances.get(d.id)?.resteAPayer ?? null }));
    });
  }
}
