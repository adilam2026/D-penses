import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { colors, elevation, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatMonthLabel, formatShortDate } from '../ui/formatMoney';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { HelpButton } from '../ui/HelpButton';
import { Toast } from '../ui/Toast';
import { accountLabelFor } from '../ui/accountLabel';
import { AdjustModal } from './PlanningScreen';

const TOAST_DURATION_MS = 1800;

const KIND_LABEL: Record<'EXPENSE' | 'SAVINGS_CONTRIBUTION', string> = {
  EXPENSE: 'DÉPENSE',
  SAVINGS_CONTRIBUTION: 'VERSEMENT',
};
const KIND_COLOR: Record<'EXPENSE' | 'SAVINGS_CONTRIBUTION', string> = {
  EXPENSE: colors.danger,
  SAVINGS_CONTRIBUTION: colors.primary,
};

/** "2026-10" → "octobre" (minuscule — §18 "✓ Tout est fait pour octobre"). */
function monthNameLower(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
}

/**
 * Reconstruit une occurrence "Payer / Ajuster" (même forme que Planning,
 * §12 : les deux écrans lisent le même état métier) à partir d'une action À
 * faire — AdjustModal est STRICTEMENT le composant de Planning, réutilisé
 * tel quel (§10 "réutilise exactement le moteur déjà développé").
 */
function occurrenceFromAction(action: api.TodoActionApi): api.PlanningSingleOccurrenceApi {
  return {
    plannedOperationId: action.plannedOperationId,
    status: action.status,
    expectedAmount: action.expectedAmount,
    realizedAmount: action.realizedAmount,
    sourceAccountId: action.sourceAccountId,
    sourceSubaccountId: action.sourceSubaccountId,
    destinationAccountId: action.destinationAccountId,
    destinationSubaccountId: action.destinationSubaccountId,
    recurrenceRuleId: action.recurrenceRuleId,
    categoryId: action.categoryId,
    kind: action.kind,
    responsibleMemberId: action.responsibleMemberId,
  };
}

/**
 * "À faire" (lot dédié) — vue opérationnelle compacte des actions à exécuter
 * ce mois-ci, lue intégralement depuis Planning (GET /todo, lui-même bâti sur
 * buildPlanningTable()) : jamais un second moteur de calcul du réalisé/reste
 * (§12/§20). Validation rapide (tap du cercle) ou ouverture de la ligne pour
 * un paiement partiel (AdjustModal, exactement celui de Planning).
 */
