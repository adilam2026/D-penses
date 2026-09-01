import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';

interface Child {
  id: string;
  firstName: string;
  lastName: string;
}

/** Enfants (Lot 0, docs/03) — écran secondaire, prérequis au module scolaire (Lot 4). */
export function ChildrenScreen() {
  const navigation = useNavigation<any>();
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChildren(await api.listChildren());
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
    if (!firstName.trim() || !lastName.trim()) return;
    setCreating(true);
    try {
      await api.createChild({ firstName: firstName.trim(), lastName: lastName.trim() });
      setFirstName('');
      setLastName('');
      await load();
    } finally {
      setCreating(false);
    }
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={children}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Aucun enfant pour l'instant.</Text> : null}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => navigation.getParent()?.navigate('ChildCosts', { id: item.id })}>
            <Text style={styles.rowName}>
              {item.firstName} {item.lastName}
            </Text>
            <Text style={styles.rowLink}>Coûts →</Text>
          </TouchableOpacity>
        )}
      />

      <Text style={styles.sectionLabel}>Ajouter un enfant</Text>
      <View style={styles.createRow}>
        <TextInput style={[styles.input, { flex: 1, marginRight: 8 }]} placeholder="Prénom" value={firstName} onChangeText={setFirstName} />
        <TextInput style={[styles.input, { flex: 1, marginRight: 8 }]} placeholder="Nom" value={lastName} onChangeText={setLastName} />
        <TouchableOpacity style={styles.addButton} onPress={onCreate} disabled={creating}>
          {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.addButtonText}>+</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2', paddingTop: 16, paddingHorizontal: 20 },
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
  rowLink: { fontSize: 12, color: '#6B747C' },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#172436', marginTop: 8, marginBottom: 8 },
  createRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  addButton: { backgroundColor: '#172436', width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { color: '#fff', fontSize: 20, fontWeight: '700' },
});
