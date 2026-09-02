import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../../auth/AuthContext';
import { ApiError, resendEmailOtp } from '../../api/client';

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
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.title}>Vérifiez votre email</Text>
      <Text style={styles.subtitle}>Saisissez le code à 6 chiffres envoyé à{'\n'}{email}</Text>

      <TextInput
        style={styles.codeInput}
        placeholder="000000"
        keyboardType="number-pad"
        maxLength={6}
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, ''))}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {info ? <Text style={styles.info}>{info}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={loading || code.trim().length !== 6}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Valider</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={onResend} disabled={resending || cooldown > 0}>
        <Text style={[styles.link, (resending || cooldown > 0) && styles.linkDisabled]}>
          {cooldown > 0 ? `Renvoyer le code (${cooldown}s)` : 'Renvoyer le code'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate('Login')}>
        <Text style={styles.link}>Retour à la connexion</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F6F5F2' },
  title: { fontSize: 22, fontWeight: '700', color: '#172436', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#6B747C', textAlign: 'center', marginBottom: 24 },
  codeInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  link: { color: '#172436', textAlign: 'center', marginTop: 20, fontSize: 13 },
  linkDisabled: { color: '#9AA0A6' },
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8, textAlign: 'center' },
  info: { color: '#2E7D32', fontSize: 13, marginBottom: 8, textAlign: 'center' },
});
