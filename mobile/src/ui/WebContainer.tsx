import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { colors } from './theme';

const WEB_MAX_WIDTH = 560;

/**
 * W2 (minimal) — évite l'étirement de l'app sur grand écran Web : centre le
 * contenu dans une colonne à largeur maximale, fond extérieur neutre (charte).
 * No-op total sur natif (mobile/tablette) : rendu un simple passthrough,
 * jamais de wrapper supplémentaire hors web.
 */
export function WebContainer({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== 'web') {
    return <>{children}</>;
  }
  return (
    <View style={styles.outer}>
      <View style={styles.inner}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  inner: {
    flex: 1,
    width: '100%',
    maxWidth: WEB_MAX_WIDTH,
  },
});
