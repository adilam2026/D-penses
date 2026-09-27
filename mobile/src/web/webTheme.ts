import { Platform } from 'react-native';

/**
 * Portail Web v4 — charte VISUELLE dédiée, totalement séparée de ui/theme.ts
 * (mobile). Web reste gelé (reset Finance Maison, 2026-09-27) : ce fichier
 * n'importe plus ui/theme.ts (désormais propriété exclusive du mobile, palette
 * entièrement nouvelle) — ses propres valeurs sont reprises ici telles quelles,
 * inchangées, pour ne strictement rien modifier côté Web.
 */

export const accountCardPalette = ['#33A57C', '#5D79CD', '#C66F95'] as const;

export const webColors = {
  primary: '#172436',
  success: '#2E7D5B',
  successLight: '#E6F4EC',
  danger: '#B3261E',
  dangerLight: '#FBEDEC',
  warning: '#B8860B',
  warningLight: '#FFF7E6',
  textPrimary: '#172436',
  textSecondary: '#6B747C',
  textPlaceholder: '#9AA0A6',
  textOnPrimary: '#FFFFFF',
  sidebarBg: '#14344A',
  sidebarTextMuted: '#B9C6D0',
  accountCardPalette,

  navy: '#15304A',
  blue: '#355DF7',
  blueSoft: '#EEF2FF',
  teal: '#178A72',
  tealSoft: '#EAF7F3',
  amber: '#B47B18',
  amberSoft: '#FFF6E6',
  red: '#B94B4B',
  redSoft: '#FFF1F1',
  purple: '#8A68D6',
  purpleSoft: '#F2EEFB',
  gold: '#D49B37',
  redOnDark: '#FF9B8A',
  tealOnDark: '#8EE6C4',

  // Géométrie Web dédiée (densité SaaS desktop, jamais un agrandissement
  // mobile) — fond légèrement plus soutenu que l'ancien #F2F1ED (toujours issu
  // de la même famille neutre, pas une couleur choisie arbitrairement).
  background: '#EFEDE7',
  surface: '#FFFFFF',
  surfaceMuted: '#F7F6F3',
  surfaceActive: '#EEF0F3',
  border: '#E7E5DF',
  borderStrong: '#DBD8D0',
  tableHeaderBg: '#F7F6F3',
  tableRowBorder: '#EDEBE6',
  tableRowHover: '#FAFAF8',
} as const;

export const webRadius = { sm: 6, md: 8, lg: 10, xl: 12, pill: 999 } as const;

export const webSpacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

// Ombres quasi plates (portail dense) — l'élévation "portée" reste réservée
// aux popovers/drawers (webElevation.raised), jamais aux cartes de grille.
export const webElevation = {
  card: Platform.select({
    android: { elevation: 1 },
    default: { shadowColor: '#172436', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3 },
  }),
  raised: Platform.select({
    android: { elevation: 6 },
    default: { shadowColor: '#172436', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.14, shadowRadius: 20 },
  }),
} as const;

export const webTypography = {
  pageTitle: { fontSize: 20, fontWeight: '700' as const, color: webColors.textPrimary },
  cardTitle: { fontSize: 13, fontWeight: '700' as const, color: webColors.textPrimary },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: webColors.textPrimary },
  body: { fontSize: 13, color: webColors.textPrimary },
  caption: { fontSize: 11, color: webColors.textSecondary },
};

// Largeur utile portail (validé §2/§13 de la conception v4) — au-delà, marge
// neutre des deux côtés, jamais un contenu centré étriqué sur très grand écran.
export const MAX_CONTENT_WIDTH = 1600;
