import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';

interface OpenDeadline {
  id: string;
  dueDate: string;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  resteAPayer: number | null;
  chargePlan: { label: string };
}

interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
}

const RECURRENCE_LABEL: Record<string, string> = {
  hebdomadaire: 'Hebdomadaire',
  mensuel: 'Mensuel',
  trimestriel: 'Trimestriel',
  semestriel: 'Semestriel',
  annuel: 'Annuel',
  ponctuel: 'Ponctuel',
};

const STATUS_LABEL: Record<string, string> = { inconnu: 'Montant inconnu', estime: 'Estimé', confirme: 'Confirmé' };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Charges récurrentes génériques + échéances ouvertes (Lot 1 — recette). */
export function ChargesScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [deadlines, setDeadlines] = useState<OpenDeadline[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [label, setLabel] = useState('');
  const [recurrence, setRecurrence] = useState('mensuel');
  const [dueDate, setDueDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [amountStatus, setAmountStatus] = useState<'estime' | 'confirme' | 'inconnu'>('estime');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [deadlineList, categoryList] = await Promise.all([api.listOpenDeadlines(), api.listCategories()]);
      setDeadlines(deadlineList);
      setCategories((categoryList as Category[]).filter((c) => c.kind === 'expense' || c.kind === 'both'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onCreate() {
    setError(null);
    if (!label.trim()) {
      setError('Un libellé est requis');
      return;
    }
    if (amountStatus !== 'inconnu' && (!amount.trim() || Number(amount.replace(',', '.')) <= 0)) {
      setError('Montant invalide');
      return;
    }
    setCreating(true);
    try {
      const plan = await api.createChargePlan({ label: label.trim(), startDate: dueDate, recurrenceRule: recurrence, categoryId: categoryId ?? undefined });
      await api.createDeadline(plan.id, {
        dueDate,
        amountStatus,
        amountCurrent: amountStatus !== 'inconnu' ? Number(amount.replace(',', '.')) : undefined,
      });
      setLabel('');
      setAmount('');
      setCategoryId(null);
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setCreating(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}>
        <Text style={styles.sectionTitle}>Échéances ouvertes</Text>
        {loading ? (
          <ActivityIndicator />
        ) : deadlines.length === 0 ? (
          <Text style={styles.empty}>Aucune échéance ouverte. Ajoutez une charge récurrente ci-dessous (loyer, internet, école...).</Text>
        ) : (
          deadlines.map((d) => (
            <TouchableOpacity key={d.id} style={styles.card} onPress={() => navigation.navigate('DeadlineDetail', { id: d.id })}>
              <Text style={styles.cardTitle}>{d.chargePlan.label}</Text>
              <Text style={styles.cardMeta}>
                Échéance du {formatDate(d.dueDate)} · {STATUS_LABEL[d.amountStatus]}
              </Text>
              <Text style={styles.cardAmount}>
                {d.resteAPayer !== null ? `${d.resteAPayer.toLocaleString('fr-FR')} DH restants` : 'Montant à confirmer'}
              </Text>
            </TouchableOpacity>
          ))
        )}

        <Text style={styles.sectionTitle}>Nouvelle charge récurrente</Text>
        <TextInput style={styles.input} placeholder="Libellé (ex. Internet, Loyer, École)" value={label} onChangeText={setLabel} />
        <View style={styles.chipRow}>
          {Object.keys(RECURRENCE_LABEL).map((r) => (
            <TouchableOpacity key={r} style={[styles.chip, recurrence === r && styles.chipActive]} onPress={() => setRecurrence(r)}>
              <Text style={[styles.chipText, recurrence === r && styles.chipTextActive]}>{RECURRENCE_LABEL[r]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput style={styles.input} placeholder="Date d'échéance (AAAA-MM-JJ)" value={dueDate} onChangeText={setDueDate} />
        <View style={styles.chipRow}>
          {(['estime', 'confirme', 'inconnu'] as const).map((s) => (
            <TouchableOpacity key={s} style={[styles.chip, amountStatus === s && styles.chipActive]} onPress={() => setAmountStatus(s)}>
              <Text style={[styles.chipText, amountStatus === s && styles.chipTextActive]}>{STATUS_LABEL[s]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {amountStatus !== 'inconnu' && (
          <TextInput style={styles.input} placeholder="Montant (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
        )}
        {categories.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Catégorie (facultatif)</Text>
            <View style={styles.chipRow}>
              {categories.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.chip, categoryId === c.id && styles.chipActive]}
                  onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
                >
                  <Text style={[styles.chipText, categoryId === c.id && styles.chipTextActive]}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={onCreate} disabled={creating}>
          {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Ajouter la charge</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  scroll: { padding: 20 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#172436', marginTop: 8, marginBottom: 8 },
  empty: { color: '#6B747C', fontSize: 13, lineHeight: 20 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#172436' },
  cardMeta: { fontSize: 12, color: '#6B747C', marginTop: 2 },
  cardAmount: { fontSize: 13, fontWeight: '700', color: '#172436', marginTop: 4 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#E3E1DC',
    marginBottom: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  chip: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  chipActive: { backgroundColor: '#172436', borderColor: '#172436' },
  chipText: { fontSize: 12, color: '#172436' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8 },
});
