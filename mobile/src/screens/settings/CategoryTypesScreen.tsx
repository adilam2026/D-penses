import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { Select } from '../../ui/Select';
import { FormField } from '../../ui/FormField';
import { colors, radius, spacing } from '../../ui/theme';

interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
}

interface CategorySubtype {
  id: string;
  name: string;
  active: boolean;
  isSystem: boolean;
}

interface CategoryType {
  id: string;
  name: string;
  active: boolean;
  isSystem: boolean;
  subtypes: CategorySubtype[];
}

/**
 * ☰ Paramètres → Types de dépenses (Vague 2 §3, mis en écran en Vague 3 §5).
 * Renommer/désactiver — jamais de suppression (aucun endpoint DELETE côté backend) :
 * l'historique des transactions déjà saisies reste lisible quel que soit l'état "active".
 */
export function CategoryTypesScreen() {
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [types, setTypes] = useState<CategoryType[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTypeName, setNewTypeName] = useState('');
  const [addingType, setAddingType] = useState(false);
  const [subtypeDrafts, setSubtypeDrafts] = useState<Record<string, string>>({});
  const [openSubtypesFor, setOpenSubtypesFor] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      api
        .listCategories()
        .then((cats: Category[]) => {
          setCategories(cats);
          if (!categoryId && cats.length > 0) setCategoryId(cats[0].id);
        })
        .finally(() => setLoading(false));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const loadTypes = useCallback(async (catId: string) => {
    setTypes(await api.listCategoryTypes(catId));
  }, []);

  useEffect(() => {
    if (categoryId) loadTypes(categoryId);
  }, [categoryId, loadTypes]);

  async function onCreateType() {
    if (!categoryId || !newTypeName.trim()) return;
    await api.createCategoryType(categoryId, { name: newTypeName.trim() });
    setNewTypeName('');
    setAddingType(false);
    await loadTypes(categoryId);
  }

  async function onToggleType(type: CategoryType) {
    if (type.isSystem) return;
    await api.updateCategoryType(type.id, { active: !type.active });
    if (categoryId) await loadTypes(categoryId);
  }

  async function onCreateSubtype(typeId: string) {
    const name = subtypeDrafts[typeId]?.trim();
    if (!name) return;
    await api.createCategorySubtype(typeId, { name });
    setSubtypeDrafts((prev) => ({ ...prev, [typeId]: '' }));
    if (categoryId) await loadTypes(categoryId);
  }

  async function onToggleSubtype(subtype: CategorySubtype) {
    if (subtype.isSystem) return;
    await api.updateCategorySubtype(subtype.id, { active: !subtype.active });
    if (categoryId) await loadTypes(categoryId);
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}>
        <Text style={styles.intro}>Choisissez une catégorie pour gérer ses types (ex. Alimentation → Courses).</Text>

        {/* R5 clôture §6 — sélecteur compact (catégories potentiellement nombreuses), jamais un mur de chips. */}
        <Select
          testID="category-types-category-select"
          placeholder="Choisir une catégorie"
          value={categoryId}
          onChange={setCategoryId}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />

        {loading ? (
          <ActivityIndicator />
        ) : (
          types.map((t) => (
            <View key={t.id} style={styles.card}>
              <View style={styles.typeRow}>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => setOpenSubtypesFor(openSubtypesFor === t.id ? null : t.id)}>
                  <Text style={styles.typeLabel}>{t.name}</Text>
                  <Text style={styles.typeMeta}>
                    {t.isSystem ? 'Type système' : 'Personnalisé'} · {t.subtypes.length} sous-type(s)
                  </Text>
                </TouchableOpacity>
                {!t.isSystem && <Switch value={t.active} onValueChange={() => onToggleType(t)} />}
              </View>

              {openSubtypesFor === t.id && (
                <View style={styles.subtypeBlock}>
                  {t.subtypes.map((s) => (
                    <View key={s.id} style={styles.subtypeRow}>
                      <Text style={styles.subtypeLabel}>{s.name}</Text>
                      {!s.isSystem && <Switch value={s.active} onValueChange={() => onToggleSubtype(s)} />}
                    </View>
                  ))}
                  <View style={styles.inlineAddRow}>
                    <FormField
                      containerStyle={styles.inlineAddInput}
                      placeholder="Nouveau sous-type"
                      value={subtypeDrafts[t.id] ?? ''}
                      onChangeText={(v) => setSubtypeDrafts((prev) => ({ ...prev, [t.id]: v }))}
                      onFocus={handleFocus}
                    />
                    <TouchableOpacity style={styles.inlineAddButton} onPress={() => onCreateSubtype(t.id)}>
                      <Text style={styles.inlineAddButtonText}>Ajouter</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          ))
        )}

        {addingType ? (
          <View style={styles.inlineAddRow}>
            <FormField containerStyle={styles.inlineAddInput} placeholder="Nom du type" value={newTypeName} onChangeText={setNewTypeName} onFocus={handleFocus} />
            <TouchableOpacity style={styles.inlineAddButton} onPress={onCreateType}>
              <Text style={styles.inlineAddButtonText}>Ajouter</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setAddingType(true)}>
            <Text style={styles.addLink}>+ Nouveau type pour cette catégorie</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  typeRow: { flexDirection: 'row', alignItems: 'center' },
  typeLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  typeMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  subtypeBlock: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.surfaceSecondary },
  subtypeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  subtypeLabel: { fontSize: 13, color: colors.textPrimary },
  inlineAddRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  inlineAddInput: { flex: 1, marginRight: spacing.sm, marginBottom: 0 },
  inlineAddButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center' },
  inlineAddButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 12 },
  addLink: { color: colors.success, fontSize: 13, fontWeight: '600', marginTop: spacing.sm },
});
