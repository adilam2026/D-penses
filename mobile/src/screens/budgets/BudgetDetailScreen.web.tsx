import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../../api/client';
import { FormField } from '../../ui/FormField';
import { Select } from '../../ui/Select';
import { ConfirmDialog } from '../../web/ui/ConfirmDialog.web';
import { PageHeader } from '../../web/ui/PageHeader.web';
import { TwoColumnLayout } from '../../web/ui/TwoColumnLayout.web';
import { MAX_CONTENT_WIDTH, webColors, webRadius, webSpacing } from '../../web/webTheme';
import {
  BudgetAmendmentEntry,
  BudgetDetail,
  FIELD_LABELS,
  MONTH_MODE_LABELS,
  PERIOD_OPTIONS,
  formatDate,
  formatDateTime,
  formatFieldValue,
  periodEndExclusive,
} from './budgetDetailLogic';

/**
 * Portail Web v4 (WEB-V4.4A) — BudgetDetail desktop : synthèse/navigation de
 * période/figures à gauche, avec DEUX sections distinctes — "A. Dépenses de
 * la période" et "B. Historique des modifications" — jamais mélangées dans
 * une même table. Édition directement dans le panneau droit (pas de menu),
 * suppression discrète en bas du panneau.
 */
export function BudgetDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const id = route.params?.id as string;
  const [detail, setDetail] = useState<BudgetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState<string | undefined>(undefined);

  const [editAmount, setEditAmount] = useState('');
  const [editPeriod, setEditPeriod] = useState<'semaine' | 'mois'>('mois');
  const [editMonthMode, setEditMonthMode] = useState<api.MonthMode>('calendaire');
  const [editCustomStartDay, setEditCustomStartDay] = useState('');
  const [editIncludeInPrudentProjection, setEditIncludeInPrudentProjection] = useState(true);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [amendments, setAmendments] = useState<BudgetAmendmentEntry[] | null>(null);
  const [amendmentsLoading, setAmendmentsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d: BudgetDetail = await api.getVariableBudget(id, at);
      setDetail(d);
      setEditAmount(String(d.referenceAmount));
      setEditPeriod(d.referencePeriod);
      setEditMonthMode(d.referencePeriod === 'mois' ? d.monthMode : 'calendaire');
      setEditCustomStartDay(d.referencePeriod === 'mois' && d.monthMode === 'personnalise' && d.customStartDay != null ? String(d.customStartDay) : '');
      setEditIncludeInPrudentProjection(d.includeInPrudentProjection);
    } finally {
      setLoading(false);
    }
  }, [id, at]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function toggleHistory() {
    const opening = !historyOpen;
    setHistoryOpen(opening);
    if (opening && amendments === null) {
      setAmendmentsLoading(true);
      try {
        setAmendments(await api.getVariableBudgetHistory(id));
      } finally {
        setAmendmentsLoading(false);
      }
    }
  }

  function onChangeEditPeriod(value: string) {
    setEditPeriod(value as 'semaine' | 'mois');
    setEditMonthMode('calendaire');
    setEditCustomStartDay('');
  }

  function onChangeEditMonthMode(mode: api.MonthMode) {
    setEditMonthMode(mode);
    if (mode !== 'personnalise') setEditCustomStartDay('');
  }

  async function onSaveEdit() {
    const value = Number(editAmount.replace(',', '.'));
    if (!value || value <= 0) {
      setEditError('Montant invalide');
      return;
    }
    const numericCustomStartDay = editCustomStartDay ? Number(editCustomStartDay) : undefined;
    if (editPeriod === 'mois' && editMonthMode === 'personnalise') {
      if (!numericCustomStartDay || !Number.isInteger(numericCustomStartDay) || numericCustomStartDay < 1 || numericCustomStartDay > 31) {
        setEditError('Le jour de départ doit être un nombre entier entre 1 et 31');
        return;
      }
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await api.updateVariableBudget(id, {
        referenceAmount: value,
        referencePeriod: editPeriod,
        monthMode: editMonthMode,
        customStartDay: editMonthMode === 'personnalise' ? numericCustomStartDay : undefined,
        includeInPrudentProjection: editIncludeInPrudentProjection,
      });
      setAmendments(null);
      setAt(undefined);
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
      await api.deleteVariableBudget(id);
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

  const { status } = detail;
  const periodStartMs = new Date(status.periodStart).getTime();
  const periodEndExclusiveMs = periodEndExclusive(status.periodEnd);
  const periodAmendments = (amendments ?? []).filter((entry) => {
    const t = new Date(entry.changedAt).getTime();
    return t >= periodStartMs && t < periodEndExclusiveMs;
  });

  const mainContent = (
    <>
      <View style={styles.headerCard}>
        <View style={styles.periodNavRow}>
          <TouchableOpacity testID="web-budget-nav-previous" style={styles.periodNavButton} onPress={() => setAt(detail.periodNavigation.previousPeriodAt)}>
            <Text style={styles.periodNavArrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.periodNavLabel} testID="web-budget-period-label">
            {formatDate(status.periodStart)} — {formatDate(status.periodEnd)}
            {detail.periodNavigation.isCurrentPeriod ? ' (en cours)' : ''}
          </Text>
          {detail.periodNavigation.nextPeriodAt ? (
            <TouchableOpacity testID="web-budget-nav-next" style={styles.periodNavButton} onPress={() => setAt(detail.periodNavigation.nextPeriodAt!)}>
              <Text style={styles.periodNavArrow}>›</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.periodNavButton} />
          )}
        </View>

        {detail.initialValues && detail.adjustedValues && (
          <View style={styles.adjustedBanner} testID="web-budget-initial-adjusted">
            <Text style={styles.adjustedText}>
              Montant initial : {detail.initialValues.referenceAmount.toLocaleString('fr-FR')} DH → ajusté à {detail.adjustedValues.referenceAmount.toLocaleString('fr-FR')} DH pendant cette période
            </Text>
          </View>
        )}

        <View style={styles.figuresGrid}>
          <Figure label="Budget" value={status.budgetPeriode} />
          <Figure label="Dépensé" value={status.consommeADate} />
          <Figure label="Reste selon budget" value={status.budgetContractuelRestant} />
          <Figure label="Rythme projeté" value={status.rythmeProjete} />
          <Figure label="Prévision prudente restante" value={status.projectionPrudenteRestante} highlight />
        </View>

        {status.rythmeAlerte && (
          <View style={styles.rythmeAlertBanner} testID="web-budget-rythme-alerte">
            <Text style={styles.rythmeAlertText}>
              ⚠ Rythme de dépense élevé — {Math.round(status.consumptionRatio * 100)}% consommé pour {Math.round(status.elapsedRatio * 100)}% de la période écoulée
            </Text>
          </View>
        )}
      </View>

      <Text style={styles.sectionTitle}>A. Dépenses de la période</Text>
      {detail.history.length === 0 ? (
        <Text style={styles.empty}>Aucune dépense enregistrée dans cette période.</Text>
      ) : (
        <View style={styles.table}>
          {detail.history.map((h) => (
            <View key={h.id} style={styles.tableRow}>
              <Text style={styles.tableLabel}>{h.notes || formatDate(h.spentDate)}</Text>
              <Text style={styles.tableAmount}>{h.amount.toLocaleString('fr-FR')} DH</Text>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity testID="web-budget-history-toggle" style={styles.historyToggle} onPress={toggleHistory}>
        <Text style={styles.sectionTitle}>B. Historique des modifications</Text>
        <Ionicons name={historyOpen ? 'chevron-up' : 'chevron-down'} size={16} color={webColors.textSecondary} />
      </TouchableOpacity>
      {historyOpen && (
        <View testID="web-budget-history-list">
          {amendmentsLoading ? (
            <ActivityIndicator style={{ marginTop: webSpacing.md }} />
          ) : periodAmendments.length === 0 ? (
            <Text style={styles.empty}>Aucune modification enregistrée pour cette période.</Text>
          ) : (
            <View style={styles.table}>
              {periodAmendments.map((entry, index) => (
                <View key={`${entry.field}-${entry.changedAt}-${index}`} style={styles.amendmentRow}>
                  <Text style={styles.amendmentField}>{FIELD_LABELS[entry.field] ?? entry.field}</Text>
                  <Text style={styles.amendmentChange}>
                    {formatFieldValue(entry.field, entry.oldValue)} → {formatFieldValue(entry.field, entry.newValue)}
                  </Text>
                  <Text style={styles.amendmentDate}>{formatDateTime(entry.changedAt)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </>
  );

  const panel = (
    <View style={styles.panelCard}>
      <Text style={styles.panelTitle}>{detail.category.name}</Text>
      <Text style={styles.panelSub}>Le libellé provient de la catégorie — pour le changer, choisissez une autre catégorie ailleurs.</Text>

      <FormField testID="web-budget-edit-amount" label="Montant de référence (DH)" keyboardType="decimal-pad" value={editAmount} onChangeText={setEditAmount} />
      <Select testID="web-budget-edit-period" label="Périodicité" value={editPeriod} onChange={onChangeEditPeriod} options={PERIOD_OPTIONS} />
      {editPeriod === 'mois' && (
        <>
          <Text style={styles.modalSectionLabel}>Mode du mois</Text>
          <View style={styles.segment}>
            {(Object.keys(MONTH_MODE_LABELS) as api.MonthMode[]).map((mode) => (
              <TouchableOpacity key={mode} testID={`web-budget-edit-month-mode-${mode}`} style={[styles.segmentItem, editMonthMode === mode && styles.segmentActive]} onPress={() => onChangeEditMonthMode(mode)}>
                <Text style={[styles.segmentText, editMonthMode === mode && styles.segmentTextActive]}>{MONTH_MODE_LABELS[mode]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {editMonthMode === 'personnalise' && (
            <FormField testID="web-budget-edit-custom-start-day-input" label="Jour de départ (1-31)" placeholder="Ex. 25" keyboardType="number-pad" value={editCustomStartDay} onChangeText={setEditCustomStartDay} />
          )}
        </>
      )}
      <View style={styles.prudentRow}>
        <View style={{ flex: 1, marginRight: webSpacing.sm }}>
          <Text style={styles.prudentLabel}>Inclure le restant dans la projection prudente</Text>
        </View>
        <Switch testID="web-budget-edit-include-prudent-switch" value={editIncludeInPrudentProjection} onValueChange={setEditIncludeInPrudentProjection} />
      </View>
      {editError && <Text style={styles.error}>{editError}</Text>}
      <TouchableOpacity testID="web-budget-edit-save" style={styles.button} onPress={onSaveEdit} disabled={editSaving}>
        {editSaving ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.buttonText}>Enregistrer</Text>}
      </TouchableOpacity>

      <View style={styles.deleteZone}>
        {deleteError && <Text style={styles.error}>{deleteError}</Text>}
        <TouchableOpacity testID="web-budget-delete-link" onPress={() => setDeleteConfirmOpen(true)}>
          <Text style={styles.deleteLink}>Supprimer ce budget</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <PageHeader title="Budget" />
      <TwoColumnLayout main={mainContent} panel={panel} />

      <ConfirmDialog
        testID="web-budget-delete-confirm"
        visible={deleteConfirmOpen}
        title="Supprimer ce budget ?"
        message="S'il a déjà des dépenses enregistrées, il sera archivé (historique conservé) plutôt que supprimé."
        confirmLabel="Supprimer"
        destructive
        loading={deleting}
        onConfirm={onConfirmDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </ScrollView>
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
  container: { flex: 1, backgroundColor: webColors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center' },

  headerCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.lg, marginBottom: webSpacing.md, borderWidth: 1, borderColor: webColors.borderStrong },
  periodNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: webSpacing.md },
  periodNavButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  periodNavArrow: { fontSize: 20, fontWeight: '700', color: webColors.textPrimary },
  periodNavLabel: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '700', color: webColors.textPrimary },
  adjustedBanner: { backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.md, padding: webSpacing.md, marginBottom: webSpacing.md },
  adjustedText: { fontSize: 12, color: webColors.textSecondary },
  figuresGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: webSpacing.sm },
  figure: { flexBasis: '31%', flexGrow: 1, backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.md, padding: webSpacing.sm },
  figureLabel: { fontSize: 10, color: webColors.textSecondary },
  figureValue: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary, marginTop: 4 },
  figureValueHighlight: { color: webColors.success },
  rythmeAlertBanner: { marginTop: webSpacing.md, backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.md, padding: webSpacing.sm, borderWidth: 1, borderColor: webColors.warning },
  rythmeAlertText: { fontSize: 12, fontWeight: '700', color: webColors.warning },

  sectionTitle: { fontSize: 13, fontWeight: '700', color: webColors.textPrimary },
  empty: { color: webColors.textSecondary, fontSize: 13, marginBottom: webSpacing.md },
  table: { backgroundColor: webColors.surface, borderRadius: webRadius.lg, borderWidth: 1, borderColor: webColors.border, overflow: 'hidden', marginTop: webSpacing.sm, marginBottom: webSpacing.lg },
  tableRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: webSpacing.md, paddingVertical: 10, borderTopWidth: 1, borderTopColor: webColors.tableRowBorder },
  tableLabel: { fontSize: 13, color: webColors.textPrimary },
  tableAmount: { fontSize: 13, fontWeight: '700', color: webColors.danger },
  historyToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: webSpacing.xs },
  amendmentRow: { paddingHorizontal: webSpacing.md, paddingVertical: 10, borderTopWidth: 1, borderTopColor: webColors.tableRowBorder },
  amendmentField: { fontSize: 12, fontWeight: '700', color: webColors.textPrimary },
  amendmentChange: { fontSize: 12, color: webColors.textSecondary, marginTop: 2 },
  amendmentDate: { fontSize: 10, color: webColors.textSecondary, marginTop: 2 },

  panelCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.lg, borderWidth: 1, borderColor: webColors.borderStrong },
  panelTitle: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary },
  panelSub: { fontSize: 11, color: webColors.textSecondary, fontStyle: 'italic', marginTop: 2, marginBottom: webSpacing.md },
  modalSectionLabel: { fontSize: 12, fontWeight: '600', color: webColors.textPrimary, marginBottom: webSpacing.xs, marginTop: 4 },
  segment: { flexDirection: 'row', backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.md, padding: 3, marginBottom: webSpacing.sm },
  segmentItem: { flex: 1, paddingVertical: 8, borderRadius: webRadius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: webColors.surface },
  segmentText: { fontSize: 11, color: webColors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: webColors.textPrimary },
  prudentRow: { flexDirection: 'row', alignItems: 'center', marginTop: webSpacing.xs, marginBottom: webSpacing.sm },
  prudentLabel: { fontSize: 12, fontWeight: '600', color: webColors.textPrimary },
  button: { backgroundColor: webColors.primary, borderRadius: webRadius.md, paddingVertical: 12, alignItems: 'center', marginTop: webSpacing.sm },
  buttonText: { color: webColors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  deleteZone: { marginTop: webSpacing.lg, paddingTop: webSpacing.md, borderTopWidth: 1, borderTopColor: webColors.border, alignItems: 'center' },
  deleteLink: { fontSize: 12, color: webColors.textSecondary, fontWeight: '600' },
  error: { color: webColors.danger, fontSize: 12, marginBottom: webSpacing.sm },
});
