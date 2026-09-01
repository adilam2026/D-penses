import React, { useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Confirmation de facture (§5) — « Facture reçue » : saisie du montant réel et de
 * la billing_date. amount_initial_estimated est conservé côté serveur (RG-104),
 * jamais recalculé ici. Fonctionne aussi pour un montant jusque-là inconnu (§4/§17).
 */
export function ConfirmDeadlineScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const id = route.params?.id as string;
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    const numericAmount = Number(amount.replace(',', '.'));
    if (!numericAmount || numericAmount <= 0) {
      setError('Montant invalide');
      return;
    }
    setSubmitting(true);
    try {
      await api.updateDeadline(id, { amountCurrent: numericAmount, amountStatus: 'confirme', billingDate: todayIso() });
      navigation.goBack();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Confirmation impossible');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Facture reçue</Text>
      <Text style={styles.subtitle}>Saisissez le montant réel de la facture. L'estimation initiale, si elle existe, est conservée.</Text>

      <TextInput style={styles.input} placeholder="Montant réel (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} autoFocus />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Confirmer</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.cancel}>Annuler</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2', padding: 24, paddingTop: 40 },
  title: { fontSize: 20, fontWeight: '700', color: '#172436', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#6B747C', textAlign: 'center', marginBottom: 20 },
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
