import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { round2, toNumber } from '../common/ledger/ledger.util';
import { computeProvisionSufficiency } from '../common/ledger/provision.util';

type TxClient = Prisma.TransactionClient;

export interface ActionItem {
  kind:
    | 'facture_attendue'
    | 'montant_inconnu'
    | 'montant_a_confirmer'
    | 'option_a_decider'
    | 'provision_insuffisante'
    | 'contribution_a_confirmer'
    | 'objectif_en_retard';
  chargePlanId?: string;
  deadlineId?: string;
  provisionId?: string;
  pocketMovementId?: string;
  goalId?: string;
  message: string;
}

/**
 * Actions à traiter (docs/02-modele-metier.md §E.9, RG-117/118, §20). Toujours
 * CALCULÉE à la lecture — jamais une table stockée qu'il faudrait purger/muter
 * (même principe que le statut temporel, O.2) : il n'y a donc pas de « doublon
 * stocké » possible, et RG-118 (pas de relance répétitive) se traduit ici par le
 * fait qu'une même condition produit toujours exactement la même ligne, jamais
 * plusieurs. RG-117 (pas d'alerte trop tôt) est appliqué par la fenêtre
 * seuil_à_venir du foyer.
 */
@Injectable()
export class ActionsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async list(userId: string, householdId: string, referenceDate: Date = new Date()): Promise<ActionItem[]> {
    return this.rlsContext.run(userId, householdId, () => this.listOnTx(this.rlsContext.getClient(), householdId, referenceDate));
  }

  /** Variante réutilisable sur une transaction déjà ouverte (DashboardService) — jamais un second rlsContext.run() imbriqué. */
  async listOnTx(tx: TxClient, householdId: string, referenceDate: Date): Promise<ActionItem[]> {
    const settings = await tx.householdSettings.findUnique({ where: { householdId } });
    const seuilAVenirDays = settings?.seuilAVenirDays ?? 30;
    const horizon = new Date(referenceDate.getTime() + seuilAVenirDays * 86400000);

    const chargePlans = await tx.chargePlan.findMany({
      where: { householdId },
      include: { deadlines: true, children: { include: { child: true } } },
    });

    const items: ActionItem[] = [];

    for (const cp of chargePlans) {
      if (cp.obligationStatus === 'optionnelle_refusee') continue; // exclue de tout traitement (RG-107)

      for (const d of cp.deadlines) {
        if (d.financialStatus === 'soldee' || d.financialStatus === 'annulee') continue;

        // RG-101 : facture attendue non reçue.
        if (d.billingDate === null && d.expectedBillingDate !== null && d.expectedBillingDate < referenceDate) {
          items.push({
            kind: 'facture_attendue',
            chargePlanId: cp.id,
            deadlineId: d.id,
            message: `Facture ${cp.label} attendue depuis le ${this.formatDate(d.expectedBillingDate)}.`,
          });
        }

        // RG-102/103/117 : montant inconnu pertinent, dans la fenêtre seuil_à_venir seulement.
        if (d.amountStatus === 'inconnu' && d.dueDate <= horizon) {
          items.push({
            kind: 'montant_inconnu',
            chargePlanId: cp.id,
            deadlineId: d.id,
            message: `${cp.label} : montant non renseigné.`,
          });
        }

        // Facture reçue mais montant encore estimé — à confirmer.
        if (d.amountStatus === 'estime' && d.billingDate !== null) {
          items.push({
            kind: 'montant_a_confirmer',
            chargePlanId: cp.id,
            deadlineId: d.id,
            message: `${cp.label} : facture reçue, montant à confirmer.`,
          });
        }
      }

      // Option envisagée : décision à prendre — gatée sur la prochaine échéance
      // ouverte si elle existe, sinon toujours affichée (pas de date pour gater).
      if (cp.obligationStatus === 'optionnelle_envisagee') {
        const openDeadlines = cp.deadlines.filter((d) => d.financialStatus !== 'soldee' && d.financialStatus !== 'annulee');
        const relevant = openDeadlines.length === 0 || openDeadlines.some((d) => d.dueDate <= horizon);
        if (relevant) {
          const childSuffix = cp.children.length ? ` ${cp.children.map((c) => c.child.firstName).join('+')}` : '';
          items.push({
            kind: 'option_a_decider',
            chargePlanId: cp.id,
            message: `${cp.label}${childSuffix} : décision à traiter.`,
          });
        }
      }
    }

    // RG-032ter (§29 Lot 6) : tension de court terme sur une Provision liée à des
    // échéances ouvertes — jamais un simple recalcul du taux mensuel (non actionnable
    // à si court terme), une alerte qualitative avec le montant manquant.
    const provisions = await tx.provision.findMany({ where: { householdId } });
    for (const provision of provisions) {
      const sufficiency = await computeProvisionSufficiency(tx, provision.id, referenceDate);
      if (sufficiency.tensionAlert) {
        items.push({
          kind: 'provision_insuffisante',
          provisionId: provision.id,
          deadlineId: sufficiency.tensionAlert.deadlineId,
          message: `Provision ${provision.name} insuffisante : ${sufficiency.tensionAlert.manque} DH manquants avant le ${this.formatDate(sufficiency.tensionAlert.dueDate)}.`,
        });
      }
    }

    // §16/17/29 : une contribution planifiée dont la date est atteinte mais jamais
    // confirmée n'affecte jamais le solde réel (RG-000) — signalée, jamais auto-confirmée.
    const duePocketMovements = await tx.pocketMovement.findMany({
      where: {
        status: 'prevu',
        movementType: 'contribution',
        plannedDate: { lte: referenceDate },
        OR: [
          { pocketType: 'savings_pocket', savingsPocket: { householdId } },
          { pocketType: 'provision', provision: { householdId } },
        ],
      },
      include: { savingsPocket: true, provision: true },
    });
    for (const m of duePocketMovements) {
      const label = m.pocketType === 'savings_pocket' ? m.savingsPocket?.name : m.provision?.name;
      items.push({
        kind: 'contribution_a_confirmer',
        pocketMovementId: m.id,
        provisionId: m.pocketType === 'provision' ? (m.provisionId ?? undefined) : undefined,
        message: `${label ?? 'Poche'} : contribution de ${toNumber(m.plannedAmount)} DH prévue le ${this.formatDate(m.plannedDate)} à confirmer.`,
      });
    }

    // §25/29 : objectif en retard — déterminable sans moteur de recommandation (Lot 8) :
    // date cible dépassée, pas encore atteint, jamais un rythme/pacing recommandé ici.
    const goals = await tx.goal.findMany({ where: { householdId, status: 'en_cours', targetDate: { lt: referenceDate } } });
    for (const goal of goals) {
      const contributions = await tx.goalContribution.findMany({ where: { goalId: goal.id, status: 'confirme' } });
      const saved = round2(contributions.reduce((sum, c) => sum + toNumber(c.actualAmount), 0));
      const target = toNumber(goal.targetAmount);
      if (saved < target) {
        items.push({
          kind: 'objectif_en_retard',
          goalId: goal.id,
          message: `Objectif ${goal.label} en retard : ${round2(target - saved)} DH restants, échéance du ${this.formatDate(goal.targetDate!)} dépassée.`,
        });
      }
    }

    return items;
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  }
}
