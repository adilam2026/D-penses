import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { ChoiceSheet } from '../../ui/ChoiceSheet';
import { DateField } from '../../ui/DateField';
import { Select } from '../../ui/Select';
import { colors, elevation, radius, spacing } from '../../ui/theme';

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface ChargeRow {
  id: string;
  chargePlanId: string;
  chargePlanLabel: string;
  amountCurrent: number | string | null;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  dueDate: string;
}

interface FinancialPlanDetail {
  id: string;
  label: string;
  description: string | null;
  active: boolean;
  deadlinesCertain: ChargeRow[];
}

/**
 * Convergence V6C §1/§2 — Plan financier = simple regroupement de charges.
 * Détail volontairement minimal : nom + liste des charges (libellé, montant,
 * date) + "+ Ajouter une charge". Plus aucune trace de l'ancien moteur
 * (budget connu/payé/reste à financer/taux de couverture/options
 * envisagées/wizard). "+ Ajouter une charge" réutilise le mécanisme déjà
 * existant et sain (POST /charge-plans + POST /charge-plans/:id/deadlines,
 * financialPlanId=ce plan), inchangé côté backend.
 */
export function FinancialPlanDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const id = route.params?.id as string;
  const bottomInset = useBottomInset();
  const [detail, setDetail] = useState<FinancialPlanDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addLabel, setAddLabel] = useState('');
  const [addAmountStatus, setAddAmountStatus] = useState<'confirme' | 'estime' | 'inconnu'>('confirme');
  const [addAmount, setAddAmount] = useState('');
  const [addDueDate, setAddDueDate] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d: FinancialPlanDetail = await api.getFinancialPlan(id);
      d.deadlinesCertain = [...d.deadlinesCertain].sort((a, b) => {
        const byDate = a.dueDate.localeCompare(b.dueDate);
        return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
      });
      setDetail(d);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function openAdd() {
    setMenuOpen(false);
    setAddLabel('');
    setAddAmountStatus('confirme');
    setAddAmount('');
    setAddDueDate('');
    setAddError(null);
    setAddOpen(true);
  }

  async function onCreateDeadline() {
    if (!addLabel.trim()) {
      setAddError('Le libellé est obligatoire');
      return;
    }
    if (!addDueDate) {
      setAddError("La date d'échéance est obligatoire");
      return;
    }
    if (addAmountStatus !== 'inconnu' && (!addAmount.trim() || Number(addAmount.replace(',', '.')) <= 0)) {
      setAddError('Montant invalide');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const newPlan = await api.createChargePlan({
        label: addLabel.trim(),
        startDate: addDueDate,
        financialPlanId: id,
        generationMode: 'calendrier_manuel',
        obligationStatus: 'optionnelle_souscrite',
      });
      await api.createDeadline(newPlan.id, {
        dueDate: addDueDate,
        amountCurrent: addAmountStatus !== 'inconnu' ? Number(addAmount.replace(',', '.')) : undefined,
        amountStatus: addAmountStatus,
      });
      setAddOpen(false);
      await load();
    } catch (err) {
      setAddError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setAdding(false);
    }
  }

  function openEdit() {
    if (!detail) return;
    setMenuOpen(false);
    setEditLabel(detail.label);
    setEditDescription(detail.description ?? '');
    setEditError(null);
    setEditOpen(true);
  }

  async function onSaveEdit() {
    if (!editLabel.trim()) {
      setEditError('Le nom du plan est obligatoire');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await api.updateFinancialPlan(id, { label: editLabel.trim(), description: editDescription.trim() || undefined });
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
    Alert.alert('Supprimer ce plan ?', 'Cette action est définitive.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: onDelete },
    ]);
  }

  async function onDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteFinancialPlan(id);
      navigation.goBack();
    } catch (err) {
      setDeleteError(err instanceof api.ApiError ? err.message : 'Suppression impossible');
    } finally {
      setDeleting(false);
    }
  }

  if (loading || !detail) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView testID="plan-detail-scroll" style={styles.container} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{detail.label}</Text>
          {detail.description ? <Text style={styles.description}>{detail.description}</Text> : null}
        </View>
        <TouchableOpacity testID="plan-menu-button" style={styles.menuButton} onPress={() => setMenuOpen(true)}>
          <Text style={styles.menuButtonText}>•••</Text>
        </TouchableOpacity>
      </View>
      {deleteError && <Text style={styles.error}>{deleteError}</Text>}

      <Text style={styles.sectionTitle}>Liste des charges</Text>
      {detail.deadlinesCertain.length === 0 ? (
        <Text style={styles.empty}>Aucune charge pour l'instant.</Text>
      ) : (
        detail.deadlinesCertain.map((d) => (
          <TouchableOpacity
            key={d.id}
            testID={`plan-charge-${d.id}`}
            style={styles.chargeRow}
            onPress={() => navigation.navigate('ChargePlanDetail', { id: d.chargePlanId })}
          >
            <Text style={styles.chargeLabel} numberOfLines={1}>
              {d.chargePlanLabel}
            </Text>
            <Text style={styles.chargeDate}>{formatShortDate(d.dueDate)}</Text>
            <Text style={styles.chargeAmount}>{d.amountStatus === 'inconnu' ? '—' : `${Number(d.amountCurrent).toLocaleString('fr-FR')} DH`}</Text>
          </TouchableOpacity>
        ))
      )}

      <TouchableOpacity testID="plan-add-charge-button" style={styles.addChargeButton} onPress={openAdd}>
        <Text style={styles.addChargeButtonText}>+ Ajouter une charge</Text>
      </TouchableOpacity>

      <ChoiceSheet
        testID="plan-menu"
        visible={menuOpen}
        title={detail.label}
        onClose={() => setMenuOpen(false)}
        options={[
          { key: 'ajouter', label: 'Ajouter une charge', icon: 'add-circle-outline', onPress: openAdd },
          { key: 'modifier', label: 'Modifier', icon: 'create-outline', onPress: openEdit },
          { key: 'supprimer', label: 'Supprimer', icon: 'trash-outline', onPress: onRequestDelete },
        ]}
      />

      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalCard} testID="plan-add-deadline-form">
            <Text style={styles.modalTitle}>Ajouter une charge</Text>
            <TextInput style={styles.modalInput} value={addLabel} onChangeText={setAddLabel} placeholder="Libellé" testID="plan-add-deadline-label" />
            <Select
              testID="plan-add-deadline-amount-status"
              label="Montant"
              value={addAmountStatus}
              onChange={(v) => setAddAmountStatus(v as 'confirme' | 'estime' | 'inconnu')}
              options={[
                { value: 'confirme', label: 'Confirmé' },
                { value: 'estime', label: 'Estimé' },
                { value: 'inconnu', label: 'Inconnu' },
              ]}
            />
            {addAmountStatus !== 'inconnu' && (
              <TextInput
                style={styles.modalInput}
                value={addAmount}
                onChangeText={setAddAmount}
                placeholder="Montant (DH)"
                keyboardType="decimal-pad"
                testID="plan-add-deadline-amount"
              />
            )}
            <DateField label="Date" value={addDueDate} onChange={setAddDueDate} />
            {addError && <Text style={styles.error}>{addError}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setAddOpen(false)}>
                <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="plan-add-deadline-save" style={styles.modalButton} onPress={onCreateDeadline} disabled={adding}>
                {adding ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.modalButtonText}>Ajouter</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="plan-edit-form">
            <Text style={styles.modalTitle}>Modifier le plan</Text>
            <TextInput style={styles.modalInput} value={editLabel} onChangeText={setEditLabel} placeholder="Nom du plan" testID="plan-edit-label" />
            <TextInput
              style={styles.modalInput}
              value={editDescription}
              onChangeText={setEditDescription}
              placeholder="Description facultative"
              testID="plan-edit-description"
            />
            {editError && <Text style={styles.error}>{editError}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setEditOpen(false)}>
                <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="plan-edit-save" style={styles.modalButton} onPress={onSaveEdit} disabled={editSaving}>
                {editSaving ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.modalButtonText}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  scroll: { padding: spacing.xl, paddingTop: spacing.lg },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  description: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { color: colors.textSecondary, fontSize: 13 },
  chargeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chargeLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginRight: spacing.sm },
  chargeDate: { fontSize: 12, color: colors.textSecondary, marginRight: spacing.md },
  chargeAmount: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, minWidth: 80, textAlign: 'right' },
  addChargeButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceActive,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    marginTop: spacing.md,
  },
  addChargeButtonText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  menuButton: { paddingHorizontal: 10, paddingVertical: 4 },
  menuButtonText: { fontSize: 18, fontWeight: '700', color: colors.textSecondary },
  error: { color: colors.danger, fontSize: 12, marginTop: 8, marginBottom: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalScroll: { width: '100%', alignSelf: 'stretch' },
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
});
