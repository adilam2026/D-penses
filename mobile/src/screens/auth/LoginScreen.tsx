import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import { PinDots, PinPad } from '../../ui/PinPad';
import { authStyles } from './authStyles';

/** Code à 6 chiffres, ou ancien mot de passe 8/9 chiffres tant que la transition n'est pas faite. */
const CREDENTIAL_MIN = 6;
const CREDENTIAL_MAX = 12;

/**
 * Première connexion sur l'appareil (ou « Autre compte ») : email, puis code
 * saisi sur le pavé numérique. Les personnes déjà connues de l'appareil sont
 * proposées par leur prénom (écran verrouillé, sans retaper l'email).
 */
export function LoginScreen() {
  const { signIn, profiles, switchUser } = useAuth();
  const navigation = useNavigation<any>();
  const [step, setStep] = useState<'email' | 'credential'>('email');
  const [email, setEmail] = useState('');
  const [credential, setCredential] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim(), credential);
    } catch (err) {
      setError(err instanceof ApiError && err.status < 500 ? err.message : 'Connexion impossible');
    } finally {
      setCredential('');
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[authStyles.screen, { flexGrow: 1 }]} keyboardShouldPersistTaps="handled">
        <Text style={authStyles.brand}>Finance Maison</Text>
        <Text style={authStyles.name}>Connexion</Text>

        {step === 'email' ? (
          <View style={{ marginTop: 24 }}>
            <TextInput
              style={authStyles.input}
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              testID="login-email"
            />
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
            <View style={authStyles.links}>
              {profiles.map((p) => (
                <TouchableOpacity key={p.userId} onPress={() => switchUser(p)} testID={`login-profile-${p.userId}`}>
                  <Text style={authStyles.link}>Continuer en tant que {p.firstName}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={() => navigation.navigate('Signup')} testID="login-signup-link">
                <Text style={authStyles.linkMuted}>Pas encore de compte ? Créer un compte</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View>
            <Text style={authStyles.prompt}>Saisissez votre code</Text>
            <PinDots length={Math.max(CREDENTIAL_MIN, credential.length)} filled={credential.length} />
            {error ? (
              <Text style={authStyles.error} testID="login-error">
                {error}
              </Text>
            ) : null}
            <PinPad value={credential} onChange={setCredential} maxLength={CREDENTIAL_MAX} disabled={loading} />
            <TouchableOpacity
              style={[authStyles.button, credential.length < CREDENTIAL_MIN && authStyles.buttonDisabled]}
              onPress={onSubmit}
              disabled={loading || credential.length < CREDENTIAL_MIN}
              testID="login-submit"
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={authStyles.buttonText}>Se connecter</Text>}
            </TouchableOpacity>
            <View style={authStyles.links}>
              <TouchableOpacity onPress={() => navigation.navigate('ForgotPin', { email: email.trim() })} testID="login-forgot">
                <Text style={authStyles.link}>Code oublié ?</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setCredential('');
                  setError(null);
                  setStep('email');
                }}
                testID="login-change-email"
              >
                <Text style={authStyles.linkMuted}>Modifier l'adresse email</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
