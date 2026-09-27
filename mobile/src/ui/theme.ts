import { Platform } from 'react-native';

/**
 * Design tokens Finance Maison — palette entièrement nouvelle (reset total,
 * aucune valeur reprise de l'ancienne application). Source UNIQUE des
 * couleurs/espacements : jamais un hex en dur dans un StyleSheet d'écran.
 */

export const colors = {
  primary: '#1F3D34',
  primaryDark: '#142924',

  success: '#2F7A4F',
  successLight: '#E4F3E9',
  danger: '#A33B2E',
  dangerLight: '#FBEAE7',
  warning: '#9C6B14',
  warningLight: '#FBF0DD',

  textPrimary: '#1C2420',
  textSecondary: '#6B7570',
  textPlaceholder: '#9BA39D',
  textOnPrimary: '#FFFFFF',

  background: '#EEF1EC',
  surface: '#FFFFFF',
  surfaceSecondary: '#E7EBE4',
  surfaceActive: '#E2ECE6',

  border: '#DDE3D8',
  borderStrong: '#C7D0C0',
  divider: '#E7EBE4',

  donutTrack: '#E3EEE8',
  donutTrackWarn: '#F3E8D2',
} as const;

export const elevation = {
  card: Platform.select({
    android: { elevation: 3 },
    default: { shadowColor: colors.primaryDark, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6 },
  }),
  raised: Platform.select({
    android: { elevation: 6 },
    default: { shadowColor: colors.primaryDark, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 12 },
  }),
} as const;

/** Espacement cohérent — jamais une valeur magique par écran. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 18,
  xl: 22,
  xxl: 28,
} as const;

export const radius = {
  sm: 8,
  md: 10,
  lg: 14,
  xl: 18,
  pill: 999,
} as const;

export const typography = {
  screenTitle: { fontSize: 22, fontWeight: '700' as const, color: colors.textPrimary },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: colors.textPrimary },
  sectionLabel: { fontSize: 13, fontWeight: '700' as const, color: colors.textPrimary },
  amountPrimary: { fontSize: 30, fontWeight: '800' as const, color: colors.textPrimary },
  amountSecondary: { fontSize: 17, fontWeight: '700' as const, color: colors.textPrimary },
  body: { fontSize: 14, color: colors.textPrimary },
  bodySecondary: { fontSize: 13, color: colors.textSecondary },
  caption: { fontSize: 11, color: colors.textSecondary },
  badge: { fontSize: 10, fontWeight: '700' as const },
};

/** Niveaux de carte réutilisables : info (neutre), action (mise en avant), result (chiffre clé). */
export const cardVariants = {
  info: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, ...elevation.card },
  action: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  result: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.raised,
  },
} as const;
