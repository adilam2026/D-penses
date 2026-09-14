import React from 'react';
import { StyleSheet, View } from 'react-native';
import { webSpacing } from '../webTheme';

interface Props {
  children: React.ReactNode;
  /** Largeur de carte FIXE (jamais un pourcentage) — mécanisme validé §2. */
  cardWidth: number;
  /** Plafond de colonnes (validé §2 : 5 maximum sur Home) — le (maxColumns+1)e
   *  élément passe donc mécaniquement à la ligne suivante, quelle que soit la
   *  largeur d'écran disponible au-delà de ce plafond. */
  maxColumns?: number;
  gap?: number;
}

/**
 * Portail Web v4 §2/§13 — grille à largeur de carte FIXE + flex-wrap : le
 * nombre de colonnes se déduit mécaniquement de la largeur dispo (jamais une
 * carte étirée pour "remplir"), plafonné à `maxColumns`. Composant partagé :
 * Home l'utilise 3 fois ce lot (Comptes/Budgets/Plans) ; resservira sur les
 * écrans dédiés Comptes/Budgets/Plans (WEB-V4.2).
 */
export function CardGrid({ children, cardWidth, maxColumns = 5, gap = webSpacing.md }: Props) {
  const maxWidth = cardWidth * maxColumns + gap * (maxColumns - 1);
  return <View style={[styles.grid, { gap, maxWidth }]}>{children}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
});
