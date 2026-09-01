import { Injectable } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';

export interface ActionItem {
  kind: 'facture_attendue' | 'montant_inconnu' | 'montant_a_confirmer' | 'option_a_decider';
  chargePlanId: string;
  deadlineId?: string;
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

  async list(userId: string, householdId: string): Promise<ActionItem[]> {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const settings = await tx.householdSettings.findUnique({ where: { householdId } });
      const seuilAVenirDays = settings?.seuilAVenirDays ?? 30;
      const today = new Date();
      const horizon = new Date(today.getTime() + seuilAVenirDays * 86400000);

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
          if (d.billingDate === null && d.expectedBillingDate !== null && d.expectedBillingDate < today) {
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

      return items;
    });
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  }
}
