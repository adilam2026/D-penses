import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import { PIN_LENGTH } from '../../auth/pinRules';
import { PinDots, PinPad } from '../../ui/PinPad';
import { ForgotPinFlow } from './ForgotPinFlow';
import { colors, spacing } from '../../ui/theme';
import { AuthHeader } from './AuthHeader';
import { authStyles, initialOf } from './authStyles';

/**
 * Écran verrouillé : Finance Maison (discret), initiale + prénom (jamais
 * l'email), ○○○○○○, pavé numérique, « Code oublié ? », « Changer
 * d'utilisateur » — on déverrouille, on ne se reconnecte pas. Le code est vérifié
 * par le serveur à 6 chiffres saisis, puis effacé de la mémoire.
 */
export function LockScreen() {
  const { profile, profiles, unlock, switchUser } = useAuth();
  const [mode, setMode] = useState<'pin' | 'forgot' | 'switch'>('pin');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onChange(next: string) {
    setValue(next);
    if (next.length < PIN_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(next);
    } catch (err) {
      setError(err instanceof ApiError && err.status < 500 ? err.message : 'Vérification impossible — vérifiez votre connexion.');
    } finally {
      setValue('');
      setBusy(false);
    }
  }

  const others = profiles.filter((p) => p.userId !== profile?.userId);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={[authStyles.screen, styles.screen]} testID="lock-screen" keyboardShouldPersistTaps="handled">
      <AuthHeader compact />

      {mode === 'pin' && (
        <View style={styles.center}>
          <View style={authStyles.avatar}>
            <Text style={authStyles.avatarText}>{initialOf(profile?.firstName)}</Text>
          </View>
          <Text style={authStyles.name} testID="lock-name">
            {profile?.firstName ?? ''}
          </Text>
          <PinDots length={PIN_LENGTH} filled={value.length} />
          {error ? (
            <Text style={[authStyles.error, styles.error]} testID="lock-error">
              {error}
            </Text>
          ) : null}
          {busy ? <ActivityIndicator style={authStyles.busy} color={colors.primary} /> : <PinPad value={value} onChange={onChange} maxLength={PIN_LENGTH} />}
          <View style={styles.links}>
            {profile ? (
              <TouchableOpacity onPress={() => setMode('forgot')} testID="lock-forgot">
                <Text style={authStyles.link}>Code oublié ?</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={() => (others.length > 0 ? setMode('switch') : switchUser(null))} testID="lock-switch-user">
              <Text style={authStyles.linkMuted}>Changer d'utilisateur</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {mode === 'forgot' && profile && <ForgotPinFlow initialEmail={profile.email} onCancel={() => setMode('pin')} />}

      {mode === 'switch' && (
        <View testID="lock-switch-list">
          <View style={authStyles.personCard}>
            {others.map((p) => (
              <TouchableOpacity
                key={p.userId}
                style={[authStyles.personRow, authStyles.personRowBorder]}
                onPress={() => switchUser(p)}
                testID={`lock-switch-to-${p.userId}`}
              >
                <View style={authStyles.avatarSmall}>
                  <Text style={authStyles.avatarSmallText}>{initialOf(p.firstName)}</Text>
                </View>
                <Text style={[authStyles.personText, authStyles.personName]}>{p.firstName}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={authStyles.personRow} onPress={() => switchUser(null)} testID="lock-switch-other">
              <View style={authStyles.avatarSmall}>
                <Ionicons name="person-add-outline" size={18} color={colors.primary} />
              </View>
              <Text style={[authStyles.personText, authStyles.personName]}>Autre compte</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => setMode('pin')} testID="lock-switch-cancel" style={authStyles.links}>
            <Text style={authStyles.linkMuted}>Annuler</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'flex-start', paddingTop: spacing.xxl },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  error: { marginBottom: spacing.sm },
  links: { marginTop: spacing.lg, alignItems: 'center' },
});
