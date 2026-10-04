import type { RecurrenceFrequency } from '../api/client';
import type { SelectOption } from './Select';

/** Fréquences éditables par l'utilisateur (ONCE n'est jamais choisi explicitement — réservé aux échéances ponctuelles). */
export type RecurrenceOption = Exclude<RecurrenceFrequency, 'ONCE'>;

/** Libellés de fréquence partagés (jamais dupliqués par écran — AjouterScreen, puis PlanningScreen pour modifier la périodicité d'une récurrence). */
export const RECURRENCE_FREQUENCY_LABELS: Record<RecurrenceOption, string> = {
  WEEKLY: 'Hebdomadaire',
  MONTHLY: 'Mensuelle',
  BIMONTHLY: 'Tous les 2 mois',
  QUARTERLY: 'Trimestrielle',
  SEMIANNUAL: 'Semestrielle',
  YEARLY: 'Annuelle',
};

export const RECURRENCE_FREQUENCY_OPTIONS: SelectOption[] = (Object.keys(RECURRENCE_FREQUENCY_LABELS) as RecurrenceOption[]).map((k) => ({
  value: k,
  label: RECURRENCE_FREQUENCY_LABELS[k],
}));
