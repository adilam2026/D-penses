import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius } from './theme';

export interface SegmentBarItem {
  key: string;
  value: number;
  color: string;
}

const SEGMENT_COLORS = ['#2F7A4F', '#9C6B14', '#3E6F8C', '#7A4FA3', '#A33B2E'];

/** Palette rotative — utilisée quand l'appelant ne fixe pas explicitement une couleur par segment. */
export function segmentColor(index: number): string {
  return SEGMENT_COLORS[index % SEGMENT_COLORS.length];
}

/**
 * Barre de répartition proportionnelle compacte (Accueil — maquette §4) : un
 * compte avec sous-comptes affiche immédiatement la part de chaque
 * sous-compte + le non-affecté, jamais juste une liste de montants bruts.
 */
export function SegmentBar({ items, total }: { items: SegmentBarItem[]; total: number }) {
  if (total <= 0) return null;
  return (
    <View style={styles.track}>
      {items
        .filter((item) => item.value > 0)
        .map((item) => (
          <View key={item.key} style={{ flex: item.value / total, backgroundColor: item.color }} />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: 6,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: colors.donutTrack,
  },
});
