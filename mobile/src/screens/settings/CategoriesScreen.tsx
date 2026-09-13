import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { FormField } from '../../ui/FormField';
import { colors, radius, spacing } from '../../ui/theme';

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
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCategories(await api.listCategories());
    } finally {
      setLoading(false);
    }
  }, []);

  // R5 clôture §3 — une catégorie système n'est jamais proposée à la suppression
  // (déjà refusée côté backend de toute façon, mais l'action n'apparaît même pas
  // ici). Confirmation explicite avant tout appel DELETE (§12 — jamais silencieux
  // pour une action destructive). Le backend porte seul la règle d'intégrité
  // (catégorie utilisée ou non) : son message d'erreur est affiché tel quel,
  // jamais un second contrôle dupliqué ici.
  function onRequestDelete(category: Category) {
    setError(null);
    Alert.alert('Supprimer cette catégorie ?', `« ${category.name} » sera définitivement supprimée.`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(category.id);
          try {
            await api.deleteCategory(category.id);
            await load();
          } catch (err) {
            setError(err instanceof api.ApiError ? err.message : 'Suppression impossible');
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  }

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
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{c.name}</Text>
                <Text style={styles.rowMeta}>{c.isSystem ? 'Système' : KIND_LABEL[c.kind]}</Text>
              </View>
              {!c.isSystem && (
                <TouchableOpacity
                  testID={`category-delete-${c.id}`}
                  onPress={() => onRequestDelete(c)}
                  disabled={deletingId === c.id}
                >
                  {deletingId === c.id ? <ActivityIndicator size="small" /> : <Text style={styles.deleteLink}>Supprimer</Text>}
                </TouchableOpacity>
              )}
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Nouvelle catégorie</Text>
        <FormField testID="category-name-input" placeholder="Nom (ex. Cadeaux)" value={name} onChangeText={setName} onFocus={handleFocus} />
        <View style={styles.chipRow}>
          {(['expense', 'income', 'both'] as const).map((k) => (
            <TouchableOpacity key={k} style={[styles.chip, kind === k && styles.chipActive]} onPress={() => setKind(k)}>
              <Text style={[styles.chipText, kind === k && styles.chipTextActive]}>{KIND_LABEL[k]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={onCreate} disabled={creating} testID="category-create-submit">
          {creating ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Ajouter</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: spacing.lg },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  rowLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  rowMeta: { fontSize: 11, color: colors.textSecondary },
  deleteLink: { fontSize: 12, fontWeight: '600', color: colors.danger, marginLeft: spacing.sm },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.textPrimary },
  chipTextActive: { color: colors.textOnPrimary, fontWeight: '600' },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 15 },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
});