export function TodoScreen() {
  const topInset = useTopInset();
  const bottomInset = useBottomInset();
  const [monthsOffset, setMonthsOffset] = useState(0);
  const [data, setData] = useState<api.TodoListApi | null>(null);
  const [accounts, setAccounts] = useState<api.AccountApi[]>([]);
  const [members, setMembers] = useState<api.HouseholdMembershipApi[]>([]);
  const [filter, setFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<api.TodoActionApi | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<{ occurrence: api.PlanningSingleOccurrenceApi; rowLabel: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (offset: number) => {
    const [todo, accountList, household] = await Promise.all([api.getTodo(offset), api.listAccounts(), api.getMyHousehold()]);
    setData(todo);
    setAccounts(accountList);
    setMembers(household.memberships);
    return todo;
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load(monthsOffset).finally(() => setLoading(false));
    }, [load, monthsOffset]),
  );

  async function refresh() {
    return load(monthsOffset);
  }

  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }

  function responsibleLabel(memberId: string | null): string {
    if (!memberId) return 'Responsable à définir';
    const m = members.find((mm) => mm.id === memberId);
    return m ? m.user.firstName : 'Responsable à définir';
  }

  if (loading && !data) {
    return (
      <View style={[styles.center, { paddingTop: topInset }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (!data) return null;

  // §15 : la synthèse (et la liste) se filtre par responsable ; le badge de
  // navigation (RootTabs), lui, reste TOUJOURS le total tous-responsables
  // (lu via un appel séparé sans offset — jamais celui-ci).
  const pending = filter === 'ALL' ? data.pending : data.pending.filter((a) => a.responsibleMemberId === filter);
  const done = filter === 'ALL' ? data.done : data.done.filter((a) => a.responsibleMemberId === filter);
  const pendingCount = pending.length;
  const totalRemaining = pending.reduce((sum, a) => sum + a.remaining, 0);
  const nothingEverPlanned = data.pending.length === 0 && data.done.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingTop: topInset }}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>À faire</Text>
            <Text style={styles.subtitle}>Les opérations à exécuter ce mois-ci.</Text>
          </View>
          <HelpButton
            title="À faire"
            text="Les actions à exécuter ce mois-ci, tous comptes confondus. Touchez le cercle pour valider un paiement complet, ou la ligne pour l'ajuster ou la payer partiellement."
          />
        </View>

        <View style={styles.monthNav}>
          <TouchableOpacity onPress={() => setMonthsOffset((o) => o - 1)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} testID="todo-month-prev">
            <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.monthLabel} testID="todo-month-label">
            {formatMonthLabel(data.month)}
          </Text>
          <TouchableOpacity onPress={() => setMonthsOffset((o) => o + 1)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} testID="todo-month-next">
            <Ionicons name="chevron-forward" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={styles.filterRow}>
          <TouchableOpacity style={[styles.filterPill, filter === 'ALL' && styles.filterPillActive]} onPress={() => setFilter('ALL')} testID="todo-filter-tous">
            <Text style={[styles.filterPillText, filter === 'ALL' && styles.filterPillTextActive]}>Tous</Text>
          </TouchableOpacity>
          {members.map((m) => (
            <TouchableOpacity
              key={m.id}
              style={[styles.filterPill, filter === m.id && styles.filterPillActive]}
              onPress={() => setFilter(m.id)}
              testID={`todo-filter-${m.id}`}
            >
              <Text style={[styles.filterPillText, filter === m.id && styles.filterPillTextActive]}>{m.user.firstName}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.synthese} testID="todo-synthese">
          <Text style={styles.syntheseCount} testID="todo-synthese-count">
            {pendingCount} action{pendingCount > 1 ? 's' : ''} restante{pendingCount > 1 ? 's' : ''}
          </Text>
          <Text style={styles.syntheseAmount} testID="todo-synthese-amount">
            {formatDh(totalRemaining)} à exécuter
          </Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: bottomInset }}>
        {nothingEverPlanned ? (
          <Text style={styles.emptyText} testID="todo-empty">
            Aucune action prévue ce mois-ci.
          </Text>
        ) : pending.length === 0 ? (
          <Text style={styles.emptyText} testID="todo-all-done">
            ✓ Tout est fait pour {monthNameLower(data.month)}
          </Text>
        ) : (
          <View style={{ paddingHorizontal: spacing.lg }}>
            {pending.map((action) => {
              const sourceLabel = accountLabelFor(accounts, action.sourceAccountId, action.sourceSubaccountId);
              const destinationLabel =
                action.kind === 'SAVINGS_CONTRIBUTION' ? accountLabelFor(accounts, action.destinationAccountId, action.destinationSubaccountId) : 'Dépense';
              const hasPartialPayment = action.realizedAmount !== null && action.realizedAmount > 0;
              return (
                <TouchableOpacity
                  key={action.plannedOperationId}
                  style={styles.row}
                  onPress={() => setAdjustTarget({ occurrence: occurrenceFromAction(action), rowLabel: action.label })}
                  testID={`todo-row-${action.plannedOperationId}`}
                >
                  <TouchableOpacity
                    style={styles.stateCircle}
                    onPress={() => setConfirmTarget(action)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    testID={`todo-row-${action.plannedOperationId}-circle`}
                  >
                    <Ionicons name="ellipse-outline" size={22} color={colors.textPlaceholder} />
                  </TouchableOpacity>
                  <View style={{ flex: 1, marginLeft: spacing.sm }}>
                    <View style={styles.rowTopLine}>
                      <Text style={styles.rowLabel} numberOfLines={1}>
                        {action.label}
                      </Text>
                      <Text style={styles.rowAmount}>{formatDh(action.remaining)}</Text>
                    </View>
                    <Text style={[styles.rowNature, { color: KIND_COLOR[action.kind] }]}>{KIND_LABEL[action.kind]}</Text>
                    <Text style={styles.rowAccounts} numberOfLines={1}>
                      {sourceLabel ?? '—'} → {destinationLabel ?? '—'}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {responsibleLabel(action.responsibleMemberId)} ·{' '}
                      <Text style={action.late ? styles.rowMetaLate : undefined} testID={action.late ? `todo-row-${action.plannedOperationId}-late` : undefined}>
                        {action.late ? `En retard · ${formatShortDate(action.expectedDate)}` : formatShortDate(action.expectedDate)}
                      </Text>
                    </Text>
                    {hasPartialPayment && (
                      <Text style={styles.rowReste} testID={`todo-row-${action.plannedOperationId}-reste`}>
                        Reste sur {formatDh(action.expectedAmount)}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <TouchableOpacity style={styles.doneHeader} onPress={() => setDoneExpanded((v) => !v)} testID="todo-done-toggle">
          <Text style={styles.doneHeaderText}>
            ✓ EFFECTUÉ ({done.length})
          </Text>
          <Ionicons name={doneExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
        </TouchableOpacity>
        {doneExpanded && (
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: bottomInset }}>
            {done.length === 0 ? (
              <Text style={styles.emptyText}>Aucune action réalisée ce mois-ci.</Text>
            ) : (
              done.map((action) => (
                <View key={action.plannedOperationId} style={styles.doneRow} testID={`todo-done-row-${action.plannedOperationId}`}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                  <View style={{ flex: 1, marginLeft: spacing.sm }}>
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {action.label}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {responsibleLabel(action.responsibleMemberId)} · {formatShortDate(action.expectedDate)}
                    </Text>
                  </View>
                  <Text style={styles.rowAmount}>{formatDh(action.realizedAmount ?? action.expectedAmount)}</Text>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      <ConfirmSheet
        target={confirmTarget}
        accounts={accounts}
        onClose={() => setConfirmTarget(null)}
        onConfirmed={async (message) => {
          setConfirmTarget(null);
          showToast(message);
          await refresh();
        }}
      />

      <AdjustModal
        target={adjustTarget}
        accounts={accounts}
        onClose={() => setAdjustTarget(null)}
        onDone={async () => {
          setAdjustTarget(null);
          await refresh();
        }}
      />

      <Toast message={toast} />
    </View>
  );
}

/**
 * Validation rapide (§9) : confirme le paiement COMPLET du reste à payer —
 * jamais le prévu d'origine (une échéance partiellement payée ne doit jamais
 * être réglée en double). Même moteur que Planning (realizePlannedOperation).
 */
function ConfirmSheet({
  target,
  accounts,
  onClose,
  onConfirmed,
}: {
  target: api.TodoActionApi | null;
  accounts: api.AccountApi[];
  onClose: () => void;
  onConfirmed: (message: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  if (!target) return null;
  const remaining = target.expectedAmount - (target.realizedAmount ?? 0);
  const sourceLabel = accountLabelFor(accounts, target.sourceAccountId, target.sourceSubaccountId) ?? '—';

  async function confirm() {
    if (saving || !target) return;
    setSaving(true);
    try {
      await api.realizePlannedOperation(target.plannedOperationId, { actualAmount: String(remaining) });
      await onConfirmed('Action validée');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} testID="todo-confirm-sheet">
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <View style={styles.confirmBox}>
        <Text style={styles.confirmTitle}>Confirmer le paiement ?</Text>
        <Text style={styles.confirmLabel}>{target.label}</Text>
        <Text style={styles.confirmAmount}>{formatDh(remaining)}</Text>
        <Text style={styles.confirmMeta}>Depuis : {sourceLabel}</Text>
        <Text style={styles.confirmMeta}>Date : Aujourd'hui</Text>
        <View style={styles.confirmActions}>
          <TouchableOpacity style={styles.confirmCancel} onPress={onClose} testID="todo-confirm-cancel">
            <Text style={styles.confirmCancelText}>Annuler</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmSubmit} onPress={confirm} testID="todo-confirm-submit">
            <Text style={styles.confirmSubmitText}>{saving ? '…' : 'Confirmer'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  title: { ...typography.screenTitle },
  subtitle: { ...typography.bodySecondary, marginTop: 2 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm },
  monthLabel: { ...typography.sectionTitle, marginHorizontal: spacing.md, minWidth: 140, textAlign: 'center' },
  filterRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  filterPill: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, marginRight: spacing.sm },
  filterPillActive: { backgroundColor: colors.primary },
  filterPillText: { ...typography.caption, fontWeight: '700', color: colors.textSecondary },
  filterPillTextActive: { color: colors.textOnPrimary },
  synthese: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  syntheseCount: { ...typography.body, fontWeight: '700' },
  syntheseAmount: { ...typography.body, fontWeight: '700', color: colors.primaryDark },
  emptyText: { ...typography.bodySecondary, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    ...elevation.card,
  },
  stateCircle: { paddingTop: 2 },
  rowTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { ...typography.body, fontWeight: '700', flex: 1, marginRight: spacing.sm },
  rowAmount: { ...typography.body, fontWeight: '800' },
  rowNature: { ...typography.caption, fontWeight: '800', marginTop: 1 },
  rowAccounts: { ...typography.caption, marginTop: 1 },
  rowMeta: { ...typography.caption, marginTop: 1 },
  rowMetaLate: { color: colors.warning, fontWeight: '700' },
  rowReste: { ...typography.caption, color: colors.primaryDark, fontWeight: '700', marginTop: 1 },
  doneHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  doneHeaderText: { ...typography.sectionLabel, color: colors.textSecondary },
  doneRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  confirmBox: { position: 'absolute', left: spacing.xl, right: spacing.xl, top: '35%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, ...elevation.raised },
  confirmTitle: { ...typography.sectionTitle, textAlign: 'center' },
  confirmLabel: { ...typography.body, textAlign: 'center', marginTop: spacing.sm },
  confirmAmount: { ...typography.amountSecondary, textAlign: 'center', marginTop: 2 },
  confirmMeta: { ...typography.bodySecondary, textAlign: 'center', marginTop: spacing.xs },
  confirmActions: { flexDirection: 'row', marginTop: spacing.lg },
  confirmCancel: { flex: 1, alignItems: 'center', paddingVertical: spacing.md, marginRight: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  confirmCancelText: { ...typography.body, fontWeight: '700' },
  confirmSubmit: { flex: 1, alignItems: 'center', paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, ...elevation.button },
  confirmSubmitText: { ...typography.body, fontWeight: '700', color: colors.textOnPrimary },
});
