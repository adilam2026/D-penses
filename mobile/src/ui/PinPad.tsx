import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, spacing } from './theme';

/**
 * Saisie d'un code chiffré : ronds ○○○○○○ + pavé numérique dessiné par
 * l'application (jamais le clavier système, donc aucune lettre possible).
 * Les chiffres saisis ne sont jamais affichés, seulement le nombre de ronds
 * remplis (corail). Touches rondes à fond doux, corail clair pendant l'appui.
 */
export function PinDots({ length, filled, testID = 'pin-dots' }: { length: number; filled: number; testID?: string }) {
  return (
    <View style={styles.dots} testID={testID} accessibilityLabel={`${filled} chiffre${filled > 1 ? 's' : ''} saisi${filled > 1 ? 's' : ''} sur ${length}`}>
      {Array.from({ length }, (_, i) => (
        <View key={i} style={[styles.dot, i < filled && styles.dotFilled]} testID={`${testID}-${i}${i < filled ? '-filled' : ''}`} />
      ))}
    </View>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

export function PinPad({
  value,
  onChange,
  maxLength,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  maxLength: number;
  disabled?: boolean;
}) {
  function press(key: (typeof KEYS)[number]) {
    if (disabled) return;
    if (key === 'del') onChange(value.slice(0, -1));
    else if (key && value.length < maxLength) onChange(value + key);
  }
  return (
    <View style={styles.pad} testID="pin-pad">
      {KEYS.map((key, i) =>
        key === '' ? (
          <View key={i} style={styles.key} />
        ) : (
          <Pressable
            key={i}
            style={({ pressed }) => [styles.key, key === 'del' ? styles.keyDelete : styles.keyDigit, pressed && styles.keyPressed, disabled && styles.keyDisabled]}
            onPress={() => press(key)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={key === 'del' ? 'Effacer' : key}
            testID={`pin-key-${key}`}
          >
            {key === 'del' ? (
              <Ionicons name="backspace-outline" size={24} color={colors.textSecondary} />
            ) : (
              <Text style={styles.keyText}>{key}</Text>
            )}
          </Pressable>
        ),
      )}
    </View>
  );
}

// Pavé compact : 3 colonnes de touches rondes de 66 px (écart 22 px) et
// 4 rangées (écart 12 px) — environ 290 px de haut, pour tenir sans défiler.
const KEY_SIZE = 66;
const COLUMN_GAP = 22;
const ROW_GAP = 12;

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginVertical: spacing.lg },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  dotFilled: { backgroundColor: colors.primary, borderColor: colors.primary },
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: KEY_SIZE * 3 + COLUMN_GAP * 2,
    columnGap: COLUMN_GAP,
    rowGap: ROW_GAP,
    alignSelf: 'center',
  },
  key: { width: KEY_SIZE, height: KEY_SIZE, borderRadius: KEY_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  keyDigit: { backgroundColor: colors.surfaceMuted },
  keyDelete: { backgroundColor: 'transparent' },
  keyPressed: { backgroundColor: colors.primaryLight },
  keyDisabled: { opacity: 0.5 },
  keyText: { fontSize: 26, lineHeight: 32, fontFamily: fontFamily.sansSemiBold, color: colors.textPrimary, textAlign: 'center', includeFontPadding: false },
});
