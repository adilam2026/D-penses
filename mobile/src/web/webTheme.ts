import { Platform } from 'react-native';
import { accountCardPalette, colors as brand } from '../ui/theme';

/**
 * Portail Web v4 — charte VISUELLE dédiée, totalement séparée de ui/theme.ts
 * (mobile, jamais touché). Réutilise UNIQUEMENT les couleurs de marque déjà
 * définies (navy/vert/rouge/ambre/palette comptes — identité D-Penses+,
 * validé §5) ; tout le reste (rayons, espacements, ombres, typographie,
 * densité) est repensé pour un portail desktop dense, jamais un agrandissement
 * des tokens mobile.
 */

export const webColors = {
  // Identité conservée telle quelle (aucune couleur de marque réinventée).
  primary: brand.primary,
  success: brand.success,
  successLight: brand.successLight,
  danger: brand.danger,
  dangerLight: brand.dangerLight,
  warning: brand.warning,
  warningLight: brand.warningLight,
  textPrimary: brand.textPrimary,
  textSecondary: brand.textSecondary,
  textPlaceholder: brand.textPlaceholder,
  textOnPrimary: brand.textOnPrimary,
  sidebarBg: brand.heroBackground,
  sidebarTextMuted: brand.heroTextMuted,
  accountCardPalette,

  // Reset visuel — la palette "vivante" (D-Penses+ v6, déjà utilisée côté
  // mobile) est désormais aussi disponible côté Web : jusqu'ici webTheme ne
  // reprenait que navy/vert/rouge/ambre neutres, jamais teal/violet/or ni les
  // variantes "soft" — d'où un portail perçu comme plus pâle/administratif
  // que le mobile alors que la charte existait déjà.
  navy: brand.v6Navy,
  blue: brand.v6Blue,
  blueSoft: brand.v6BlueSoft,
  teal: brand.v6Teal,
  tealSoft: brand.v6TealSoft,
  amber: brand.v6Amber,
  amberSoft: brand.v6AmberSoft,
  red: brand.v6Red,
  redSoft: brand.v6RedSoft,
  purple: brand.v6Purple,
  purpleSoft: brand.v6PurpleSoft,
  gold: brand.v6Gold,
  redOnDark: brand.v6RedOnDark,
  tealOnDark: brand.v6TealOnDark,

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
