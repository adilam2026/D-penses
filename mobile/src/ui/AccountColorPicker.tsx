import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ACCOUNT_COLOR_OPTIONS } from './accountPalette';
import { colors, radius, spacing } from './theme';

/**
 * Palette compacte de couleur de carte (Lot ciblé §1) — ~10 teintes prédéfinies,
 * jamais un color picker libre. Réutilisé à la création ET à l'édition d'un compte.
 */
export function AccountColorSwatchGrid({ selected, onSelect }: { selected: string | null; onSelect: (key: string) => void }) {
  return (
    <View style={styles.grid}>
      {ACCOUNT_COLOR_OPTIONS.map((option) => {
        const isSelected = option.key === selected;
        return (
          <TouchableOpacity
            key={option.key}
            style={[styles.swatch, { backgroundColor: option.bg }, isSelected && styles.swatchSelected]}
            onPress={() => onSelect(option.key)}
            testID={`account-color-${option.key}`}
            accessibilityLabel={option.label}
          >
            {isSelected ? <Ionicons name="checkmark" size={18} color="#FFFFFF" /> : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const SWATCH_SIZE = 40;

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  swatch: { width: SWATCH_SIZE, height: SWATCH_SIZE, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  swatchSelected: { borderWidth: 3, borderColor: colors.textPrimary },
});
