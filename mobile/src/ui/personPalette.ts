import { ACCOUNT_COLOR_OPTIONS, AccountColorOption } from './accountPalette';

/**
 * Couleur d'une PERSONNE (User.color) — clés miroir de
 * backend/src/households/person-colors.ts, teintes reprises telles quelles de
 * la palette des comptes (jamais une 2e liste de hex qui diverge). Ni vert,
 * ni orange, ni rouge : ces teintes portent déjà des états (payé, partiel,
 * négatif) dans le Planning.
 */
const PERSON_TO_ACCOUNT_COLOR: [key: string, label: string, accountKey: string][] = [
  ['bleu', 'Bleu', 'bleu_electrique'],
  ['rose', 'Rose', 'fuchsia'],
  ['violet', 'Violet', 'violet'],
  ['turquoise', 'Turquoise', 'turquoise'],
  ['azur', 'Azur', 'bleu_azur'],
  ['mauve', 'Mauve', 'mauve'],
];

export const PERSON_COLOR_OPTIONS: AccountColorOption[] = PERSON_TO_ACCOUNT_COLOR.map(([key, label, accountKey]) => ({
  key,
  label,
  bg: ACCOUNT_COLOR_OPTIONS.find((o) => o.key === accountKey)!.bg,
}));

/** Teinte d'une personne, ou undefined si aucune couleur (ou une clé inconnue) n'est renseignée — affichage neutre. */
export function personColor(colorKey: string | null | undefined): string | undefined {
  return colorKey ? PERSON_COLOR_OPTIONS.find((o) => o.key === colorKey)?.bg : undefined;
}
