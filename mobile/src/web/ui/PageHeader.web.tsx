import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { webColors, webSpacing } from '../webTheme';

interface Props {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

/**
 * Portail Web v4 §13 — en-tête de page standard (titre + action(s) à droite).
 * Composant partagé : Comptes/Budgets/Plans financiers ce lot (≥2 usages
 * réels), resservira sur Charges/Projection (WEB-V4.3).
 */
export function PageHeader({ title, subtitle, actions }: Props) {
  return (
    <View style={styles.row}>
      <View>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: webSpacing.lg },
  title: { fontSize: 20, fontWeight: '700', color: webColors.textPrimary },
  subtitle: { fontSize: 12, color: webColors.textSecondary, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: webSpacing.sm },
});
