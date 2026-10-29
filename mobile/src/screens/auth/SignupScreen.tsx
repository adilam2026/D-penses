import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import { CreatePinSteps } from './CreatePinSteps';

/**
 * Corrections UI/UX finales §17 (bug bloquant) — jamais "Erreur interne du
 * serveur" affiché tel quel : un 4xx (validation/conflit) porte déjà un
 * message métier clair côté backend (ex. "Un compte existe déjà avec cet
 * email", "Adresse email invalide") et est affiché tel quel ; un 5xx est une
 * vraie panne serveur, jamais montrée brute ; une erreur qui n'atteint même
 * pas le serveur (fetch échoue avant réponse HTTP) est une erreur réseau.
 */
function mapSignupError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status >= 500) return 'Impossible de créer le compte pour le moment. Réessayez.';
    return err.message;
  }
  return 'Erreur réseau — vérifiez votre connexion et réessayez.';
}

export function SignupScreen() {
  const { signUp } = useAuth();
  const navigation = useNavigation<any>();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  // Plus de mot de passe : l'inscription crée directement le code personnel à 6 chiffres.
  const [step, setStep] = useState<'info' | 'pin'>('info');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onPin(pin: string) {
    setError(null);
    setLoading(true);
    try {
      const trimmedEmail = email.trim();
      await signUp(trimmedEmail, pin, firstName.trim(), lastName.trim());
      navigation.navigate('VerifyEmail', { email: trimmedEmail });
    } catch (err) {
      setError(mapSignupError(err));
      setStep('info');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'pin') {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.brand}>Finance Maison</Text>
        <Text style={styles.title}>Votre code personnel</Text>
        {loading ? <ActivityIndicator /> : <CreatePinSteps onDone={onPin} />}
        <TouchableOpacity onPress={() => setStep('info')} testID="signup-back">
          <Text style={styles.link}>Retour</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  const canContinue = firstName.trim().length > 0 && lastName.trim().length > 0 && email.trim().length > 0;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.brand}>Finance Maison</Text>
      <Text style={styles.title}>Créer un compte</Text>

      <TextInput style={styles.input} placeholder="Prénom" value={firstName} onChangeText={setFirstName} />
      <TextInput style={styles.input} placeholder="Nom" value={lastName} onChangeText={setLastName} />
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, !canContinue && { opacity: 0.4 }]}
        onPress={() => {
          setError(null);
          setStep('pin');
        }}
        disabled={!canContinue}
        testID="signup-continue"
      >
        <Text style={styles.buttonText}>Continuer</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate('Login')}>
        <Text style={styles.link}>Déjà un compte ? Se connecter</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F6F5F2' },
  brand: { fontSize: 14, fontWeight: '700', color: '#03155C', textAlign: 'center', marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#172436', textAlign: 'center', marginBottom: 24 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  link: { color: '#172436', textAlign: 'center', marginTop: 20, fontSize: 13 },
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8 },
});
