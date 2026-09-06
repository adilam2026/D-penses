import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';

interface CreatedGoal {
  label: string;
  targetAmount: number;
  targetDate?: string;
}

/**
 * Création d'un objectif (§23/25) — pattern CRÉER → VOIR CE QUI EST CRÉÉ →
 * AJOUTER ENCORE ou CONTINUER (même convention que Budgets/Comptes/Revenus/Charges).
 */
export function CreateGoalScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [label, setLabel] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedGoal[]>([]);

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
      setCreated((prev) => [...prev, { label: label.trim(), targetAmount: numericAmount, targetDate: targetDate || undefined }]);
      setLabel('');
      setTargetAmount('');
      setTargetDate('');
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Nouvel objectif</Text>

        {created.length > 0 && (
          <View style={styles.createdBox}>
            <Text style={styles.sectionLabel}>Objectifs ajoutés</Text>
            {created.map((g, i) => (
              <Text key={i} style={styles.createdLine}>
                {g.label} — {g.targetAmount.toLocaleString('fr-FR')} DH{g.targetDate ? ` · ${g.targetDate}` : ''}
              </Text>
            ))}
          </View>
        )}

        <Text style={styles.sectionLabel}>Nom</Text>
        <TextInput style={styles.input} placeholder="ex. PC" value={label} onChangeText={setLabel} />

        <Text style={styles.sectionLabel}>Montant cible</Text>
        <TextInput style={styles.input} placeholder="15000" keyboardType="decimal-pad" value={targetAmount} onChangeText={setTargetAmount} />

        <Text style={styles.sectionLabel}>Date souhaitée (optionnelle)</Text>
        <TextInput style={styles.input} placeholder="AAAA-MM-JJ" value={targetDate} onChangeText={setTargetDate} />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{created.length > 0 ? 'Ajouter un autre objectif' : 'Créer'}</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.continueButton} onPress={() => navigation.goBack()}>
          <Text style={styles.continueButtonText}>{created.length > 0 ? 'Continuer' : 'Annuler'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  scroll: { padding: 24, paddingTop: 24 },
  title: { fontSize: 18, fontWeight: '700', color: '#172436', marginBottom: 16 },
  createdBox: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#E3E1DC' },
  createdLine: { fontSize: 13, color: '#172436', marginTop: 4 },
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
  continueButton: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 12, marginBottom: 24 },
  continueButtonText: { color: '#172436', fontWeight: '600', fontSize: 14 },
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8 },
});
