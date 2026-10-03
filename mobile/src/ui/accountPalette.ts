export interface AccountPalette {
  bg: string;
  text: string;
  textSecondary: string;
  divider: string;
  track: string;
}

export interface AccountColorOption {
  key: string;
  label: string;
  bg: string;
}

/**
 * Palette compacte proposée à la création/édition d'un compte (Lot design §—
 * correction vivacité) — ~10 teintes franchement vives et lumineuses, jamais
 * grisées/marron/bordeaux sombre/pastel terne. Chaque hex est repris quasi
 * tel quel ; seuls les tons les plus clairs (turquoise, émeraude, corail,
 * orange, ambre) sont très légèrement assombris pour garantir un texte
 * blanc lisible — jamais au point de virer au terne/marron.
 */
export const ACCOUNT_COLOR_OPTIONS: AccountColorOption[] = [
  { key: 'bleu_electrique', label: 'Bleu électrique', bg: '#2563EB' },
  { key: 'bleu_azur', label: 'Bleu azur', bg: '#0284C7' },
  { key: 'turquoise', label: 'Turquoise', bg: '#0B8A8A' },
  { key: 'emeraude', label: 'Émeraude', bg: '#0E8A53' },
  { key: 'violet', label: 'Violet', bg: '#7C3AED' },
  { key: 'mauve', label: 'Mauve', bg: '#9742D9' },
  { key: 'fuchsia', label: 'Fuchsia', bg: '#DB2777' },
  { key: 'corail', label: 'Corail', bg: '#D93C3C' },
  { key: 'orange', label: 'Orange', bg: '#C2570E' },
  { key: 'ambre', label: 'Ambre', bg: '#A8740A' },
];

function paletteFromBg(bg: string): AccountPalette {
  return { bg, text: '#FFFFFF', textSecondary: 'rgba(255,255,255,0.82)', divider: 'rgba(255,255,255,0.2)', track: 'rgba(255,255,255,0.3)' };
}

// Rotation automatique (comptes créés avant le choix de couleur, ou sans
// colorKey reconnu) — dérivée directement de ACCOUNT_COLOR_OPTIONS pour que
// la carte affichée corresponde toujours exactement à une couleur de la
// palette de sélection (jamais une 2e liste de teintes qui diverge).
const ACCOUNT_PALETTES: AccountPalette[] = ACCOUNT_COLOR_OPTIONS.map((o) => paletteFromBg(o.bg));

export function accountPalette(index: number): AccountPalette {
  return ACCOUNT_PALETTES[index % ACCOUNT_PALETTES.length];
}

/**
 * Résout la palette d'un compte (Lot ciblé §1) : couleur choisie par
 * l'utilisateur si `colorKey` correspond à une option connue, sinon rotation
 * automatique par index — comportement inchangé pour les comptes créés avant
 * cette fonctionnalité (colorKey absent).
 */
export function paletteForAccount(colorKey: string | null | undefined, fallbackIndex: number): AccountPalette {
  const option = colorKey ? ACCOUNT_COLOR_OPTIONS.find((o) => o.key === colorKey) : undefined;
  return option ? paletteFromBg(option.bg) : accountPalette(fallbackIndex);
}
