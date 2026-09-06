import type { SelectOption } from './Select';

/**
 * Fréquences du moteur générique de récurrence (recurrence.util.ts, backend) —
 * UNE seule source de libellés, réutilisée par Charges/Revenus/École (recette
 * post-Vague 3 §3/§10) : jamais une liste de chips dupliquée par écran.
 */
export const FREQUENCY_LABEL: Record<string, string> = {
  hebdomadaire: 'Hebdomadaire',
  mensuel: 'Mensuel',
  trimestriel: 'Trimestriel',
  semestriel: 'Semestriel',
  annuel: 'Annuel',
  ponctuel: 'Ponctuel',
};

export const ALL_FREQUENCY_OPTIONS: SelectOption[] = Object.entries(FREQUENCY_LABEL).map(([value, label]) => ({ value, label }));

export function frequencyOptions(values: readonly string[]): SelectOption[] {
  return values.map((value) => ({ value, label: FREQUENCY_LABEL[value] ?? value }));
}
