import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { DateField } from '../../ui/DateField';
import { FormField } from '../../ui/FormField';
import { Select } from '../../ui/Select';
import { ConfirmDialog } from '../../web/ui/ConfirmDialog.web';
import { PageHeader } from '../../web/ui/PageHeader.web';
import { TwoColumnLayout } from '../../web/ui/TwoColumnLayout.web';
import { MAX_CONTENT_WIDTH, webColors, webRadius, webSpacing } from '../../web/webTheme';

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
 * Convergence V6C §1/§2 — Plan financier desktop : même modèle minimal que
 * mobile (nom + liste de charges + "+ Ajouter une charge"), panneau droit
 * limité à Modifier le plan (nom/description) — plus aucune trace du moteur
 * de couverture/budget/taux/options envisagées.
 */
export function FinancialPlanDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const id = route.params?.id as string;
  const [detail, setDetail] = useState<FinancialPlanDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [menuOpen, setMenuOpen] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      setEditLabel(d.label);
      setEditDescription(d.description ?? '');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

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
      setAddLabel('');
      setAddAmountStatus('confirme');
      setAddAmount('');
      setAddDueDate('');
      await load();
    } catch (err) {
      setAddError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setAdding(false);
    }
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
      await load();
    } catch (err) {
      setEditError(err instanceof api.ApiError ? err.message : 'Modification impossible');
    } finally {
      setEditSaving(false);
    }
  }

  async function onConfirmDelete() {
    setDeleteError(null);
    setDeleting(true);
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

  const mainContent = (
    <>
      {detail.description ? <Text style={styles.description}>{detail.description}</Text> : null}
      {deleteError && <Text style={styles.error}>{deleteError}</Text>}

      <Text style={styles.sectionTitle}>Liste des charges</Text>
      {detail.deadlinesCertain.length === 0 ? (
        <Text style={styles.empty}>Aucune charge pour l'instant.</Text>
      ) : (
        <View style={styles.list}>
          {detail.deadlinesCertain.map((d) => (
            <TouchableOpacity
              key={d.id}
              testID={`web-plan-charge-${d.id}`}
              style={styles.row}
              onPress={() => navigation.navigate('ChargePlanDetail', { id: d.chargePlanId })}
            >
              <Text style={styles.rowLabel} numberOfLines={1}>
                {d.chargePlanLabel}
              </Text>
              <Text style={styles.rowDate}>{formatShortDate(d.dueDate)}</Text>
              <Text style={styles.rowAmount}>{d.amountStatus === 'inconnu' ? '—' : `${Number(d.amountCurrent).toLocaleString('fr-FR')} DH`}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </>
  );

  const panel = (
    <View style={{ gap: webSpacing.md }}>
      <View style={styles.panelCard}>
        <Text style={styles.panelTitle}>Ajouter une charge</Text>
        <FormField testID="web-plan-add-deadline-label" placeholder="Libellé" value={addLabel} onChangeText={setAddLabel} />
        <Select
          testID="web-plan-add-deadline-amount-status"
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
          <FormField testID="web-plan-add-deadline-amount" placeholder="Montant (DH)" keyboardType="decimal-pad" value={addAmount} onChangeText={setAddAmount} />
        )}
        <DateField label="Date" value={addDueDate} onChange={setAddDueDate} />
        {addError && <Text style={styles.error}>{addError}</Text>}
        <TouchableOpacity testID="web-plan-add-deadline-save" style={styles.button} onPress={onCreateDeadline} disabled={adding}>
          {adding ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.buttonText}>Ajouter</Text>}
        </TouchableOpacity>
      </View>

      <View style={styles.panelCard}>
        <Text style={styles.panelTitle}>Modifier le plan</Text>
        <FormField testID="web-plan-edit-label" placeholder="Nom du plan" value={editLabel} onChangeText={setEditLabel} />
        <FormField testID="web-plan-edit-description" placeholder="Description facultative" value={editDescription} onChangeText={setEditDescription} />
        {editError && <Text style={styles.error}>{editError}</Text>}
        <TouchableOpacity testID="web-plan-edit-save" style={styles.button} onPress={onSaveEdit} disabled={editSaving}>
          {editSaving ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.buttonText}>Enregistrer</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <PageHeader
        title={detail.label}
        actions={
          <View>
            <TouchableOpacity testID="web-plan-menu-button" style={styles.menuButton} onPress={() => setMenuOpen((v) => !v)}>
              <Text style={styles.menuButtonText}>•••</Text>
            </TouchableOpacity>
            {menuOpen && (
              <View style={styles.menuDropdown}>
                <TouchableOpacity
                  testID="web-plan-menu-delete"
                  style={styles.menuItem}
                  onPress={() => {
                    setMenuOpen(false);
                    setDeleteConfirmOpen(true);
                  }}
                >
                  <Text style={styles.menuItemTextDanger}>Supprimer</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        }
      />
      <TwoColumnLayout main={mainContent} panel={panel} />

      <ConfirmDialog
        testID="web-plan-delete-confirm"
        visible={deleteConfirmOpen}
        title="Supprimer ce plan ?"
        message="Cette action est définitive."
        confirmLabel="Supprimer"
        destructive
        loading={deleting}
        onConfirm={onConfirmDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center' },

  menuButton: { paddingHorizontal: 10, paddingVertical: 4 },
  menuButtonText: { fontSize: 18, fontWeight: '700', color: webColors.textSecondary },
  menuDropdown: { position: 'absolute', top: 30, right: 0, backgroundColor: webColors.surface, borderRadius: webRadius.md, borderWidth: 1, borderColor: webColors.border, minWidth: 140, zIndex: 10 },
  menuItem: { paddingHorizontal: webSpacing.md, paddingVertical: 10 },
  menuItemTextDanger: { fontSize: 13, color: webColors.danger, fontWeight: '600' },

  description: { fontSize: 13, color: webColors.textSecondary, marginBottom: webSpacing.md },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: webColors.textPrimary, marginTop: webSpacing.sm, marginBottom: webSpacing.sm },
  empty: { color: webColors.textSecondary, fontSize: 13 },
  list: { gap: webSpacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: webColors.surface, borderRadius: webRadius.md, padding: webSpacing.md, borderWidth: 1, borderColor: webColors.border },
  rowLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: webColors.textPrimary, marginRight: webSpacing.sm },
  rowDate: { fontSize: 12, color: webColors.textSecondary, marginRight: webSpacing.md },
  rowAmount: { fontSize: 13, fontWeight: '700', color: webColors.textPrimary, minWidth: 90, textAlign: 'right' },

  panelCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.lg, borderWidth: 1, borderColor: webColors.borderStrong },
  panelTitle: { fontSize: 14, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.sm },
  button: { backgroundColor: webColors.primary, borderRadius: webRadius.md, paddingVertical: 11, alignItems: 'center', marginTop: webSpacing.xs },
  buttonText: { color: webColors.textOnPrimary, fontWeight: '700', fontSize: 13 },

  error: { color: webColors.danger, fontSize: 12, marginBottom: webSpacing.sm },
});
