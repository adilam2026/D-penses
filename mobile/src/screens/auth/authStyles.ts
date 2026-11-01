import { StyleSheet } from 'react-native';
import { colors, elevation, fontFamily, radius, spacing, typography } from '../../ui/theme';

/**
 * Langage visuel commun des écrans d'authentification Finance Maison — même
 * identité que l'Accueil : fond crème, cartes blanches arrondies à ombre
 * légère, Fraunces pour les titres, accent corail.
 */
export const authStyles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
  },

  // Carte blanche (même famille que les cartes de comptes de l'Accueil).
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...elevation.card,
  },
  cardTitle: { ...typography.screenTitle },
  cardSubtitle: { ...typography.bodySecondary, marginTop: spacing.xs },
  cardCentered: { alignItems: 'center' },

  fieldLabel: {
    fontSize: 11,
    fontFamily: fontFamily.sansBold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginTop: spacing.lg,
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: 14,
  },
  inputInRow: { flex: 1, paddingVertical: 13, ...typography.body, fontSize: 15 },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    ...typography.body,
    fontSize: 15,
  },

  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.lg,
    ...elevation.button,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { fontSize: 15, fontFamily: fontFamily.sansBold, color: colors.textOnPrimary },

  // Hiérarchie des liens : une action secondaire corail, le reste discret.
  link: { fontSize: 14, fontFamily: fontFamily.sansBold, color: colors.primary, textAlign: 'center', paddingVertical: spacing.sm },
  linkMuted: { fontSize: 13, fontFamily: fontFamily.sansMedium, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.sm },
  linkSubtle: { fontSize: 12, fontFamily: fontFamily.sans, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.xs },
  linkStrong: { fontFamily: fontFamily.sansBold, color: colors.primary },
  links: { marginTop: spacing.md, alignItems: 'center' },
  linksRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.lg, marginTop: spacing.sm },

  name: { fontSize: 28, fontFamily: fontFamily.displayBold, color: colors.textPrimary, textAlign: 'center', marginTop: spacing.sm },
  prompt: { ...typography.sectionTitle, fontSize: 19, textAlign: 'center' },
  hint: { ...typography.caption, textAlign: 'center', marginTop: spacing.xs },
  error: { ...typography.bodySecondary, color: colors.danger, textAlign: 'center', marginTop: spacing.xs },
  info: { ...typography.bodySecondary, textAlign: 'center', marginTop: spacing.sm },

  // Pastille d'initiale (personne connue de l'appareil).
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 26, fontFamily: fontFamily.displayBold, color: colors.primary },
  avatarSmall: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarSmallText: { fontSize: 17, fontFamily: fontFamily.displayBold, color: colors.primary },

  // Ligne « personne » dans une carte (Continuer en tant que…, Changer d'utilisateur).
  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  personRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  personText: { flex: 1, ...typography.body, color: colors.textSecondary },
  personName: { fontSize: 16, fontFamily: fontFamily.sansBold, color: colors.textPrimary },
  personCard: { backgroundColor: colors.surface, borderRadius: radius.xl, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, ...elevation.card },

  separatorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.lg },
  separatorLine: { flex: 1, height: 1, backgroundColor: colors.border },
  separatorText: { ...typography.caption },

  padArea: { marginTop: spacing.lg },
  busy: { marginVertical: spacing.xxl },
});

/** Initiale affichée dans la pastille d'une personne connue (« ? » si prénom vide). */
export function initialOf(firstName: string | null | undefined): string {
  const first = (firstName ?? '').trim().charAt(0);
  return first ? first.toLocaleUpperCase('fr-FR') : '?';
}
