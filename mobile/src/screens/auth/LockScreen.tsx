import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import { PIN_LENGTH } from '../../auth/pinRules';
import { PinDots, PinPad } from '../../ui/PinPad';
import { ForgotPinFlow } from './ForgotPinFlow';
import { authStyles } from './authStyles';

/**
 * Écran verrouillé : Finance Maison, prénom (jamais l'email), ○○○○○○, pavé
 * numérique, « Code oublié ? », « Changer d'utilisateur ». Le code est vérifié
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
    <ScrollView style={{ flex: 1 }} contentContainerStyle={[authStyles.screen, { flexGrow: 1 }]} testID="lock-screen" keyboardShouldPersistTaps="handled">
      <Text style={authStyles.brand}>Finance Maison</Text>
      <Text style={authStyles.name} testID="lock-name">
        {profile?.firstName ?? ''}
      </Text>

      {mode === 'pin' && (
        <>
          <PinDots length={PIN_LENGTH} filled={value.length} />
          {error ? (
            <Text style={authStyles.error} testID="lock-error">
              {error}
            </Text>
          ) : null}
          {busy ? <ActivityIndicator style={{ marginVertical: 24 }} /> : <PinPad value={value} onChange={onChange} maxLength={PIN_LENGTH} />}
          <View style={authStyles.links}>
            {profile ? (
              <TouchableOpacity onPress={() => setMode('forgot')} testID="lock-forgot">
                <Text style={authStyles.link}>Code oublié ?</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity onPress={() => (others.length > 0 ? setMode('switch') : switchUser(null))} testID="lock-switch-user">
              <Text style={authStyles.linkMuted}>Changer d'utilisateur</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {mode === 'forgot' && profile && <ForgotPinFlow initialEmail={profile.email} onCancel={() => setMode('pin')} />}

      {mode === 'switch' && (
        <View style={authStyles.links} testID="lock-switch-list">
          {others.map((p) => (
            <TouchableOpacity key={p.userId} onPress={() => switchUser(p)} testID={`lock-switch-to-${p.userId}`}>
              <Text style={authStyles.link}>{p.firstName}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => switchUser(null)} testID="lock-switch-other">
            <Text style={authStyles.link}>Autre compte</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode('pin')} testID="lock-switch-cancel">
            <Text style={authStyles.linkMuted}>Annuler</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}
