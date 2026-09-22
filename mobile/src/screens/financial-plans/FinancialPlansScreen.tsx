import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, FlatList, Modal, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../../api/client';
import { colors, elevation, radius, spacing } from '../../ui/theme';

interface SimplePlan {
  id: string;
  label: string;
  description: string | null;
  active: boolean;
  chargeCount: number;
}

/**
 * Convergence V6C §1/§2 — PLAN FINANCIER = simple regroupement de charges.
 * Écran volontairement minimal : liste "Nom / N charges / [Voir]" + un seul
 * bouton "+ Ajouter un plan" ouvrant Nom (obligatoire) + Description
 * (facultative). Plus aucune trace de l'ancien moteur (objectif/couverture/
 * wizards École-Voyage-Voiture-Maison).
 */
export function FinancialPlansScreen() {
  const navigation = useNavigation<any>();
  const [plans, setPlans] = useState<SimplePlan[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = (await api.listFinancialPlans()) as SimplePlan[];
      // Point 9 — ordre alphabétique croissant, insensible casse/accents.
      setPlans(all.filter((p) => p.active !== false).sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' })));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function openCreate() {
    setLabel('');
    setDescription('');
    setError(null);
    setCreateOpen(true);
  }

  async function onCreate() {
    if (!label.trim()) {
      setError('Le nom du plan est obligatoire');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await api.createFinancialPlan({ label: label.trim(), description: description.trim() || undefined });
      setCreateOpen(false);
      await load();
      navigation.navigate('FinancialPlanDetail', { id: created.id });
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setCreating(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Plans financiers</Text>
        <TouchableOpacity testID="financial-plans-add-button" style={styles.addButton} onPress={openCreate}>
          <Ionicons name="add" size={22} color={colors.textOnPrimary} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={plans}
        keyExtractor={(p) => p.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <Text style={styles.empty}>Aucun plan financier pour l'instant.</Text>
              <TouchableOpacity testID="financial-plans-empty-create" style={styles.emptyCta} onPress={openCreate}>
                <Text style={styles.emptyCtaText}>+ Ajouter un plan</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.card} testID={`financial-plan-card-${item.id}`}>
            <View style={styles.cardMain}>
              <Text style={styles.cardTitle}>{item.label}</Text>
              <Text style={styles.cardMeta}>{item.chargeCount} charge{item.chargeCount > 1 ? 's' : ''}</Text>
            </View>
            <TouchableOpacity
              testID={`financial-plan-view-${item.id}`}
              style={styles.viewButton}
              onPress={() => navigation.navigate('FinancialPlanDetail', { id: item.id })}
            >
              <Text style={styles.viewButtonText}>Voir</Text>
            </TouchableOpacity>
          </View>
        )}
        ListFooterComponent={
          plans.length > 0 ? (
            <TouchableOpacity testID="financial-plans-add-footer" style={styles.footerAddButton} onPress={openCreate}>
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.footerAddText}>Ajouter un plan</Text>
            </TouchableOpacity>
          ) : null
        }
      />

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="financial-plan-create-form">
            <Text style={styles.modalTitle}>Nouveau plan</Text>
            <TextInput
              style={styles.modalInput}
              value={label}
              onChangeText={setLabel}
              placeholder="Nom *"
              testID="financial-plan-create-label"
            />
            <TextInput
              style={styles.modalInput}
              value={description}
              onChangeText={setDescription}
              placeholder="Description facultative"
              testID="financial-plan-create-description"
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setCreateOpen(false)}>
                <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="financial-plan-create-save" style={styles.modalButton} onPress={onCreate} disabled={creating}>
                {creating ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.modalButtonText}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.lg, paddingHorizontal: spacing.xl },
  pageTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  addButton: { backgroundColor: colors.primary, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.textSecondary, textAlign: 'center' },
  emptyState: { alignItems: 'center', marginTop: spacing.xxl, gap: spacing.md },
  emptyCta: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 20 },
  emptyCtaText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 13 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...elevation.card,
  },
  cardMain: { flexShrink: 1, marginRight: spacing.md },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  cardMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  viewButton: { backgroundColor: colors.surfaceActive, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8 },
  viewButtonText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  footerAddButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.md },
  footerAddText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, width: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  modalInput: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.md },
  modalButton: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 18, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  modalButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  modalButtonSecondary: { paddingHorizontal: 14, paddingVertical: 10, marginRight: 8 },
  modalButtonSecondaryText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  error: { color: colors.danger, fontSize: 12, marginTop: 4, marginBottom: 4 },
});
