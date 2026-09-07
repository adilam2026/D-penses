/**
 * Design tokens D-Penses+ (Lot recette téléphone réel §15). Source UNIQUE des
 * couleurs de l'application — jamais un hex en dur dans un StyleSheet d'écran.
 * Valeurs reprises telles quelles depuis l'usage réel dominant (audit du code
 * existant) pour ne rien casser visuellement : aucune nouvelle couleur choisie
 * arbitrairement, seulement une centralisation + quelques quasi-doublons
 * fusionnés (ex. plusieurs verts clairs très proches → un seul token).
 */

export const colors = {
  // Marque / texte
  primary: '#172436', // bleu nuit D-Penses+ — texte principal, boutons primaires
  primaryDark: '#0F1A29',

  // États sémantiques
  success: '#2E7D5B',
  successLight: '#E6F4EC',
  danger: '#B3261E',
  dangerLight: '#FBEDEC',
  warning: '#B8860B',
  warningLight: '#FFF7E6',

  // Texte
  textPrimary: '#172436',
  textSecondary: '#6B747C',
  textPlaceholder: '#9AA0A6',
  textOnPrimary: '#FFFFFF',

  // Fonds / surfaces
  background: '#F6F5F2', // fond d'écran
  surface: '#FFFFFF', // carte principale
  surfaceSecondary: '#EDEBE6', // chip/diviseur/fond secondaire
  surfaceActive: '#EEF0F3', // sélection/état actif clair

  // Bordures
  border: '#E3E1DC',
  divider: '#EDEBE6',
} as const;

/** Espacement cohérent (§18 densité) — jamais une valeur magique par écran. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  pill: 999,
} as const;

/** Échelle typographique (§18) — titres/montants/labels cohérents partout. */
export const typography = {
  screenTitle: { fontSize: 22, fontWeight: '700' as const, color: colors.textPrimary },
  sectionTitle: { fontSize: 15, fontWeight: '700' as const, color: colors.textPrimary },
  sectionLabel: { fontSize: 13, fontWeight: '600' as const, color: colors.textPrimary },
  amountPrimary: { fontSize: 28, fontWeight: '800' as const, color: colors.textPrimary },
  amountSecondary: { fontSize: 16, fontWeight: '700' as const, color: colors.textPrimary },
  body: { fontSize: 14, color: colors.textPrimary },
  bodySecondary: { fontSize: 13, color: colors.textSecondary },
  caption: { fontSize: 11, color: colors.textSecondary },
  badge: { fontSize: 10, fontWeight: '700' as const },
};

/**
 * Niveaux de carte (§17) — jamais le même traitement partout :
 * A. information (neutre), B. action (mise en avant), C. alerte, D. résultat financier.
 */
export const cardVariants = {
  info: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  action: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  alert: {
    backgroundColor: colors.dangerLight,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
  },
  warningAlert: {
    backgroundColor: colors.warningLight,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  result: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
} as const;
