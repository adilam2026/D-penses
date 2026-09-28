import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from './theme';

/**
 * Feedback discret (Planning §1) — remplace la confirmation modale sur simple
 * tap : "Transaction marquée comme payée" / "Transaction remise à venir".
 * Contrôlé par le parent (message = null -> rien affiché) ; le parent gère
 * lui-même la temporisation d'auto-masquage.
 */
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.container} pointerEvents="none">
      <View style={styles.pill}>
        <Text style={styles.text} testID="toast-message">
          {message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', left: spacing.xl, right: spacing.xl, bottom: spacing.xxl, alignItems: 'center' },
  pill: { backgroundColor: colors.primaryDark, borderRadius: radius.pill, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, maxWidth: '90%' },
  text: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 13, textAlign: 'center' },
});
