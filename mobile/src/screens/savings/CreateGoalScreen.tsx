import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';

/** Création d'un objectif (§23/25) — parcours simple : label, montant cible, date optionnelle. */
export function CreateGoalScreen() {
  const navigation = useNavigation<any>();
  const [label, setLabel] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    const numericAmount = Number(targetAmount.replace(',', '.'));
    if (!label.trim()) {
      setError('Nom requis');
      return;
    }
    if (!numericAmount || numericAmount <= 0) {
      setError('Montant cible invalide');
      return;
    }
    setSubmitting(true);
    try {
      await api.createGoal({ label: label.trim(), targetAmount: numericAmount, targetDate: targetDate || undefined });
      navigation.goBack();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Nouvel objectif</Text>

      <Text style={styles.sectionLabel}>Nom</Text>
      <TextInput style={styles.input} placeholder="ex. PC" value={label} onChangeText={setLabel} />

      <Text style={styles.sectionLabel}>Montant cible</Text>
      <TextInput style={styles.input} placeholder="15000" keyboardType="decimal-pad" value={targetAmount} onChangeText={setTargetAmount} />

      <Text style={styles.sectionLabel}>Date souhaitée (optionnelle)</Text>
      <TextInput style={styles.input} placeholder="AAAA-MM-JJ" value={targetDate} onChangeText={setTargetDate} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Créer</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.cancel}>Annuler</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2', padding: 24, paddingTop: 24 },
  title: { fontSize: 18, fontWeight: '700', color: '#172436', marginBottom: 16 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#172436', marginBottom: 8, marginTop: 4 },
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
  cancel: { color: '#6B747C', textAlign: 'center', marginTop: 16, fontSize: 13 },
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8 },
});
