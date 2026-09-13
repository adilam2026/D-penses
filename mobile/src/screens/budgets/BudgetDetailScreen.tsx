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

const MONTH_MODE_LABELS: Record<api.MonthMode, string> = {
  calendaire: 'Calendaire',
  financier: 'Financier',
  personnalise: 'Personnalisé',
};

// Lot 4 — sous-ensemble des 7 champs suivis, tel qu'exposé par
// initialValues/adjustedValues (seul referenceAmount est affiché pour l'instant,
// les autres restent disponibles pour un affichage plus riche ultérieur).
interface BudgetConfigValues {
  referenceAmount: number;
  referencePeriod: 'semaine' | 'mois';
}

interface PeriodNavigation {
  at: string;
  periodStart: string;
  periodEnd: string;
  isCurrentPeriod: boolean;
  previousPeriodAt: string;
  nextPeriodAt: string | null; // null = période courante, jamais de navigation vers le futur
}

interface BudgetAmendmentEntry {
  budgetId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changedAt: string;
  effectiveFrom: string;
}

interface BudgetDetail {
  id: string;
  categoryId: string;
  category: { name: string };
  referenceAmount: number;
  referencePeriod: 'semaine' | 'mois';
  weekStartDay: number;
  // Lot 6 — mode du mois, inerte pour referencePeriod='semaine'.
  monthMode: api.MonthMode;
  customStartDay: number | null;
  status: {
    periodStart: string;
    periodEnd: string;
    budgetPeriode: number;
    consommeADate: number;
    budgetContractuelRestant: number;
    rythmeProjete: number;
    previsionRythmeRestant: number;
    projectionPrudenteRestante: number;
    // Lot 3 — alerte de rythme (% consommé vs % période écoulée), additive et
    // distincte de healthStatus (ratio consommé/plafond seul) — jamais fusionnées.
    consumptionRatio: number;
    elapsedRatio: number;
    rythmeAlerte: boolean;
  };
  history: HistoryEntry[];
  // Lot 4 — navigation de périodes + valeur initiale/ajustée si le budget a été
  // modifié pendant la période affichée (null si rien n'a changé).
  periodNavigation: PeriodNavigation;
  initialValues: BudgetConfigValues | null;
  adjustedValues: BudgetConfigValues | null;
}

const PERIOD_OPTIONS = [
  { value: 'semaine', label: 'Semaine' },
  { value: 'mois', label: 'Mois' },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

const FIELD_LABELS: Record<string, string> = {
  referenceAmount: 'Montant de référence',
  referencePeriod: 'Périodicité',
  categoryId: 'Catégorie',
  categoryTypeId: 'Type de catégorie',
  weekStartDay: 'Jour de début de semaine',
  includeInPrudentProjection: 'Inclus dans la projection prudente',
  endDate: 'Date de fin',
  monthMode: 'Mode du mois',
  customStartDay: 'Jour de départ personnalisé',
};

function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (field === 'referenceAmount') return `${Number(value).toLocaleString('fr-FR')} DH`;
  if (field === 'includeInPrudentProjection') return value ? 'Oui' : 'Non';
  if (field === 'endDate') return formatDate(value as string);
  if (field === 'monthMode') return MONTH_MODE_LABELS[value as api.MonthMode] ?? String(value);
  return String(value);
}

// Lot 4 — même convention semi-ouverte que le backend (periodEndExclusive) : le
// dernier jour de période (periodEnd) n'est que le début de son dernier jour, la
// vraie borne de sortie est minuit UTC du lendemain.
function periodEndExclusive(periodEndIso: string): number {
  return new Date(periodEndIso).getTime() + 86400000;
}

