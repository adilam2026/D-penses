import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';

type Mode = 'create' | 'join';

/**
 * Onboarding foyer (docs/03 §I.1, RG-001) : un utilisateur qui vient de
 * s'inscrire crée son foyer, ou en rejoint un existant via un code d'invitation
 * partagé par le premier adulte (cf. §J.2 « Rejoindre un foyer »).
 */
export function HouseholdSetupScreen() {
  const { createHousehold, joinHousehold, signOut } = useAuth();
  const [mode, setMode] = useState<Mode>('create');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    setLoading(true);
    try {
      if (mode === 'create') await createHousehold(name.trim());
      else await joinHousehold(code.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action impossible');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Votre foyer</Text>
      <Text style={styles.subtitle}>Créez votre foyer, ou rejoignez celui d'un proche avec son code d'invitation.</Text>

      <View style={styles.segment}>
        <TouchableOpacity style={[styles.segmentItem, mode === 'create' && styles.segmentActive]} onPress={() => setMode('create')}>
          <Text style={[styles.segmentText, mode === 'create' && styles.segmentTextActive]}>Créer un foyer</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segmentItem, mode === 'join' && styles.segmentActive]} onPress={() => setMode('join')}>
          <Text style={[styles.segmentText, mode === 'join' && styles.segmentTextActive]}>Rejoindre</Text>
        </TouchableOpacity>
      </View>

      {mode === 'create' ? (
        <TextInput style={styles.input} placeholder="Nom du foyer (ex. Famille Alami)" value={name} onChangeText={setName} />
      ) : (
        <TextInput style={styles.input} placeholder="Code d'invitation" autoCapitalize="characters" value={code} onChangeText={setCode} />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{mode === 'create' ? 'Créer' : 'Rejoindre'}</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={signOut}>
        <Text style={styles.link}>Se déconnecter</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F6F5F2' },
  title: { fontSize: 22, fontWeight: '700', color: '#172436', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 13, color: '#6B747C', textAlign: 'center', marginBottom: 24 },
  segment: { flexDirection: 'row', backgroundColor: '#EDEBE6', borderRadius: 10, padding: 4, marginBottom: 16 },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: '#fff' },
  segmentText: { fontSize: 13, color: '#6B747C', fontWeight: '600' },
  segmentTextActive: { color: '#172436' },
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
