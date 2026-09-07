import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { FormField } from '../../ui/FormField';

interface Account {
  id: string;
  name: string;
  type: string;
  status: 'actif' | 'archive';
  soldeCourant: number;
  isFavorite: boolean;
}

type AccountType = 'courant' | 'especes' | 'epargne' | 'autre';

const TYPE_LABEL: Record<AccountType, string> = {
  courant: 'Banque',
  especes: 'Espèces',
  epargne: 'Épargne',
  autre: 'Autre',
};

/** Comptes (Lot 1, docs/03 §I.11) — écran secondaire, jamais en navigation principale (§23). */
export function AccountsScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('courant');
  const [initialBalance, setInitialBalance] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // R5 clôture §2 — les comptes archivés restent visibles ici (pour être
      // réactivés depuis leur détail), jamais dans les sélecteurs de nouvelle
      // transaction (ceux-ci continuent d'utiliser listAccounts()).
      setAccounts(await api.listAllAccounts());
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
    if (!name.trim()) return;
    setCreating(true);
    try {
      const balance = initialBalance.trim() ? Number(initialBalance.replace(',', '.')) : 0;
      await api.createAccount({ name: name.trim(), type, initialBalance: balance });
      setName('');
      setInitialBalance('');
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
        data={accounts}
        keyExtractor={(a) => a.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.empty}>
              Commencez par ajouter votre compte principal pour connaître votre trésorerie.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            testID={`account-row-${item.id}`}
            style={[styles.row, item.status === 'archive' && styles.rowArchived]}
            onPress={() => navigation.navigate('AccountDetail', { id: item.id })}
          >
            <View>
              <Text style={styles.rowName}>
                {item.isFavorite ? '★ ' : ''}
                {item.name}
              </Text>
              <Text style={styles.rowType}>
                {TYPE_LABEL[item.type as AccountType] ?? item.type}
                {item.status === 'archive' ? ' · Archivé' : ''}
              </Text>
            </View>
            <Text style={styles.rowBalance}>{item.soldeCourant.toLocaleString('fr-FR')} DH</Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={{ paddingBottom: 8 }}
      />

      <View style={[styles.createBox, { paddingBottom: bottomInset }]}>
        <Text style={styles.sectionLabel}>Nouveau compte</Text>
        <View style={styles.typeRow}>
          {(Object.keys(TYPE_LABEL) as AccountType[]).map((t) => (
            <TouchableOpacity key={t} style={[styles.typeChip, type === t && styles.typeChipActive]} onPress={() => setType(t)}>
              <Text style={[styles.typeChipText, type === t && styles.typeChipTextActive]}>{TYPE_LABEL[t]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <FormField placeholder="Nom (ex. Compte principal)" value={name} onChangeText={setName} />
        <View style={styles.createRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Solde initial (DH, facultatif)"
            keyboardType="decimal-pad"
            value={initialBalance}
            onChangeText={setInitialBalance}
          />
          <TouchableOpacity style={styles.addButton} onPress={onCreate} disabled={creating}>
            {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.addButtonText}>+</Text>}
          </TouchableOpacity>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2', paddingTop: 16, paddingHorizontal: 20 },
  empty: { color: '#6B747C', textAlign: 'center', marginTop: 24, fontSize: 13, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  rowArchived: { opacity: 0.55 },
  rowName: { fontSize: 15, fontWeight: '600', color: '#172436' },
  rowType: { fontSize: 12, color: '#6B747C', marginTop: 2 },
  rowBalance: { fontSize: 15, fontWeight: '600', color: '#172436' },
  createBox: { borderTopWidth: 1, borderTopColor: '#E3E1DC', paddingTop: 12, marginTop: 8 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#172436', marginBottom: 8 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  typeChip: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  typeChipActive: { backgroundColor: '#172436', borderColor: '#172436' },
  typeChipText: { fontSize: 12, color: '#172436' },
  typeChipTextActive: { color: '#fff', fontWeight: '600' },
  createRow: { flexDirection: 'row', marginBottom: 8, alignItems: 'center' },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#E3E1DC',
    marginRight: 8,
  },
  addButton: { backgroundColor: '#172436', width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  error: { color: '#B3261E', fontSize: 13 },
});
