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
