import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, Alert, FlatList, Modal, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { ChoiceSheet } from '../../ui/ChoiceSheet';
import { FormField } from '../../ui/FormField';
import { Select } from '../../ui/Select';
import { colors, radius, spacing } from '../../ui/theme';

interface HistoryEntry {
  id: string;
  amount: number;
  spentDate: string;
  notes: string | null;
}

interface BudgetDetail {
  id: string;
  categoryId: string;
  category: { name: string };
  referenceAmount: number;
  referencePeriod: 'semaine' | 'mois';
  weekStartDay: number;
  status: {
    periodStart: string;
    periodEnd: string;
    budgetPeriode: number;
    consommeADate: number;
    budgetContractuelRestant: number;
    rythmeProjete: number;
    previsionRythmeRestant: number;
    projectionPrudenteRestante: number;
  };
  history: HistoryEntry[];
}

const PERIOD_OPTIONS = [
  { value: 'semaine', label: 'Semaine' },
  { value: 'mois', label: 'Mois' },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' });
}

/** Fiche budget (§18, R6.4 §1 — Modifier/Supprimer) — dépenses de la période courante, sans graphique. */
export function BudgetDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const id = route.params?.id as string;
  const [detail, setDetail] = useState<BudgetDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // R6.4 (§1) — menu "..." (Modifier/Supprimer), même pattern que AccountDetailScreen (§19).
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editAmount, setEditAmount] = useState('');
  const [editPeriod, setEditPeriod] = useState<'semaine' | 'mois'>('mois');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await api.getVariableBudget(id));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function openEdit() {
    if (!detail) return;
    setMenuOpen(false);
    setEditAmount(String(detail.referenceAmount));
    setEditPeriod(detail.referencePeriod);
    setEditError(null);
    setEditOpen(true);
  }

  async function onSaveEdit() {
    const value = Number(editAmount.replace(',', '.'));
    if (!value || value <= 0) {
      setEditError('Montant invalide');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await api.updateVariableBudget(id, { referenceAmount: value, referencePeriod: editPeriod });
      setEditOpen(false);
      await load();
    } catch (err) {
      setEditError(err instanceof api.ApiError ? err.message : 'Modification impossible');
    } finally {
      setEditSaving(false);
    }
  }

  function onRequestDelete() {
    setMenuOpen(false);
    setDeleteError(null);
    Alert.alert('Supprimer ce budget ?', "S'il a déjà des dépenses enregistrées, il sera archivé (historique conservé) plutôt que supprimé.", [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await api.deleteVariableBudget(id);
            navigation.goBack();
          } catch (err) {
            setDeleteError(err instanceof api.ApiError ? err.message : 'Suppression impossible');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  if (loading || !detail) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const { status } = detail;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{detail.category.name}</Text>
          <Text style={styles.subtitle}>
            {detail.referenceAmount.toLocaleString('fr-FR')} DH / {detail.referencePeriod} · {formatDate(status.periodStart)} — {formatDate(status.periodEnd)}
          </Text>
        </View>
        <TouchableOpacity testID="budget-menu-button" style={styles.menuButton} onPress={() => setMenuOpen(true)}>
          <Text style={styles.menuButtonText}>•••</Text>
        </TouchableOpacity>
      </View>
      {deleteError && <Text style={styles.error}>{deleteError}</Text>}

      <View style={styles.figuresGrid}>
        <Figure label="Budget" value={status.budgetPeriode} />
        <Figure label="Dépensé" value={status.consommeADate} />
        <Figure label="Reste selon budget" value={status.budgetContractuelRestant} />
        <Figure label="Projection au rythme actuel" value={status.rythmeProjete} />
        <Figure label="Prévision prudente restante" value={status.projectionPrudenteRestante} highlight />
      </View>

      <Text style={styles.historyTitle}>Dépenses de la période</Text>
      <FlatList
        data={detail.history}
        keyExtractor={(h) => h.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={<Text style={styles.empty}>Aucune dépense enregistrée dans cette période.</Text>}
        renderItem={({ item }) => (
          <View style={styles.historyRow}>
            <Text style={styles.historyLabel}>{item.notes || formatDate(item.spentDate)}</Text>
            <Text style={styles.historyAmount}>{item.amount.toLocaleString('fr-FR')} DH</Text>
          </View>
        )}
      />

      <ChoiceSheet
        testID="budget-menu"
        visible={menuOpen}
        title={detail.category.name}
        onClose={() => setMenuOpen(false)}
        options={[
          { key: 'modifier', label: 'Modifier', icon: 'create-outline', onPress: openEdit },
          { key: 'supprimer', label: 'Supprimer', icon: 'trash-outline', onPress: onRequestDelete },
        ]}
      />

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="budget-edit-form">
            <Text style={styles.modalTitle}>Modifier le budget</Text>
            <Text style={styles.modalNote}>
              Le libellé de ce budget provient de la catégorie « {detail.category.name} » — pour le changer, choisissez une autre catégorie ailleurs.
            </Text>
            <FormField testID="budget-edit-amount" label="Montant de référence (DH)" keyboardType="decimal-pad" value={editAmount} onChangeText={setEditAmount} />
            <Select testID="budget-edit-period" label="Périodicité" value={editPeriod} onChange={(v) => setEditPeriod(v as 'semaine' | 'mois')} options={PERIOD_OPTIONS} />
            {editError && <Text style={styles.error}>{editError}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setEditOpen(false)}>
                <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="budget-edit-save" style={styles.modalButton} onPress={onSaveEdit} disabled={editSaving}>
                {editSaving ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.modalButtonText}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Figure({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={[styles.figureValue, highlight && styles.figureValueHighlight]}>{value.toLocaleString('fr-FR')} DH</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.md, paddingHorizontal: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.lg },
  menuButton: { paddingHorizontal: 10, paddingVertical: 4 },
  menuButtonText: { fontSize: 18, fontWeight: '700', color: colors.textSecondary },
  error: { color: colors.danger, fontSize: 12, marginTop: 4, marginBottom: 8 },
  figuresGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.xl },
  figure: { width: '50%', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  figureLabel: { fontSize: 11, color: colors.textSecondary },
  figureValue: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginTop: 4 },
  figureValueHighlight: { color: colors.success },
  historyTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.md },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  historyLabel: { fontSize: 13, color: colors.textPrimary },
  historyAmount: { fontSize: 13, fontWeight: '700', color: colors.danger },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, width: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  modalNote: { fontSize: 11, color: colors.textSecondary, fontStyle: 'italic', marginBottom: spacing.md },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.md },
  modalButton: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 18, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  modalButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  modalButtonSecondary: { paddingHorizontal: 14, paddingVertical: 10, marginRight: 8 },
  modalButtonSecondaryText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
});
