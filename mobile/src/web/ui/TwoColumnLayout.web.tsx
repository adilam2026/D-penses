import React from 'react';
import { StyleSheet, View } from 'react-native';
import { webSpacing } from '../webTheme';

interface Props {
  /** Colonne principale — 70-75% (contenu riche : blocs/listes). */
  main: React.ReactNode;
  /** Colonne d'action — 25-30%, sticky sur desktop large. */
  panel: React.ReactNode;
}

/**
 * Portail Web v4 §1/§7 (WEB-V4.2 révisé) — mise en page à deux colonnes
 * (contenu riche + panneau d'action sticky). `flexBasis`+`flexWrap` fait
 * naturellement repasser le panneau sous le contenu sur laptop/étroit
 * (jamais un breakpoint dur) ; `position: sticky` (Web only) le fixe à
 * l'écran tant que la largeur le permet. Composant partagé : Comptes /
 * Budgets / Plans financiers (3 usages réels ce lot).
 */
export function TwoColumnLayout({ main, panel }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.main}>{main}</View>
      <View style={styles.panel}>{panel}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: webSpacing.xl, alignItems: 'flex-start' },
  main: { flexGrow: 3, flexBasis: 640, minWidth: 0 },
  panel: {
    flexGrow: 1,
    flexBasis: 300,
    maxWidth: 360,
    minWidth: 280,
    // @ts-expect-error 'sticky' est une valeur Web-only de position (react-native-web).
    position: 'sticky',
    top: webSpacing.xl,
  },
});
