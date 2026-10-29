import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, spacing } from './theme';

/**
 * Saisie d'un code chiffré : ronds ○○○○○○ + pavé numérique dessiné par
 * l'application (jamais le clavier système, donc aucune lettre possible).
 * Les chiffres saisis ne sont jamais affichés, seulement le nombre de ronds
 * remplis.
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
          <TouchableOpacity
            key={i}
            style={styles.key}
            onPress={() => press(key)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={key === 'del' ? 'Effacer' : key}
            testID={`pin-key-${key}`}
          >
            {key === 'del' ? (
              <Ionicons name="backspace-outline" size={24} color={colors.textPrimary} />
            ) : (
              <Text style={styles.keyText}>{key}</Text>
            )}
          </TouchableOpacity>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md, marginVertical: spacing.lg },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: colors.textSecondary },
  dotFilled: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  pad: { flexDirection: 'row', flexWrap: 'wrap', width: 270, alignSelf: 'center' },
  key: { width: 90, height: 64, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 26, fontFamily: fontFamily.sansMedium, color: colors.textPrimary },
});
