import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { DateField } from '../../ui/DateField';
import { FormField } from '../../ui/FormField';
import { Select } from '../../ui/Select';
import { frequencyOptions } from '../../ui/frequency';
import { ConfirmDialog } from '../../web/ui/ConfirmDialog.web';
import { PageHeader } from '../../web/ui/PageHeader.web';
import { TwoColumnLayout } from '../../web/ui/TwoColumnLayout.web';
import { MAX_CONTENT_WIDTH, webColors, webRadius, webSpacing } from '../../web/webTheme';
import {
  AMOUNT_STATUS_LABEL,
  Category,
  ChargePlan,
  Deadline,
  OBLIGATION_STATUS_OPTIONS,
  ObligationStatus,
  RECURRENCE_VALUES,
  STATUS_LABEL,
  formatDate,
  n,
} from './chargePlanDetailLogic';

/**
 * Portail Web v4 (WEB-V4.4A) — ChargePlanDetail desktop : synthèse (badge
 * actif/inactif bien visible) + échéances à gauche, édition dans le panneau
 * droit ; actif/inactif + suppression dans un bloc séparé en bas du panneau,
 * distinct du bouton d'enregistrement. Suppression via ConfirmDialog
 * (Alert.alert est un no-op sur Web).
 */
export function ChargePlanDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const id = route.params?.id as string;

  const [plan, setPlan] = useState<ChargePlan | null>(null);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [label, setLabel] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [obligationStatus, setObligationStatus] = useState<ObligationStatus>('obligatoire');
  const [recurrenceRule, setRecurrenceRule] = useState('ponctuel');
  const [anchorDate, setAnchorDate] = useState('');
  const [editAmount, setEditAmount] = useState(false);
  const [amountStatus, setAmountStatus] = useState<'estime' | 'confirme' | 'inconnu'>('estime');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, d, categoryList] = await Promise.all([api.getChargePlan(id), api.listChargePlanDeadlines(id), api.listCategories()]);
      setPlan(p);
      setDeadlines(d);
      setCategories((categoryList as Category[]).filter((c) => c.kind === 'expense' || c.kind === 'both'));
      setLabel(p.label);
      setCategoryId(p.categoryId);
      setObligationStatus(p.obligationStatus);
      setRecurrenceRule(p.recurrenceRule ?? 'ponctuel');
      setAnchorDate(p.recurrenceAnchorDate ? String(p.recurrenceAnchorDate).slice(0, 10) : '');
      setEditAmount(false);
      setAmountStatus('estime');
      setAmount('');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onSave() {
    setError(null);
    if (!label.trim()) {
      setError('Un libellé est requis');
      return;
    }
    if (recurrenceRule !== 'ponctuel' && !anchorDate) {
      setError('La prochaine échéance est requise pour une charge récurrente');
      return;
    }
    if (editAmount && amountStatus !== 'inconnu' && (!amount.trim() || Number(amount.replace(',', '.')) <= 0)) {
      setError('Montant invalide');
      return;
    }
    setSaving(true);
    try {
      await api.updateChargePlan(id, {
        label: label.trim(),
        categoryId: categoryId ?? null,
        obligationStatus,
        recurrenceRule: recurrenceRule === 'ponctuel' ? undefined : recurrenceRule,
        recurrenceAnchorDate: recurrenceRule === 'ponctuel' ? null : anchorDate,
        ...(editAmount ? { amountStatus, amountCurrent: amountStatus !== 'inconnu' ? Number(amount.replace(',', '.')) : undefined } : {}),
      });
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Modification impossible');
    } finally {
      setSaving(false);
    }
  }

  async function onToggleStatus() {
    if (!plan) return;
    setError(null);
    setTogglingStatus(true);
    try {
      await api.updateChargePlan(id, { status: plan.status === 'actif' ? 'inactif' : 'actif' });
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Opération impossible');
    } finally {
      setTogglingStatus(false);
    }
  }

  async function onConfirmDelete() {
    setError(null);
    setDeleting(true);
    try {
      await api.deleteChargePlan(id);
      navigation.goBack();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Suppression impossible');
    } finally {
      setDeleting(false);
    }
  }

  if (loading && !plan) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!plan) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <PageHeader title="Charge récurrente" />
      <TwoColumnLayout
        main={
          <>
            <View style={styles.heroCard}>
              <View style={styles.heroHeaderRow}>
                <Text style={styles.heroLabel}>{plan.label}</Text>
                <Text style={[styles.statusBadge, plan.status === 'actif' ? styles.statusBadgeActive : styles.statusBadgeInactive]}>
                  {plan.status === 'actif' ? 'Active' : 'Inactive'}
                </Text>
              </View>
              {plan.status === 'inactif' && <Text style={styles.inactiveHint}>Récurrence arrêtée — aucune nouvelle échéance ne sera générée.</Text>}
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Text style={styles.sectionTitle}>Échéances</Text>
            {deadlines.length === 0 ? (
              <Text style={styles.empty}>Aucune échéance pour l'instant.</Text>
            ) : (
              <View style={styles.table}>
                {deadlines.map((d) => (
                  <TouchableOpacity key={d.id} testID={`web-chargeplan-deadline-${d.id}`} style={styles.tableRow} onPress={() => navigation.navigate('DeadlineDetail', { id: d.id })}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.deadlineDate}>{formatDate(d.dueDate)}</Text>
                      <Text style={styles.deadlineMeta}>
                        {STATUS_LABEL[d.financialStatus]} · {d.amountStatus === 'confirme' ? 'Confirmé' : d.amountStatus === 'estime' ? 'Estimé' : 'Inconnu'}
                      </Text>
                    </View>
                    <Text style={styles.deadlineAmount}>{n(d.resteAPayer) !== null ? `${n(d.resteAPayer)!.toLocaleString('fr-FR')} DH` : '—'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        }
        panel={
          <View style={styles.panelCard}>
            <Text style={styles.panelTitle}>Édition</Text>
            <FormField testID="web-chargeplan-label-input" label="Libellé" value={label} onChangeText={setLabel} />

            {plan.financialPlanId && (
              <Select testID="web-chargeplan-obligation-status-select" label="Statut de l'option" value={obligationStatus} onChange={(v) => setObligationStatus(v as ObligationStatus)} options={OBLIGATION_STATUS_OPTIONS} />
            )}
            {categories.length > 0 && (
              <Select testID="web-chargeplan-category-select" label="Catégorie" placeholder="Sélectionner une catégorie" value={categoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} onChange={setCategoryId} />
            )}
            <Select testID="web-chargeplan-frequency-select" label="Fréquence" value={recurrenceRule} options={frequencyOptions(RECURRENCE_VALUES)} onChange={setRecurrenceRule} />
            {recurrenceRule !== 'ponctuel' && <DateField label="Prochaine échéance" value={anchorDate} onChange={setAnchorDate} />}

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Modifier le montant des prochaines échéances</Text>
              <Switch testID="web-chargeplan-edit-amount-switch" value={editAmount} onValueChange={setEditAmount} />
            </View>
            {editAmount && (
              <>
                <View style={styles.segment}>
                  {(['estime', 'confirme', 'inconnu'] as const).map((s) => (
                    <TouchableOpacity key={s} style={[styles.segmentItem, amountStatus === s && styles.segmentActive]} onPress={() => setAmountStatus(s)}>
                      <Text style={[styles.segmentText, amountStatus === s && styles.segmentTextActive]}>{AMOUNT_STATUS_LABEL[s]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {amountStatus !== 'inconnu' && <FormField testID="web-chargeplan-amount-input" placeholder="Montant (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />}
                <Text style={styles.amountHint}>S'applique uniquement aux échéances futures encore ouvertes.</Text>
              </>
            )}

            <TouchableOpacity style={styles.button} onPress={onSave} disabled={saving} testID="web-chargeplan-save">
              {saving ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.buttonText}>Enregistrer</Text>}
            </TouchableOpacity>

            <View style={styles.dangerZone}>
              <TouchableOpacity style={styles.buttonSecondary} onPress={onToggleStatus} disabled={togglingStatus} testID="web-chargeplan-toggle-status">
                {togglingStatus ? <ActivityIndicator color={webColors.textPrimary} /> : <Text style={styles.buttonSecondaryText}>{plan.status === 'actif' ? 'Arrêter la récurrence' : 'Réactiver'}</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteLinkWrap} onPress={() => setDeleteConfirmOpen(true)} testID="web-chargeplan-delete-link">
                <Text style={styles.deleteLink}>Supprimer cette charge</Text>
              </TouchableOpacity>
            </View>
          </View>
        }
      />

      <ConfirmDialog
        testID="web-chargeplan-delete-confirm"
        visible={deleteConfirmOpen}
        title="Supprimer cette charge ?"
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

  heroCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.lg, marginBottom: webSpacing.md, borderWidth: 1, borderColor: webColors.borderStrong },
  heroHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroLabel: { fontSize: 17, fontWeight: '700', color: webColors.textPrimary },
  statusBadge: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', borderRadius: webRadius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeActive: { color: webColors.success, backgroundColor: webColors.successLight },
  statusBadgeInactive: { color: webColors.danger, backgroundColor: webColors.dangerLight },
  inactiveHint: { fontSize: 12, color: webColors.danger, fontWeight: '600', marginTop: webSpacing.sm },

  error: { color: webColors.danger, fontSize: 12, marginBottom: webSpacing.sm },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.sm },
  empty: { color: webColors.textSecondary, fontSize: 13 },
  table: { backgroundColor: webColors.surface, borderRadius: webRadius.lg, borderWidth: 1, borderColor: webColors.border, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: webSpacing.md, paddingVertical: 10, borderTopWidth: 1, borderTopColor: webColors.tableRowBorder },
  deadlineDate: { fontSize: 13, fontWeight: '700', color: webColors.textPrimary },
  deadlineMeta: { fontSize: 11, color: webColors.textSecondary, marginTop: 2 },
  deadlineAmount: { fontSize: 13, fontWeight: '700', color: webColors.textPrimary },

  panelCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.lg, borderWidth: 1, borderColor: webColors.borderStrong },
  panelTitle: { fontSize: 14, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.sm },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: webSpacing.sm, marginTop: webSpacing.xs },
  toggleLabel: { fontSize: 12, color: webColors.textPrimary, flex: 1, marginRight: webSpacing.sm },
  segment: { flexDirection: 'row', backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.md, padding: 4, marginBottom: webSpacing.sm },
  segmentItem: { flex: 1, paddingVertical: 8, borderRadius: webRadius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: webColors.surface },
  segmentText: { fontSize: 11, color: webColors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: webColors.textPrimary },
  amountHint: { fontSize: 11, color: webColors.textSecondary, marginBottom: webSpacing.sm },
  button: { backgroundColor: webColors.primary, borderRadius: webRadius.md, paddingVertical: 12, alignItems: 'center', marginTop: webSpacing.xs },
  buttonText: { color: webColors.textOnPrimary, fontWeight: '700', fontSize: 13 },

  dangerZone: { marginTop: webSpacing.lg, paddingTop: webSpacing.md, borderTopWidth: 1, borderTopColor: webColors.border, gap: webSpacing.sm },
  buttonSecondary: { backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.md, paddingVertical: 11, alignItems: 'center' },
  buttonSecondaryText: { color: webColors.textPrimary, fontWeight: '600', fontSize: 13 },
  deleteLinkWrap: { alignItems: 'center', paddingVertical: 4 },
  deleteLink: { fontSize: 12, color: webColors.textSecondary, fontWeight: '600' },
});
