import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
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
import { accountCreatedBus } from '../../state/events';

interface IncomeSource {
  id: string;
  label: string;
  usualAmount: number;
  recurrenceRule: string | null;
  recurrenceAnchorDate: string | null;
}

interface Account {
  id: string;
  name: string;
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

/** Jour habituel → date d'ancrage du mois courant, clampée (règle jour 29/30/31, Lot 11 §1). */
function anchorDateForDay(day: number): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clamped = Math.min(day, daysInMonth);
  return new Date(Date.UTC(year, month, clamped)).toISOString().slice(0, 10);
}

/** Revenus (Lot 1 — recette) : sources de revenu récurrentes, séparées du cycle prévu → reçu (IncomeSourceDetailScreen). */
export function IncomeScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [sources, setSources] = useState<IncomeSource[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [recurrence, setRecurrence] = useState('mensuel');
  const [anchorDay, setAnchorDay] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sourceList, accountList, categoryList] = await Promise.all([api.listIncomeSources(), api.listAccounts(), api.listCategories()]);
      setSources(sourceList);
      setAccounts(accountList);
      setCategories((categoryList as Category[]).filter((c) => c.kind === 'income' || c.kind === 'both'));
      setAccountId((current) => current ?? accountList[0]?.id ?? null);
      return accountList;
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().then((accountList) => {
        if (accountList && accountList.length === 0) promptCreateAccount();
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  useEffect(() => {
    return accountCreatedBus.on((created) => {
      load().then(() => setAccountId(created.id));
    });
  }, [load]);

  function promptCreateAccount() {
    Alert.alert(
      'Aucun compte configuré',
      "Créez d'abord un compte pour pouvoir y rattacher ce revenu.",
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Créer un compte', onPress: () => navigation.navigate('QuickCreateAccount') },
      ],
    );
  }

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
      promptCreateAccount();
      return;
    }
    const dayNumber = Number(anchorDay);
    if (recurrence !== 'ponctuel' && (!dayNumber || dayNumber < 1 || dayNumber > 31)) {
      setError('Jour habituel invalide (1 à 31)');
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
        recurrenceAnchorDate: recurrence !== 'ponctuel' ? anchorDateForDay(dayNumber) : undefined,
        categoryId: categoryId ?? undefined,
      });
      setLabel('');
      setAmount('');
      setAnchorDay('');
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
      <FlatList
        data={sources}
        keyExtractor={(s) => s.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListHeaderComponent={
          <Text style={styles.intro}>Ajoutez les revenus que vous recevez régulièrement — l'application anticipera automatiquement les prochains versements.</Text>
        }
        ListEmptyComponent={
          !loading ? <Text style={styles.empty}>Ajoutez votre salaire ou une autre source de revenu pour suivre vos rentrées d'argent.</Text> : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('IncomeSourceDetail', { id: item.id, label: item.label })}>
            <Text style={styles.rowName}>{item.label}</Text>
            <Text style={styles.rowMeta}>
              {item.usualAmount.toLocaleString('fr-FR')} DH · {RECURRENCE_LABEL[item.recurrenceRule ?? ''] ?? 'Ponctuel'}
              {item.recurrenceAnchorDate ? ` · le ${new Date(item.recurrenceAnchorDate).getUTCDate()}` : ''}
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
        {recurrence !== 'ponctuel' && (
          <TextInput
            style={styles.input}
            placeholder="Jour habituel de versement (1 à 31)"
            keyboardType="number-pad"
            maxLength={2}
            value={anchorDay}
            onChangeText={setAnchorDay}
          />
        )}
        <View style={styles.chipRow}>
          {accounts.map((a) => (
            <TouchableOpacity key={a.id} style={[styles.chip, accountId === a.id && styles.chipActive]} onPress={() => setAccountId(a.id)}>
              <Text style={[styles.chipText, accountId === a.id && styles.chipTextActive]}>{a.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {categories.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Catégorie (facultatif)</Text>
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
          {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Ajouter</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2', paddingTop: 16, paddingHorizontal: 20 },
  intro: { color: '#6B747C', fontSize: 13, lineHeight: 19, marginBottom: 12 },
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
