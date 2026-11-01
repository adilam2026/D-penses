import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import { colors, spacing, typography } from '../../ui/theme';
import { AuthHeader } from './AuthHeader';
import { CreatePinSteps } from './CreatePinSteps';
import { authStyles } from './authStyles';

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
      <ScrollView contentContainerStyle={authStyles.screen} keyboardShouldPersistTaps="handled">
        <AuthHeader compact />
        <Text style={styles.stepTitle}>Votre code personnel</Text>
        {loading ? <ActivityIndicator style={authStyles.busy} color={colors.primary} /> : <CreatePinSteps onDone={onPin} />}
        <TouchableOpacity onPress={() => setStep('info')} testID="signup-back" style={authStyles.links}>
          <Text style={authStyles.linkMuted}>Retour</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  const canContinue = firstName.trim().length > 0 && lastName.trim().length > 0 && email.trim().length > 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={authStyles.screen} keyboardShouldPersistTaps="handled">
        <AuthHeader />
        <View style={authStyles.card}>
          <Text style={authStyles.cardTitle}>Créer un compte</Text>
          <Text style={authStyles.cardSubtitle}>Quelques informations pour commencer</Text>

          <Text style={authStyles.fieldLabel}>PRÉNOM</Text>
          <TextInput style={authStyles.input} placeholder="Prénom" placeholderTextColor={colors.textSecondary} value={firstName} onChangeText={setFirstName} />
          <Text style={authStyles.fieldLabel}>NOM</Text>
          <TextInput style={authStyles.input} placeholder="Nom" placeholderTextColor={colors.textSecondary} value={lastName} onChangeText={setLastName} />
          <Text style={authStyles.fieldLabel}>ADRESSE EMAIL</Text>
          <View style={authStyles.inputRow}>
            <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
            <TextInput
              style={authStyles.inputInRow}
              placeholder="Email"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
          </View>
          {error ? <Text style={authStyles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[authStyles.button, !canContinue && authStyles.buttonDisabled]}
            onPress={() => {
              setError(null);
              setStep('pin');
            }}
            disabled={!canContinue}
            testID="signup-continue"
          >
            <Text style={authStyles.buttonText}>Continuer</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => navigation.navigate('Login')} style={authStyles.links}>
          <Text style={authStyles.linkMuted}>
            Déjà un compte ? <Text style={authStyles.linkStrong}>Se connecter</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  stepTitle: { ...typography.sectionTitle, fontSize: 18, textAlign: 'center', marginBottom: spacing.md },
});
