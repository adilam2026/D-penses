import { StyleSheet } from 'react-native';
import { colors, fontFamily, radius, spacing, typography } from '../../ui/theme';

/** Langage visuel commun des écrans de connexion / verrouillage Finance Maison. */
export const authStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', paddingHorizontal: spacing.xl },
  brand: { fontSize: 14, fontFamily: fontFamily.sansBold, color: colors.textSecondary, textAlign: 'center', letterSpacing: 0.5 },
  name: { ...typography.screenTitle, fontSize: 26, textAlign: 'center', marginTop: spacing.sm },
  prompt: { ...typography.body, textAlign: 'center', color: colors.textSecondary, marginTop: spacing.md },
  error: { ...typography.bodySecondary, color: colors.danger, textAlign: 'center', marginBottom: spacing.sm },
  info: { ...typography.bodySecondary, textAlign: 'center', marginBottom: spacing.sm },
  link: { ...typography.body, color: colors.primaryDark, textAlign: 'center', paddingVertical: spacing.sm },
  linkMuted: { ...typography.bodySecondary, textAlign: 'center', paddingVertical: spacing.sm },
  links: { marginTop: spacing.lg, alignItems: 'center' },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: spacing.md,
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.border,
  },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { ...typography.body, color: colors.textOnPrimary, fontFamily: fontFamily.sansBold },
});
