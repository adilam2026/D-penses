import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { ChoiceSheet } from '../../ui/ChoiceSheet';
import { FormField } from '../../ui/FormField';
import { colors, radius, spacing } from '../../ui/theme';

interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
  isSystem: boolean;
}

const KIND_LABEL: Record<Category['kind'], string> = { income: 'Revenu', expense: 'Dépense', both: 'Les deux' };

/**
 * ☰ Paramètres → Catégories (corrections UI/UX finales §10) — Ajouter/Modifier/
 * Supprimer, y compris pour une catégorie Système (renommable/retirable de
 * l'usage sans jamais casser les données : le backend archive une catégorie
 * déjà utilisée au lieu de la supprimer, elle disparaît simplement de cette
 * liste et des sélecteurs, jamais de l'historique des transactions passées).
 */
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

  const [menuCategory, setMenuCategory] = useState<Category | null>(null);
  const [editCategory, setEditCategory] = useState<Category | null>(null);
  const [editName, setEditName] = useState('');
  const [editKind, setEditKind] = useState<Category['kind']>('expense');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCategories(await api.listCategories());
    } finally {
      setLoading(false);
    }
  }, []);

  function openEdit(category: Category) {
    setMenuCategory(null);
    setEditCategory(category);
    setEditName(category.name);
    setEditKind(category.kind);
    setEditError(null);
  }

  async function onSaveEdit() {
    if (!editCategory) return;
    if (!editName.trim()) {
      setEditError('Un nom est requis');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await api.updateCategory(editCategory.id, { name: editName.trim(), kind: editKind });
      setEditCategory(null);
      await load();
    } catch (err) {
      setEditError(err instanceof api.ApiError ? err.message : 'Modification impossible');
    } finally {
      setEditSaving(false);
    }
  }

  // Corrections UI/UX finales §10 — jamais bloquée par isSystem (une catégorie
  // système reste supprimable/archivable comme les autres). Confirmation
  // explicite avant tout appel DELETE (destructive), mais le backend n'est
  // plus jamais bloquant : une catégorie utilisée est archivée (disparaît de
  // cette liste, jamais de l'historique), une catégorie inutilisée est
  // réellement supprimée — les deux résultats font simplement disparaître la
  // ligne ici, aucun second contrôle dupliqué côté mobile.
  function onRequestDelete(category: Category) {
    setMenuCategory(null);
    setError(null);
    Alert.alert(
      'Retirer cette catégorie ?',
      `« ${category.name} » ne sera plus proposée pour une nouvelle transaction. Si elle est déjà utilisée, son historique reste intact.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Retirer',
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
      ],
    );
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
                <Text style={styles.rowMeta}>{c.isSystem ? `Système · ${KIND_LABEL[c.kind]}` : KIND_LABEL[c.kind]}</Text>
              </View>
              <TouchableOpacity testID={`category-menu-${c.id}`} style={styles.menuButton} onPress={() => setMenuCategory(c)} disabled={deletingId === c.id}>
                {deletingId === c.id ? <ActivityIndicator size="small" /> : <Text style={styles.menuButtonText}>•••</Text>}
              </TouchableOpacity>
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

      <ChoiceSheet
        testID="category-menu"
        visible={!!menuCategory}
        title={menuCategory?.name ?? ''}
        onClose={() => setMenuCategory(null)}
        options={
          menuCategory
            ? [
                { key: 'modifier', label: 'Modifier', icon: 'create-outline', onPress: () => openEdit(menuCategory) },
                { key: 'supprimer', label: 'Supprimer', icon: 'trash-outline', onPress: () => onRequestDelete(menuCategory) },
              ]
            : []
        }
      />

      <Modal visible={!!editCategory} transparent animationType="fade" onRequestClose={() => setEditCategory(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="category-edit-form">
            <Text style={styles.modalTitle}>Modifier la catégorie</Text>
            <FormField testID="category-edit-name-input" label="Nom" value={editName} onChangeText={setEditName} placeholder="Nom" />
            <View style={styles.chipRow}>
              {(['expense', 'income', 'both'] as const).map((k) => (
                <TouchableOpacity
                  key={k}
                  testID={`category-edit-kind-${k}`}
                  style={[styles.chip, editKind === k && styles.chipActive]}
                  onPress={() => setEditKind(k)}
                >
                  <Text style={[styles.chipText, editKind === k && styles.chipTextActive]}>{KIND_LABEL[k]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {editError ? <Text style={styles.error}>{editError}</Text> : null}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setEditCategory(null)}>
                <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="category-edit-save" style={styles.modalButton} onPress={onSaveEdit} disabled={editSaving}>
                {editSaving ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.modalButtonText}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  menuButton: { paddingHorizontal: 10, paddingVertical: 4 },
  menuButtonText: { fontSize: 16, fontWeight: '700', color: colors.textSecondary },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, width: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.md },
  modalButton: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 18, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  modalButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  modalButtonSecondary: { paddingHorizontal: 14, paddingVertical: 10, marginRight: 8 },
  modalButtonSecondaryText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
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
