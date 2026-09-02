import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';

export function SignupScreen() {
  const { signUp } = useAuth();
  const navigation = useNavigation<any>();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    setLoading(true);
    try {
      const trimmedEmail = email.trim();
      await signUp(trimmedEmail, password, firstName.trim(), lastName.trim());
      navigation.navigate('VerifyEmail', { email: trimmedEmail });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Inscription impossible');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
      <TextInput
        style={styles.input}
        placeholder="Mot de passe (8 caractères min.)"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Créer mon compte</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate('Login')}>
        <Text style={styles.link}>Déjà un compte ? Se connecter</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F6F5F2' },
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
