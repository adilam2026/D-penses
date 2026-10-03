import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../ui/theme';

/**
 * Écran vide (Lot 0 — socle) : la navigation applicative existe et correspond
 * à l'architecture prévue (docs/03-parcours-et-ecrans.md §J.4), mais aucune
 * donnée financière n'est encore branchée (paiements, échéances, provisions,
 * budgets, simulateur et projections arrivent dans les lots suivants).
 */
export function PlaceholderScreen({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.background },
  title: { ...typography.sectionTitle, marginBottom: spacing.sm },
  subtitle: { ...typography.bodySecondary, textAlign: 'center' },
});
