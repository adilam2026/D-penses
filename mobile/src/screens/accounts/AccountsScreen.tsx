import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useAuth } from '../../auth/AuthContext';

interface Account {
  id: string;
  name: string;
  type: string;
  soldeCourant: number;
  isFavorite: boolean;
}

/** Comptes (Lot 1, docs/03 §I.11) — écran secondaire, jamais en navigation principale (§23). */
export function AccountsScreen() {
  const { signOut } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts(await api.listAccounts());
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
    if (!name.trim()) return;
    setCreating(true);
    try {
      await api.createAccount({ name: name.trim(), type: 'courant', initialBalance: 0 });
      setName('');
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function onSetFavorite(id: string) {
    await api.setAccountFavorite(id);
    await load();
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Comptes</Text>
      <FlatList
        data={accounts}
        keyExtractor={(a) => a.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Aucun compte pour l'instant.</Text> : null}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => onSetFavorite(item.id)}>
            <View>
              <Text style={styles.rowName}>
                {item.isFavorite ? '★ ' : ''}
                {item.name}
              </Text>
              <Text style={styles.rowType}>{item.type}</Text>
            </View>
            <Text style={styles.rowBalance}>{item.soldeCourant.toLocaleString('fr-FR')} DH</Text>
          </TouchableOpacity>
        )}
      />

      <View style={styles.createRow}>
        <TextInput style={styles.input} placeholder="Nouveau compte (ex. Trésorerie)" value={name} onChangeText={setName} />
        <TouchableOpacity style={styles.addButton} onPress={onCreate} disabled={creating}>
          {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.addButtonText}>+</Text>}
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={signOut} style={styles.logout}>
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2', paddingTop: 56, paddingHorizontal: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#172436', marginBottom: 16 },
  empty: { color: '#6B747C', textAlign: 'center', marginTop: 24 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  rowName: { fontSize: 15, fontWeight: '600', color: '#172436' },
  rowType: { fontSize: 12, color: '#6B747C', marginTop: 2 },
  rowBalance: { fontSize: 15, fontWeight: '600', color: '#172436' },
  createRow: { flexDirection: 'row', marginTop: 12, alignItems: 'center' },
  input: {
    flex: 1,
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
  logout: { marginTop: 20, marginBottom: 20, alignItems: 'center' },
  logoutText: { color: '#B3261E', fontSize: 13, fontWeight: '600' },
});
