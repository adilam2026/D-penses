/**
 * Couleurs d'identification d'une PERSONNE (User.color) — clés d'une palette
 * fixe, miroir de mobile/src/ui/personPalette.ts. Ni vert, ni orange, ni
 * rouge : ces teintes portent déjà des états (payé, partiel, négatif).
 */
export const PERSON_COLOR_KEYS = ['bleu', 'rose', 'violet', 'turquoise', 'azur', 'mauve'] as const;
export type PersonColorKey = (typeof PERSON_COLOR_KEYS)[number];
