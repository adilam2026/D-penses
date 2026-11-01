import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, resendEmailOtp } from '../../api/client';
import { colors, fontFamily, spacing } from '../../ui/theme';
import { AuthHeader } from './AuthHeader';
import { authStyles } from './authStyles';

const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Saisie du code à 6 chiffres reçu par email après signup (docs auth §OTP).
 * Aucun lien cliquable ni deep link : uniquement ce code, saisi manuellement.
 */
export function VerifyEmailScreen() {
  const { verifyEmail } = useAuth();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const email: string = route.params?.email ?? '';

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function onSubmit() {
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      await verifyEmail(email, code.trim());
      // Succès : le AuthProvider passe status à needsHousehold/signedIn, la
      // navigation se met à jour automatiquement (RootNavigator).
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Vérification impossible');
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    setError(null);
    setInfo(null);
    setResending(true);
    try {
      await resendEmailOtp(email);
      setInfo('Un nouveau code vient de vous être envoyé.');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi du code impossible');
    } finally {
      setResending(false);
    }
  }

  return (
    <KeyboardAvoidingView style={[authStyles.screen, { flex: 1 }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <AuthHeader compact />
      <View style={authStyles.card}>
        <Text style={authStyles.cardTitle}>Vérifiez votre email</Text>
        <Text style={authStyles.cardSubtitle}>
          Saisissez le code à 6 chiffres envoyé à{'\n'}
          {email}
        </Text>

        <TextInput
          style={[authStyles.input, styles.codeInput]}
          placeholder="000000"
          placeholderTextColor={colors.borderStrong}
          keyboardType="number-pad"
          maxLength={6}
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
        />

        {error ? <Text style={authStyles.error}>{error}</Text> : null}
        {info ? <Text style={[authStyles.info, styles.info]}>{info}</Text> : null}

        <TouchableOpacity
          style={[authStyles.button, code.trim().length !== 6 && authStyles.buttonDisabled]}
          onPress={onSubmit}
          disabled={loading || code.trim().length !== 6}
        >
          {loading ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={authStyles.buttonText}>Valider</Text>}
        </TouchableOpacity>
      </View>

      <View style={authStyles.links}>
        <TouchableOpacity onPress={onResend} disabled={resending || cooldown > 0}>
          <Text style={[authStyles.link, (resending || cooldown > 0) && styles.linkDisabled]}>
            {cooldown > 0 ? `Renvoyer le code (${cooldown}s)` : 'Renvoyer le code'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Login')}>
          <Text style={authStyles.linkMuted}>Retour à la connexion</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  codeInput: { marginTop: spacing.lg, fontSize: 26, letterSpacing: 10, textAlign: 'center', fontFamily: fontFamily.sansSemiBold },
  info: { color: colors.success },
  linkDisabled: { color: colors.textSecondary },
});
