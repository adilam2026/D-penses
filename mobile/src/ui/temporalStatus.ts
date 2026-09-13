import { colors } from './theme';

/**
 * Paiements/Échéances + Virements récurrents — statut temporel d'une date
 * d'événement (échéance de charge, occurrence de virement récurrent...),
 * calculé à la lecture, JAMAIS stocké (même doctrine backend : docs/02
 * §F.2/O.2). Seule implémentation de ce calcul dans l'app — extraite de
 * HomeScreen.urgencyColor (seul endroit qui le calculait à l'origine),
 * généralisée (jamais spécifique à Deadline) pour être réutilisée telle
 * quelle par toute date d'événement du foyer — jamais une seconde règle de
 * seuil ni une logique dupliquée.
 *
 * Comparaison au niveau JOUR CALENDAIRE, jamais un diff de timestamps en
 * millisecondes : une date du 13/09 reste "due" pendant TOUTE la journée du
 * 13/09, quelle que soit l'heure (le matin comme le soir) — dateIso est déjà
 * minuit UTC (convention @db.Date backend), "maintenant" est tronqué à son
 * jour calendaire UTC avant comparaison (utcDayIndex), jamais comparé à sa
 * valeur brute. Le seuil (seuilAPayerDays, déjà utilisé pour la fenêtre
 * d'alerte "bientôt à payer" du Dashboard) s'applique ensuite en nombre de
 * jours entiers, 4 paliers :
 *  - overdue : jour de l'événement strictement antérieur au jour courant
 *  - due     : jour de l'événement = jour courant
 *  - soon    : jour de l'événement strictement futur, dans la fenêtre (<= seuil)
 *  - future  : au-delà du seuil
 *
 * Un événement déjà clos (échéance soldée/annulée, occurrence de virement
 * confirmée/annulée...) ne doit JAMAIS apparaître overdue (ni aucun autre
 * palier — l'urgence n'a plus de sens une fois l'événement clos) : isClosed
 * renvoie null, pas de badge. Le sens de "clos" dépend du domaine appelant
 * (financialStatus pour une Deadline, status pour une occurrence de
 * RecurringTransfer...) — jamais couplé ici à un vocabulaire précis.
 */
export type TemporalStatus = 'future' | 'soon' | 'due' | 'overdue';

/** Jour calendaire UTC d'une Date (année/mois/jour uniquement, heure ignorée),
 * en nombre de jours depuis epoch — seul point de troncature heure→jour. */
function utcDayIndex(date: Date): number {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
}

export function temporalStatus(dateIso: string, seuilDays: number, isClosed?: boolean): TemporalStatus | null {
  if (isClosed) return null;

  const days = utcDayIndex(new Date(dateIso)) - utcDayIndex(new Date(Date.now()));
  if (days < 0) return 'overdue';
  if (days === 0) return 'due';
  if (days <= seuilDays) return 'soon';
  return 'future';
}

export const TEMPORAL_STATUS_LABEL: Record<TemporalStatus, string> = {
  future: 'À venir',
  soon: 'Bientôt',
  due: "Aujourd'hui",
  overdue: 'En retard',
};

export function temporalStatusColor(status: TemporalStatus | null): string {
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
