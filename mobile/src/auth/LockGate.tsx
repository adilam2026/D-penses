import React, { useEffect } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';
import { useAuth } from './AuthContext';
import { LockScreen } from '../screens/auth/LockScreen';
import { colors, fontFamily } from '../ui/theme';

/**
 * Monté APRÈS (donc au-dessus de) toute la navigation : l'écran verrouillé et
 * le masque d'arrière-plan couvrent l'application entière. Tant que c'est
 * verrouillé, le bouton Retour Android est consommé — il ne révèle jamais
 * l'écran situé dessous.
 */
export function LockGate() {
  const { locked, masked, profile } = useAuth();

  useEffect(() => {
    if (!locked) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [locked]);

  if (locked) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.cover]} accessibilityViewIsModal testID="lock-gate">
        {/* Remonté à chaque changement de personne : aucune saisie, erreur ni étape d'un autre utilisateur ne subsiste. */}
        <LockScreen key={profile?.userId ?? 'none'} />
      </View>
    );
  }
  if (masked) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.cover, styles.mask]} accessibilityViewIsModal testID="privacy-mask">
        <Text style={styles.maskText}>Finance Maison</Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  cover: { backgroundColor: colors.background, zIndex: 1000, elevation: 1000 },
  mask: { alignItems: 'center', justifyContent: 'center' },
  maskText: { fontSize: 18, fontFamily: fontFamily.displayBold, color: colors.textSecondary },
});
