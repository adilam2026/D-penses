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

  // Fond BLANC (Lot recette §5, reconfirmé) — jamais teinté gris-vert pastel
  // (ancienne valeur #EEF1EC) : l'app doit rester lumineuse même téléphone en
  // mode sombre système (userInterfaceStyle "light" figé dans app.json, donc
  // ces valeurs sont TOUJOURS celles rendues, jamais remplacées par l'OS).
  // La séparation fond/carte vient désormais de l'ombre (elevation), pas d'une
  // teinte de fond différente.
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceSecondary: '#F0F1EF',
  // Teinte volontairement gardée proche du vert de marque (primary) — utilisée
  // uniquement pour des états actifs/sélectionnés, jamais comme fond passif.
  surfaceActive: '#E6F1EA',

  border: '#E2E4E0',
  borderStrong: '#CBCFC9',
  divider: '#EEF0ED',

  donutTrack: '#EEF2EF',
  donutTrackWarn: '#F5EEDC',
} as const;

// Profondeur (§7) : le fond passant au blanc pur, les cartes doivent se
// détacher par l'ombre seule — valeurs légèrement plus marquées qu'avant pour
// une sensation "premium" sans surcharge visuelle.
export const elevation = {
  card: Platform.select({
    android: { elevation: 4 },
    default: { shadowColor: colors.primaryDark, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.1, shadowRadius: 8 },
  }),
  raised: Platform.select({
    android: { elevation: 8 },
    default: { shadowColor: colors.primaryDark, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.16, shadowRadius: 16 },
  }),
  /** Relief léger pour les boutons pleins (primaire/danger) — jamais sur les boutons secondaires plats. */
  button: Platform.select({
    android: { elevation: 2 },
    default: { shadowColor: colors.primaryDark, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.14, shadowRadius: 4 },
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
