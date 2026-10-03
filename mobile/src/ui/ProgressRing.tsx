import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, typography } from './theme';

/**
 * Jauge circulaire d'objectif (maquette « Foyer » validée — Détail
 * Épargne/sous-compte) : pourcentage au centre + montant atteint/objectif en
 * sous-texte. Remplace la simple barre de progression plate pour l'écran de
 * détail d'un objectif (la barre plate reste utilisée dans les listes —
 * Épargne, Plans financiers — où l'espace est horizontal).
 */
export function ProgressRing({
  percent,
  size = 150,
  strokeWidth = 14,
  color = colors.secondary,
  trackColor = colors.surfaceSecondary,
  labelColor,
  subLabelColor,
  subLabel,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  /** Piste de fond de la jauge — translucide blanche quand la jauge est posée sur une carte colorée pleine (jamais la piste neutre par défaut, invisible sur fond vif). */
  trackColor?: string;
  labelColor?: string;
  subLabelColor?: string;
  subLabel: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - clamped / 100);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashoffset}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <Text style={[styles.percent, labelColor ? { color: labelColor } : null]}>{Math.round(clamped)}%</Text>
      <Text style={[styles.sub, subLabelColor ? { color: subLabelColor } : null]} numberOfLines={1}>
        {subLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  percent: { ...typography.amountSecondary, fontSize: 24 },
  sub: { ...typography.caption, marginTop: 2, maxWidth: 120, textAlign: 'center' },
});
