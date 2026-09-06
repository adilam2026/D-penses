import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';

interface IncomeSource {
  id: string;
  label: string;
  usualAmount: number;
  recurrenceRule: string | null;
}

interface Account {
  id: string;
  name: string;
}

const RECURRENCE_LABEL: Record<string, string> = {
  hebdomadaire: 'Hebdomadaire',
  mensuel: 'Mensuel',
  trimestriel: 'Trimestriel',
  semestriel: 'Semestriel',
  annuel: 'Annuel',
  ponctuel: 'Ponctuel',
};

/** Revenus (Lot 1 — recette) : sources de revenu récurrentes, séparées du cycle prévu → reçu (IncomeSourceDetailScreen). */
export function IncomeScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [sources, setSources] = useState<IncomeSource[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [recurrence, setRecurrence] = useState('mensuel');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sourceList, accountList] = await Promise.all([api.listIncomeSources(), api.listAccounts()]);
      setSources(sourceList);
      setAccounts(accountList);
      setAccountId((current) => current ?? accountList[0]?.id ?? null);
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
    const numericAmount = Number(amount.replace(',', '.'));
    if (!label.trim()) {
      setError('Un libellé est requis');
      return;
    }
    if (!numericAmount || numericAmount <= 0) {
      setError('Montant invalide');
      return;
    }
    if (!accountId) {
      setError('Créez un compte avant d\'ajouter un revenu');
      return;
    }
    setCreating(true);
    try {
      await api.createIncomeSource({
        label: label.trim(),
        usualAmount: numericAmount,
        defaultAccountId: accountId,
        isRecurring: recurrence !== 'ponctuel',
        recurrenceRule: recurrence,
      });
      setLabel('');
      setAmount('');
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setCreating(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={sources}
        keyExtractor={(s) => s.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={
          !loading ? <Text style={styles.empty}>Ajoutez votre salaire ou une autre source de revenu pour suivre vos rentrées d'argent.</Text> : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('IncomeSourceDetail', { id: item.id, label: item.label })}>
            <Text style={styles.rowName}>{item.label}</Text>
            <Text style={styles.rowMeta}>
              {item.usualAmount.toLocaleString('fr-FR')} DH · {RECURRENCE_LABEL[item.recurrenceRule ?? ''] ?? 'Ponctuel'}
            </Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={{ paddingBottom: 8 }}
      />

      <View style={[styles.createBox, { paddingBottom: bottomInset }]}>
        <Text style={styles.sectionLabel}>Nouvelle source de revenu</Text>
        <TextInput style={styles.input} placeholder="Libellé (ex. Salaire)" value={label} onChangeText={setLabel} />
        <TextInput style={styles.input} placeholder="Montant habituel (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
        <View style={styles.chipRow}>
          {Object.keys(RECURRENCE_LABEL).map((r) => (
            <TouchableOpacity key={r} style={[styles.chip, recurrence === r && styles.chipActive]} onPress={() => setRecurrence(r)}>
              <Text style={[styles.chipText, recurrence === r && styles.chipTextActive]}>{RECURRENCE_LABEL[r]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.chipRow}>
          {accounts.map((a) => (
            <TouchableOpacity key={a.id} style={[styles.chip, accountId === a.id && styles.chipActive]} onPress={() => setAccountId(a.id)}>
              <Text style={[styles.chipText, accountId === a.id && styles.chipTextActive]}>{a.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={onCreate} disabled={creating}>
          {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Ajouter</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2', paddingTop: 16, paddingHorizontal: 20 },
  empty: { color: '#6B747C', textAlign: 'center', marginTop: 24, fontSize: 13, lineHeight: 20 },
  row: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8 },
  rowName: { fontSize: 15, fontWeight: '600', color: '#172436' },
  rowMeta: { fontSize: 12, color: '#6B747C', marginTop: 2 },
  createBox: { borderTopWidth: 1, borderTopColor: '#E3E1DC', paddingTop: 12, marginTop: 8 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#172436', marginBottom: 8 },
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
