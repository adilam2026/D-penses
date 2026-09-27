import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, radius, spacing, typography } from '../ui/theme';
import { HelpButton } from '../ui/HelpButton';
import { RenameModal } from '../ui/RenameModal';
import { ChoiceSheet } from '../ui/ChoiceSheet';

/**
 * Organisation → Catégories (§11) — liste, renommage, désactivation.
 * "Autres" existe toujours, ne peut jamais être désactivée (refusé côté
 * backend) ni supprimée : elle reste le fallback pour tout historique.
 */
export function CategoriesScreen() {
  const navigation = useNavigation<any>();
  const topInset = useTopInset();
  const bottomInset = useBottomInset();
  const [categories, setCategories] = useState<api.CategoryApi[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [menuTarget, setMenuTarget] = useState<api.CategoryApi | null>(null);
  const [renameTarget, setRenameTarget] = useState<api.CategoryApi | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setCategories(await api.listCategories());
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function toggleActive(category: api.CategoryApi) {
    setError(null);
    try {
      if (category.active) await api.archiveCategory(category.id);
      else await api.reactivateCategory(category.id);
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : "Impossible de modifier la catégorie");
    }
  }

  return (
    <ScrollView
      style={[styles.container, { paddingTop: topInset }]}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomInset + spacing.xxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Catégories</Text>
        <HelpButton
          title="Catégories"
          text="Les catégories classent vos dépenses et revenus. « Autres » existe toujours et ne peut jamais être désactivée : elle reçoit tout ce qui n'a pas d'autre catégorie."
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {categories === null ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <View style={styles.card}>
          {categories.map((cat, index) => (
            <TouchableOpacity
              key={cat.id}
              style={[styles.row, index < categories.length - 1 && styles.rowBorder]}
              onPress={() => setMenuTarget(cat)}
              testID={`categories-row-${cat.id}`}
            >
              <Text style={[styles.rowLabel, !cat.active && styles.rowLabelInactive]}>
                {cat.name}
                {!cat.active ? ' · Désactivée' : ''}
              </Text>
              <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.addButton} onPress={() => setCreating(true)} testID="categories-add">
        <Ionicons name="add" size={18} color={colors.primary} />
        <Text style={styles.addButtonText}>Nouvelle catégorie</Text>
      </TouchableOpacity>

      <ChoiceSheet
        visible={!!menuTarget}
        title={menuTarget?.name ?? ''}
        onClose={() => setMenuTarget(null)}
        testID="categories-choice-sheet"
        options={[
          { key: 'rename', label: 'Modifier le nom', icon: 'create-outline', onPress: () => setRenameTarget(menuTarget) },
          menuTarget?.isDefaultFallback
            ? { key: 'protected', label: 'Ne peut pas être désactivée', icon: 'lock-closed-outline', onPress: () => {}, disabled: true }
            : {
                key: 'toggle',
                label: menuTarget?.active ? 'Désactiver' : 'Réactiver',
                icon: 'power-outline',
                onPress: () => menuTarget && toggleActive(menuTarget),
              },
        ]}
      />

      <RenameModal
        visible={!!renameTarget}
        title="Modifier le nom de la catégorie"
        initialValue={renameTarget?.name ?? ''}
        onClose={() => setRenameTarget(null)}
        onSubmit={async (name) => {
          if (!renameTarget) return;
          await api.renameCategory(renameTarget.id, name);
          await load();
        }}
      />

      <RenameModal
        visible={creating}
        title="Nouvelle catégorie"
        initialValue=""
        onClose={() => setCreating(false)}
        onSubmit={async (name) => {
          await api.createCategory(name);
          await load();
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  title: { ...typography.screenTitle, flex: 1 },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm, fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowLabel: { ...typography.body },
  rowLabelInactive: { color: colors.textSecondary },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  addButtonText: { ...typography.body, fontWeight: '700', color: colors.primary },
});
