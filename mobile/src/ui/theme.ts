import { Platform } from 'react-native';

/**
 * Design tokens Finance Maison — direction artistique « Foyer » (maquettes
 * validées) : fond crème chaleureux, accent terracotta, cartes à fort relief,
 * arrondis généreux. Remplace intégralement la précédente palette "corporate
 * sombre" — AUCUN écran ne doit mélanger les deux (jamais un hex en dur dans
 * un StyleSheet d'écran : tout passe par ces tokens).
 */

export const colors = {
  primary: '#E35B36',
  primaryDark: '#C24322',
  primaryLight: '#FBE4DA',

  // Accent structurel distinct du terracotta (CTA/brand) — réservé aux blocs
  // Épargne/Versements (Planning, icône de navigation) pour que ces deux
  // familles d'action restent visuellement différenciées, comme sur la
  // maquette validée.
  secondary: '#1B6E6E',
  secondaryLight: '#DEEEEC',

  success: '#5C8A3A',
  successLight: '#E9F1DF',
  danger: '#C14343',
  dangerLight: '#FBE7E3',
  warning: '#C98A12',
  warningLight: '#FBF0D6',

  textPrimary: '#241F18',
  textSecondary: '#716A5C',
  textPlaceholder: '#AFA594',
  textOnPrimary: '#FFFFFF',

  // Fond CRÈME chaleureux (maquette « Foyer » validée) — jamais blanc pur ni
  // gris-vert corporate : l'app doit rester lumineuse et vivante même
  // téléphone en mode sombre système (userInterfaceStyle "light" figé dans
  // app.json, donc ces valeurs sont TOUJOURS celles rendues, jamais
  // remplacées par l'OS).
  background: '#FBF7F0',
  surface: '#FFFFFF',
  surfaceSecondary: '#F2ECE0',
  // Teinte terracotta douce — utilisée uniquement pour des états
  // actifs/sélectionnés, jamais comme fond passif.
  surfaceActive: '#FBE4DA',

  border: '#E7DFD1',
  borderStrong: '#D9CBB3',
  divider: '#EFE8D9',

  donutTrack: '#F0E9DA',
  donutTrackWarn: '#F5EEDC',

  // Fond des modales/popups (overlay derrière une sheet) — teinte chaude
  // (encre) plutôt que l'ancien bleu-nuit corporate, pour rester cohérent
  // avec la nouvelle direction même derrière une modale.
  backdrop: 'rgba(36,24,10,0.45)',
} as const;

// Profondeur (maquette « Foyer » §relief) — ombre teintée encre chaude
// (jamais une teinte de marque saturée en ombre) pour une sensation
// "premium" sans surcharge visuelle.
export const elevation = {
  card: Platform.select({
    android: { elevation: 4 },
    default: { shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.1, shadowRadius: 8 },
  }),
  raised: Platform.select({
    android: { elevation: 8 },
    default: { shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.16, shadowRadius: 16 },
  }),
  /** Relief léger pour les boutons pleins (primaire/danger) — jamais sur les boutons secondaires plats. */
  button: Platform.select({
    android: { elevation: 2 },
    default: { shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.14, shadowRadius: 4 },
  }),
  /** Sensation "posée au-dessus de la page" pour les cartes hero colorées — sensiblement plus marqué que `raised`, ombre plus nette (rayon réduit, opacité accrue) pour renforcer l'effet 3D sans effet gadget. */
  floating: Platform.select({
    android: { elevation: 13 },
    default: { shadowColor: colors.textPrimary, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.26, shadowRadius: 14 },
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

// Arrondis généreux (maquette « Foyer » validée) — sensiblement plus marqués
// que l'ancienne direction corporate.
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const typography = {
  screenTitle: { fontSize: 22, fontWeight: '700' as const, color: colors.textPrimary },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: colors.textPrimary },
  sectionLabel: { fontSize: 13, fontWeight: '700' as const, color: colors.textPrimary },
  amountPrimary: { fontSize: 32, fontWeight: '800' as const, color: colors.textPrimary },
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
