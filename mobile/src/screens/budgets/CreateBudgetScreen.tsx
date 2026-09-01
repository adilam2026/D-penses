import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';

interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Création d'un budget variable (§17) — saisie simple, les paramètres avancés restent secondaires. */
export function CreateBudgetScreen() {
  const navigation = useNavigation<any>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<'semaine' | 'mois'>('semaine');
  const [startDate, setStartDate] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listCategories()
      .then((list: Category[]) => setCategories(list.filter((c) => c.kind === 'expense' || c.kind === 'both')))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit() {
    setError(null);
    const numericAmount = Number(amount.replace(',', '.'));
    if (!categoryId) {
      setError('Choisissez une catégorie');
      return;
    }
    if (!numericAmount || numericAmount <= 0) {
      setError('Montant invalide');
      return;
    }
    setSubmitting(true);
    try {
      await api.createVariableBudget({ categoryId, referenceAmount: numericAmount, referencePeriod: period, startDate });
      navigation.goBack();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <Text style={styles.sectionLabel}>Catégorie</Text>
      {loading ? (
        <ActivityIndicator />
      ) : (
        <View style={styles.chipRow}>
          {categories.map((c) => (
            <TouchableOpacity key={c.id} style={[styles.chip, categoryId === c.id && styles.chipActive]} onPress={() => setCategoryId(c.id)}>
              <Text style={[styles.chipText, categoryId === c.id && styles.chipTextActive]}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Text style={styles.sectionLabel}>Montant</Text>
      <TextInput style={styles.input} placeholder="Montant (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />

      <Text style={styles.sectionLabel}>Période</Text>
      <View style={styles.segment}>
        <TouchableOpacity style={[styles.segmentItem, period === 'semaine' && styles.segmentActive]} onPress={() => setPeriod('semaine')}>
          <Text style={[styles.segmentText, period === 'semaine' && styles.segmentTextActive]}>Semaine</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segmentItem, period === 'mois' && styles.segmentActive]} onPress={() => setPeriod('mois')}>
          <Text style={[styles.segmentText, period === 'mois' && styles.segmentTextActive]}>Mois</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLabel}>Date de début</Text>
      <TextInput style={styles.input} placeholder="AAAA-MM-JJ" value={startDate} onChangeText={setStartDate} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Créer le budget</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.cancel}>Annuler</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  scroll: { padding: 24, paddingTop: 16 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#172436', marginBottom: 8, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
  chip: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  chipActive: { backgroundColor: '#172436', borderColor: '#172436' },
  chipText: { fontSize: 13, color: '#172436' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
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
  segment: { flexDirection: 'row', backgroundColor: '#EDEBE6', borderRadius: 10, padding: 4, marginBottom: 12 },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: '#fff' },
  segmentText: { fontSize: 13, color: '#6B747C', fontWeight: '600' },
  segmentTextActive: { color: '#172436' },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  cancel: { color: '#6B747C', textAlign: 'center', marginTop: 16, fontSize: 13, marginBottom: 24 },
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8 },
});
