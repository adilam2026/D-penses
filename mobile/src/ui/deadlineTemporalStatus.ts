import { colors } from './theme';

/**
 * T-Paiements/Échéances mini-lot 1 — statut temporel d'une échéance, calculé à
 * la lecture, JAMAIS stocké (même doctrine backend : docs/02 §F.2/O.2). Seule
 * implémentation de ce calcul dans l'app — extraite de HomeScreen.urgencyColor
 * (seul endroit qui le calculait jusqu'ici), jamais une seconde règle de seuil.
 *
 * Comparaison au niveau JOUR CALENDAIRE, jamais un diff de timestamps en
 * millisecondes : une échéance du 13/09 reste "due" pendant TOUTE la journée
 * du 13/09, quelle que soit l'heure (le matin comme le soir) — dueDate est
 * déjà minuit UTC (convention @db.Date backend), "maintenant" est tronqué à
 * son jour calendaire UTC avant comparaison (utcDayIndex), jamais comparé à
 * sa valeur brute. Le seuil (seuilAPayerDays, déjà utilisé pour la fenêtre
 * d'alerte "bientôt à payer" du Dashboard) s'applique ensuite en nombre de
 * jours entiers, 4 paliers :
 *  - overdue : jour de l'échéance strictement antérieur au jour courant
 *  - due     : jour de l'échéance = jour courant
 *  - soon    : jour de l'échéance strictement futur, dans la fenêtre (<= seuil)
 *  - future  : au-delà du seuil
 *
 * Une échéance soldée/annulée ne doit JAMAIS apparaître overdue (ni aucun
 * autre palier temporel — l'urgence n'a plus de sens une fois l'échéance
 * close) : financialStatus soldee/annulee renvoie null, pas de badge.
 */
export type DeadlineTemporalStatus = 'future' | 'soon' | 'due' | 'overdue';

export type DeadlineFinancialStatus = 'ouverte' | 'partiellement_payee' | 'soldee' | 'annulee';

/** Jour calendaire UTC d'une Date (année/mois/jour uniquement, heure ignorée),
 * en nombre de jours depuis epoch — seul point de troncature heure→jour. */
function utcDayIndex(date: Date): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
}

export function deadlineTemporalStatus(
  dueDate: string,
  seuilAPayerDays: number,
  financialStatus?: DeadlineFinancialStatus,
): DeadlineTemporalStatus | null {
  if (financialStatus === 'soldee' || financialStatus === 'annulee') return null;

  const days = utcDayIndex(new Date(dueDate)) - utcDayIndex(new Date(Date.now()));
  if (days < 0) return 'overdue';
  if (days === 0) return 'due';
  if (days <= seuilAPayerDays) return 'soon';
  return 'future';
}

export const DEADLINE_TEMPORAL_LABEL: Record<DeadlineTemporalStatus, string> = {
  future: 'À venir',
  soon: 'Bientôt',
  due: "Aujourd'hui",
  overdue: 'En retard',
};

export function deadlineTemporalColor(status: DeadlineTemporalStatus | null): string {
  switch (status) {
    case 'overdue':
      return colors.danger;
    case 'due':
    case 'soon':
      return colors.warning;
    case 'future':
      return colors.textPrimary;
    default:
      return colors.textSecondary;
  }
}
