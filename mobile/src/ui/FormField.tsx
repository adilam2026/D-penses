import React, { useState } from 'react';
import { StyleProp, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { colors, radius, spacing, typography } from './theme';

export interface FormFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  /** Message d'erreur — bascule le contour en rouge, prioritaire sur helperText. */
  error?: string;
  /** Texte d'aide affiché sous le champ quand il n'y a pas d'erreur. */
  helperText?: string;
  testID?: string;
  /** Échappatoire pour un usage en ligne (ex. montant + bouton côte à côte) — jamais utilisé pour changer label/contour/focus/erreur, seulement l'agencement du conteneur (flex/marges). */
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * R5 clôture §5 — champ de formulaire partagé D-Penses+ : label, contour,
 * état focus, erreur, disabled, texte d'aide et espacement cohérents en un
 * seul composant — jamais une ré-implémentation par écran (même principe que
 * Select/ChoiceSheet, §19). `onFocus` reste transmis tel quel : un écran
 * utilisant useKeyboardAwareScroll passe toujours son `handleFocus` ici pour
 * garder le défilement clavier sûr (aucun changement de ce mécanisme).
 */
export function FormField({ label, error, helperText, testID, editable, onFocus, onBlur, containerStyle, ...inputProps }: FormFieldProps) {
  const [focused, setFocused] = useState(false);
  const disabled = editable === false;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        {...inputProps}
        testID={testID}
        editable={editable}
        style={[
          styles.input,
          focused && styles.inputFocused,
          !!error && styles.inputError,
          disabled && styles.inputDisabled,
        ]}
        placeholderTextColor={colors.textPlaceholder}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
      />
      {error ? (
        <Text style={styles.errorText} testID={testID ? `${testID}-error` : undefined}>
          {error}
        </Text>
      ) : helperText ? (
        <Text style={styles.helperText}>{helperText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.md },
  label: { fontSize: typography.sectionLabel.fontSize, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputFocused: { borderColor: colors.primary },
  inputError: { borderColor: colors.danger },
  inputDisabled: { opacity: 0.5, backgroundColor: colors.surfaceSecondary },
  helperText: { fontSize: typography.badge.fontSize, color: colors.textSecondary, marginTop: spacing.xs },
  errorText: { fontSize: typography.badge.fontSize, color: colors.danger, marginTop: spacing.xs, fontWeight: '600' },
});
