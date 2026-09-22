import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { webColors, webRadius, webSpacing } from '../webTheme';

interface Props {
  label: string;
  value: string;
  sub?: string;
  onPress?: () => void;
  testID?: string;
  /** Fond sombre (héro) vs. clair (carte blanche, ex. Projection) — jamais une 3e variante inventée. */
  variant?: 'dark' | 'light';
  /** Nombre (px) sur desktop/laptop, ou pourcentage (ex. "47%") pour une grille 2 colonnes en narrow. */
  width?: number | `${number}%`;
}

/**
 * Portail Web v4 — tuile KPI compacte, largeur fixe (jamais flex:1 étiré).
 * Composant partagé : ≥2 usages réels dès ce lot (héro Home, 4 tuiles) et
 * appelé à resservir sur Projection (WEB-V4.3).
 */
export function KpiTile({ label, value, sub, onPress, testID, variant = 'dark', width = 168 }: Props) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={[styles.tile, variant === 'light' && styles.tileLight, { width }]} onPress={onPress} testID={testID}>
      <Text style={[styles.label, variant === 'light' && styles.labelLight]}>{label}</Text>
      <Text style={[styles.value, variant === 'light' && styles.valueLight]}>{value}</Text>
      {sub ? <Text style={[styles.sub, variant === 'light' && styles.subLight]}>{sub}</Text> : null}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: webRadius.lg,
    padding: webSpacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
  },
  tileLight: { backgroundColor: webColors.surfaceMuted, borderColor: webColors.border },
  label: { fontSize: 10, fontWeight: '700', color: webColors.sidebarTextMuted },
  labelLight: { color: webColors.textSecondary },
  value: { fontSize: 16, fontWeight: '800', color: webColors.textOnPrimary, marginTop: 4 },
  valueLight: { color: webColors.textPrimary, fontSize: 14 },
  sub: { fontSize: 10, color: webColors.sidebarTextMuted, marginTop: 2 },
  subLight: { color: webColors.textSecondary },
});
