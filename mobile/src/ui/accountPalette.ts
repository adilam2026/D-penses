export interface AccountPalette {
  bg: string;
  text: string;
  textSecondary: string;
  divider: string;
  track: string;
}

/**
 * Identité couleur pleine carte par compte (Lot revert §6) — teintes riches
 * mais élégantes, jamais criardes, toujours avec du texte blanc lisible.
 * Rotation par index de compte (pas de logique métier, purement visuel).
 */
const ACCOUNT_PALETTES: AccountPalette[] = [
  { bg: '#2C4C86', text: '#FFFFFF', textSecondary: 'rgba(255,255,255,0.76)', divider: 'rgba(255,255,255,0.18)', track: 'rgba(255,255,255,0.28)' }, // bleu profond
  { bg: '#9C3F63', text: '#FFFFFF', textSecondary: 'rgba(255,255,255,0.76)', divider: 'rgba(255,255,255,0.18)', track: 'rgba(255,255,255,0.28)' }, // rose/bordeaux
  { bg: '#B8712A', text: '#FFFFFF', textSecondary: 'rgba(255,255,255,0.82)', divider: 'rgba(255,255,255,0.2)', track: 'rgba(255,255,255,0.3)' }, // ambre
  { bg: '#2F7A4F', text: '#FFFFFF', textSecondary: 'rgba(255,255,255,0.76)', divider: 'rgba(255,255,255,0.18)', track: 'rgba(255,255,255,0.28)' }, // vert
  { bg: '#8B3A3A', text: '#FFFFFF', textSecondary: 'rgba(255,255,255,0.8)', divider: 'rgba(255,255,255,0.18)', track: 'rgba(255,255,255,0.28)' }, // rouge brique
  { bg: '#5E4B8B', text: '#FFFFFF', textSecondary: 'rgba(255,255,255,0.8)', divider: 'rgba(255,255,255,0.18)', track: 'rgba(255,255,255,0.28)' }, // violet
];

export function accountPalette(index: number): AccountPalette {
  return ACCOUNT_PALETTES[index % ACCOUNT_PALETTES.length];
}

export interface AccountColorOption {
  key: string;
  label: string;
  bg: string;
}

/** Palette compacte proposée à la création/édition d'un compte (Lot ciblé §1) — ~10 teintes vives et élégantes, choix explicite, jamais de color picker libre. */
export const ACCOUNT_COLOR_OPTIONS: AccountColorOption[] = [
  { key: 'bleu', label: 'Bleu', bg: '#2E5FA3' },
  { key: 'bleu_petrole', label: 'Bleu pétrole', bg: '#1F5C63' },
  { key: 'turquoise', label: 'Turquoise', bg: '#1B8A93' },
  { key: 'vert', label: 'Vert', bg: '#2F7A4F' },
  { key: 'violet', label: 'Violet', bg: '#6C4B9E' },
  { key: 'mauve', label: 'Mauve', bg: '#8A5A9E' },
  { key: 'framboise', label: 'Framboise', bg: '#B23A6B' },
  { key: 'corail', label: 'Corail', bg: '#C1523A' },
  { key: 'orange', label: 'Orange', bg: '#C97A2B' },
  { key: 'ambre', label: 'Ambre', bg: '#B8862A' },
];

function paletteFromBg(bg: string): AccountPalette {
  return { bg, text: '#FFFFFF', textSecondary: 'rgba(255,255,255,0.78)', divider: 'rgba(255,255,255,0.18)', track: 'rgba(255,255,255,0.28)' };
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