/** Fiche budget (§18, R6.4 §1 — Modifier/Supprimer) — dépenses de la période courante, sans graphique. */
export function BudgetDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const id = route.params?.id as string;
  const [detail, setDetail] = useState<BudgetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // Lot 4 — navigation de périodes : `at` undefined = période courante (comportement
  // historique inchangé) ; défini (ISO), la fiche affiche la période le contenant.
  const [at, setAt] = useState<string | undefined>(undefined);

  // R6.4 (§1) — menu "..." (Modifier/Supprimer), même pattern que AccountDetailScreen (§19).
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editAmount, setEditAmount] = useState('');
  const [editPeriod, setEditPeriod] = useState<'semaine' | 'mois'>('mois');
  // Lot 6 — mode du mois, pertinent uniquement pour editPeriod='mois'. Tout
  // changement de editPeriod (dans les deux sens) les réinitialise à leur
  // défaut ('calendaire' / vide) : jamais de valeur fantôme d'une période
  // précédente réutilisée silencieusement au retour sur 'mois'.
  const [editMonthMode, setEditMonthMode] = useState<api.MonthMode>('calendaire');
  const [editCustomStartDay, setEditCustomStartDay] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Lot 4 — historique des modifications, replié par défaut, chargé à la demande
  // (une seule fois, réutilisé pour toutes les périodes consultées ensuite).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [amendments, setAmendments] = useState<BudgetAmendmentEntry[] | null>(null);
  const [amendmentsLoading, setAmendmentsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await api.getVariableBudget(id, at));
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

  function openEdit() {
    if (!detail) return;
    setMenuOpen(false);
    setEditAmount(String(detail.referenceAmount));
    setEditPeriod(detail.referencePeriod);
    // Lot 6 — le mode du mois n'a de sens que pour un budget déjà 'mois' ; pour
    // un budget 'semaine' (mode potentiellement inerte/obsolète en base), le
    // formulaire démarre toujours sur le défaut explicite plutôt que d'exposer
    // une valeur sans rapport avec ce que l'utilisateur voit.
    setEditMonthMode(detail.referencePeriod === 'mois' ? detail.monthMode : 'calendaire');
    setEditCustomStartDay(
      detail.referencePeriod === 'mois' && detail.monthMode === 'personnalise' && detail.customStartDay != null
        ? String(detail.customStartDay)
        : '',
    );
    setEditError(null);
    setEditOpen(true);
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
      });
      setEditOpen(false);
      setAmendments(null); // Lot 4 — l'historique vient de changer, invalidé pour être rechargé à la prochaine ouverture.
      setAt(undefined); // revient à la période courante, celle qui vient d'être modifiée.
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

  // Lot 4 — historique filtré côté mobile sur la période affichée (même liste que
  // /history, jamais un second calcul serveur) : convention semi-ouverte identique
  // au backend, changedAt dans [periodStart, periodEndExclusive).
  const periodStartMs = new Date(status.periodStart).getTime();
  const periodEndExclusiveMs = periodEndExclusive(status.periodEnd);
  const periodAmendments = (amendments ?? []).filter((entry) => {
    const t = new Date(entry.changedAt).getTime();
    return t >= periodStartMs && t < periodEndExclusiveMs;
  });

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

      {/* Lot 4 — navigation < précédente | période | suivante >. "Suivante" masquée
          sur la période courante (jamais de navigation vers le futur). */}
      <View style={styles.periodNavRow}>
        <TouchableOpacity
          testID="budget-nav-previous"
          style={styles.periodNavButton}
          onPress={() => setAt(detail.periodNavigation.previousPeriodAt)}
        >
          <Text style={styles.periodNavArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.periodNavLabel} testID="budget-period-label">
          {formatDate(status.periodStart)} — {formatDate(status.periodEnd)}
          {detail.periodNavigation.isCurrentPeriod ? ' (en cours)' : ''}
        </Text>
        {detail.periodNavigation.nextPeriodAt ? (
          <TouchableOpacity
            testID="budget-nav-next"
            style={styles.periodNavButton}
            onPress={() => setAt(detail.periodNavigation.nextPeriodAt!)}
          >
            <Text style={styles.periodNavArrow}>›</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.periodNavButton} />
        )}
      </View>

      {/* Lot 4 — valeur initiale/ajustée, uniquement si le budget a été modifié
          pendant la période actuellement affichée (jamais montré sinon). */}
      {detail.initialValues && detail.adjustedValues && (
        <View style={styles.adjustedBanner} testID="budget-initial-adjusted">
          <Text style={styles.adjustedText}>
            Montant initial : {detail.initialValues.referenceAmount.toLocaleString('fr-FR')} DH → ajusté à{' '}
            {detail.adjustedValues.referenceAmount.toLocaleString('fr-FR')} DH pendant cette période
          </Text>
        </View>
      )}

      <View style={styles.figuresGrid}>
        <Figure label="Budget" value={status.budgetPeriode} />
        <Figure label="Dépensé" value={status.consommeADate} />
        <Figure label="Reste selon budget" value={status.budgetContractuelRestant} />
        <Figure label="Projection au rythme actuel" value={status.rythmeProjete} />
        <Figure label="Prévision prudente restante" value={status.projectionPrudenteRestante} highlight />
      </View>

      {/* Lot 3 — alerte de rythme : additive, jamais fusionnée avec le badge
          healthStatus (ratio consommé/plafond seul, affiché sur BudgetsScreen). */}
      {status.rythmeAlerte && (
        <View style={styles.rythmeAlertBanner} testID="budget-rythme-alerte">
          <Text style={styles.rythmeAlertText}>
            ⚠ Rythme de dépense élevé — {Math.round(status.consumptionRatio * 100)}% consommé pour {Math.round(status.elapsedRatio * 100)}% de la période écoulée
          </Text>
        </View>
      )}

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
        ListFooterComponent={
          <View style={styles.amendmentsSection}>
            <TouchableOpacity testID="budget-history-toggle" style={styles.amendmentsToggle} onPress={toggleHistory}>
              <Text style={styles.amendmentsToggleText}>Historique des modifications</Text>
              <Text style={styles.amendmentsToggleIcon}>{historyOpen ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {historyOpen && (
              <View testID="budget-history-list">
                {amendmentsLoading ? (
                  <ActivityIndicator style={{ marginTop: spacing.md }} />
                ) : periodAmendments.length === 0 ? (
                  <Text style={styles.empty}>Aucune modification enregistrée pour cette période.</Text>
                ) : (
                  periodAmendments.map((entry, index) => (
                    <View key={`${entry.field}-${entry.changedAt}-${index}`} style={styles.amendmentRow}>
                      <Text style={styles.amendmentField}>{FIELD_LABELS[entry.field] ?? entry.field}</Text>
                      <Text style={styles.amendmentChange}>
                        {formatFieldValue(entry.field, entry.oldValue)} → {formatFieldValue(entry.field, entry.newValue)}
                      </Text>
                      <Text style={styles.amendmentDate}>{formatDateTime(entry.changedAt)}</Text>
                    </View>
                  ))
                )}
              </View>
            )}
          </View>
        }
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
            <Select testID="budget-edit-period" label="Périodicité" value={editPeriod} onChange={onChangeEditPeriod} options={PERIOD_OPTIONS} />
            {editPeriod === 'mois' && (
              <>
                <Text style={styles.modalSectionLabel}>Mode du mois</Text>
                <View style={styles.segment}>
                  {(Object.keys(MONTH_MODE_LABELS) as api.MonthMode[]).map((mode) => (
                    <TouchableOpacity
                      key={mode}
                      testID={`budget-edit-month-mode-${mode}`}
                      style={[styles.segmentItem, editMonthMode === mode && styles.segmentActive]}
                      onPress={() => onChangeEditMonthMode(mode)}
                    >
                      <Text style={[styles.segmentText, editMonthMode === mode && styles.segmentTextActive]}>{MONTH_MODE_LABELS[mode]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {editMonthMode === 'personnalise' && (
                  <FormField
                    testID="budget-edit-custom-start-day-input"
                    label="Jour de départ (1-31)"
                    placeholder="Ex. 25"
                    keyboardType="number-pad"
                    value={editCustomStartDay}
                    onChangeText={setEditCustomStartDay}
                  />
                )}
              </>
            )}
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
  rythmeAlertBanner: {
    backgroundColor: colors.surfaceActive,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  rythmeAlertText: { fontSize: 12, fontWeight: '700', color: colors.warning },
  periodNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  periodNavButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  periodNavArrow: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  periodNavLabel: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  adjustedBanner: {
    backgroundColor: colors.surfaceActive,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  adjustedText: { fontSize: 12, color: colors.textSecondary },
  amendmentsSection: { marginTop: spacing.lg },
  amendmentsToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  amendmentsToggleText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  amendmentsToggleIcon: { fontSize: 12, color: colors.textSecondary },
  amendmentRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  amendmentField: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  amendmentChange: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  amendmentDate: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },
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
  modalSectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm, marginTop: 4 },
  segment: { flexDirection: 'row', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, marginBottom: spacing.md },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: colors.textPrimary },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.md },
  modalButton: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 18, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  modalButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  modalButtonSecondary: { paddingHorizontal: 14, paddingVertical: 10, marginRight: 8 },
  modalButtonSecondaryText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
});
