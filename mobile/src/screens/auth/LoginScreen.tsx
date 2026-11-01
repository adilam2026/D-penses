import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import { PinDots, PinPad } from '../../ui/PinPad';
import { PIN_LENGTH } from '../../auth/pinRules';
import { colors, fontFamily, spacing } from '../../ui/theme';
import { AuthHeader } from './AuthHeader';
import { authStyles, initialOf } from './authStyles';

/** Ancien mot de passe numérique (8/9 chiffres) — uniquement pour la transition. */
const LEGACY_MIN = 6;
const LEGACY_MAX = 12;

/**
 * Première connexion sur l'appareil (ou « Autre compte ») : email, puis code
 * saisi sur le pavé numérique. Les personnes déjà connues de l'appareil sont
 * proposées par leur prénom (écran verrouillé, sans retaper l'email).
 */
export function LoginScreen() {
  const { signIn, profiles, switchUser } = useAuth();
  const navigation = useNavigation<any>();
  const [step, setStep] = useState<'email' | 'credential'>('email');
  // 'pin' (fonctionnement normal) : validation automatique au 6e chiffre.
  // 'legacy' (transition) : ancien mot de passe de longueur variable + « Se connecter ».
  const [mode, setMode] = useState<'pin' | 'legacy'>('pin');
  const [email, setEmail] = useState('');
  const [credential, setCredential] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(value: string) {
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim(), value);
    } catch (err) {
      setError(err instanceof ApiError && err.status < 500 ? err.message : 'Connexion impossible');
    } finally {
      setCredential('');
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={authStyles.screen} keyboardShouldPersistTaps="handled">
        <AuthHeader />

        {step === 'email' ? (
          <View>
            {profiles.length > 0 ? (
              <>
                <View style={authStyles.personCard}>
                  {profiles.map((p, i) => (
                    <TouchableOpacity
                      key={p.userId}
                      style={[authStyles.personRow, i < profiles.length - 1 && authStyles.personRowBorder]}
                      onPress={() => switchUser(p)}
                      testID={`login-profile-${p.userId}`}
                    >
                      <View style={authStyles.avatarSmall}>
                        <Text style={authStyles.avatarSmallText}>{initialOf(p.firstName)}</Text>
                      </View>
                      <Text style={authStyles.personText}>
                        Continuer en tant que <Text style={authStyles.personName}>{p.firstName}</Text>
                      </Text>
                      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={authStyles.separatorRow}>
                  <View style={authStyles.separatorLine} />
                  <Text style={authStyles.separatorText}>ou</Text>
                  <View style={authStyles.separatorLine} />
                </View>
              </>
            ) : null}

            <View style={authStyles.card}>
              <Text style={authStyles.cardTitle}>Bon retour</Text>
              <Text style={authStyles.cardSubtitle}>Connectez-vous à votre foyer</Text>
              <Text style={authStyles.fieldLabel}>ADRESSE EMAIL</Text>
              <View style={authStyles.inputRow}>
                <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
                <TextInput
                  style={authStyles.inputInRow}
                  placeholder="vous@exemple.com"
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  testID="login-email"
                />
              </View>
              <TouchableOpacity
                style={[authStyles.button, !email.trim() && authStyles.buttonDisabled]}
                disabled={!email.trim()}
                onPress={() => {
                  setError(null);
                  setStep('credential');
                }}
                testID="login-continue"
              >
                <Text style={authStyles.buttonText}>Continuer</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => navigation.navigate('Signup')} testID="login-signup-link" style={authStyles.links}>
              <Text style={authStyles.linkMuted}>
                Pas encore de compte ? <Text style={authStyles.linkStrong}>Créer un compte</Text>
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <View style={[authStyles.card, authStyles.cardCentered]}>
              <Text style={authStyles.cardTitle}>{mode === 'pin' ? 'Votre code' : 'Ancien mot de passe'}</Text>
              <View style={styles.emailRow}>
                <Text style={styles.emailText} numberOfLines={1}>
                  {email.trim()}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setCredential('');
                    setError(null);
                    setStep('email');
                  }}
                  testID="login-change-email"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.changeEmail}>Modifier</Text>
                </TouchableOpacity>
              </View>
              <PinDots
                length={mode === 'pin' ? PIN_LENGTH : Math.max(LEGACY_MIN, credential.length)}
                filled={credential.length}
              />
              {error ? (
                <Text style={authStyles.error} testID="login-error">
                  {error}
                </Text>
              ) : null}
            </View>

            <View style={authStyles.padArea}>
              {mode === 'pin' ? (
                loading ? (
                  <ActivityIndicator style={authStyles.busy} color={colors.primary} />
                ) : (
                  <PinPad
                    value={credential}
                    onChange={(next) => {
                      setCredential(next);
                      if (next.length === PIN_LENGTH) submit(next);
                    }}
                    maxLength={PIN_LENGTH}
                  />
                )
              ) : (
                <>
                  <PinPad value={credential} onChange={setCredential} maxLength={LEGACY_MAX} disabled={loading} />
                  <TouchableOpacity
                    style={[authStyles.button, credential.length < LEGACY_MIN && authStyles.buttonDisabled]}
                    onPress={() => submit(credential)}
                    disabled={loading || credential.length < LEGACY_MIN}
                    testID="login-submit"
                  >
                    {loading ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={authStyles.buttonText}>Se connecter</Text>}
                  </TouchableOpacity>
                </>
              )}
            </View>

            <View style={authStyles.links}>
              <TouchableOpacity onPress={() => navigation.navigate('ForgotPin', { email: email.trim() })} testID="login-forgot">
                <Text style={authStyles.link}>Code oublié ?</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setCredential('');
                  setError(null);
                  setMode(mode === 'pin' ? 'legacy' : 'pin');
                }}
                testID="login-toggle-legacy"
              >
                <Text style={authStyles.linkSubtle}>
                  {mode === 'pin' ? 'Première connexion avec votre ancien mot de passe ?' : 'Utiliser mon code à 6 chiffres'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs, maxWidth: '100%' },
  emailText: { flexShrink: 1, fontSize: 13, fontFamily: fontFamily.sans, color: colors.textSecondary },
  changeEmail: { fontSize: 13, fontFamily: fontFamily.sansBold, color: colors.primary },
});
