import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';

interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
  isSystem: boolean;
}

const KIND_LABEL: Record<Category['kind'], string> = { income: 'Revenu', expense: 'Dépense', both: 'Les deux' };

/** ☰ Paramètres → Catégories. Les catégories système restent en lecture seule (jamais renommées/supprimées ici). */
export function CategoriesScreen() {
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Category['kind']>('expense');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCategories(await api.listCategories());
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
    if (!name.trim()) {
      setError('Un nom est requis');
      return;
    }
    setCreating(true);
    try {
      await api.createCategory({ name: name.trim(), kind });
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setCreating(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}>
      <Text style={styles.intro}>Vos catégories organisent revenus et dépenses. Les catégories système sont partagées par tous les foyers.</Text>

      {loading ? (
        <ActivityIndicator />
      ) : (
        categories.map((c) => (
          <View key={c.id} style={styles.row}>
            <Text style={styles.rowLabel}>{c.name}</Text>
            <Text style={styles.rowMeta}>{c.isSystem ? 'Système' : KIND_LABEL[c.kind]}</Text>
          </View>
        ))
      )}

      <Text style={styles.sectionTitle}>Nouvelle catégorie</Text>
      <TextInput style={styles.input} placeholder="Nom (ex. Cadeaux)" value={name} onChangeText={setName} onFocus={handleFocus} />
      <View style={styles.chipRow}>
        {(['expense', 'income', 'both'] as const).map((k) => (
          <TouchableOpacity key={k} style={[styles.chip, kind === k && styles.chipActive]} onPress={() => setKind(k)}>
            <Text style={[styles.chipText, kind === k && styles.chipTextActive]}>{KIND_LABEL[k]}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={onCreate} disabled={creating}>
        {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Ajouter</Text>}
      </TouchableOpacity>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  scroll: { padding: 20 },
  intro: { color: '#6B747C', fontSize: 13, lineHeight: 19, marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  rowLabel: { fontSize: 13, fontWeight: '600', color: '#172436' },
  rowMeta: { fontSize: 11, color: '#6B747C' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#172436', marginTop: 20, marginBottom: 8 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
  chip: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: '#E3E1DC' },
  chipActive: { backgroundColor: '#172436', borderColor: '#172436' },
  chipText: { fontSize: 13, color: '#172436' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8 },
});
