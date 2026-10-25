import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { colors, elevation, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatMonthLabel, formatShortDate } from '../ui/formatMoney';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { HelpButton } from '../ui/HelpButton';
import { Toast } from '../ui/Toast';
import { accountLabelFor } from '../ui/accountLabel';
import { PlannedOperationActionFlow } from './PlanningScreen';

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
    expectedDate: action.expectedDate,
    // "À faire" n'affiche jamais le détail d'une action déjà réalisée (la
    // section "Effectué" reste informative, jamais tappable) — cette
    // reconstruction n'est donc appelée que sur des actions PENDING.
    realizedOperationId: null,
  };
}

/**
 * "À faire" (lot dédié) — vue opérationnelle compacte des actions à exécuter
 * ce mois-ci, lue intégralement depuis Planning (GET /todo, lui-même bâti sur
 * buildPlanningTable()) : jamais un second moteur de calcul du réalisé/reste
 * (§12/§20). Ouvrir une ligne ouvre EXACTEMENT le même composant d'action
 * (ActionSheet, via PlannedOperationActionFlow) que Planning — §3/§11.
 */
export function TodoScreen() {
  const navigation = useNavigation<any>();
  const topInset = useTopInset();
  const bottomInset = useBottomInset();
  const [monthsOffset, setMonthsOffset] = useState(0);
  const [data, setData] = useState<api.TodoListApi | null>(null);
  const [accounts, setAccounts] = useState<api.AccountApi[]>([]);
  const [categories, setCategories] = useState<api.CategoryApi[]>([]);
  const [members, setMembers] = useState<api.HouseholdMembershipApi[]>([]);
  const [filter, setFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [doneExpanded, setDoneExpanded] = useState(false);
  // Lot "refonte Planning/À faire" §3/§11 — ActionSheet est le SEUL point
  // d'entrée d'exécution, identique à Planning (jamais un second flux de
  // validation rapide séparé, ex. l'ancien cercle de confirmation directe).
  const [actionTarget, setActionTarget] = useState<{ occurrence: api.PlanningSingleOccurrenceApi; rowLabel: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (offset: number) => {
    const [todo, accountList, categoryList, household] = await Promise.all([api.getTodo(offset), api.listAccounts(), api.listCategories(), api.getMyHousehold()]);
    setData(todo);
    setAccounts(accountList);
    setCategories(categoryList);
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
              // Petit indicateur d'état (§10) : En retard > Partiel > À faire — jamais plus d'un badge à la fois.
              const stateLabel = action.late ? 'En retard' : hasPartialPayment ? 'Partiel' : 'À faire';
              const stateStyle = action.late ? styles.badgeLate : hasPartialPayment ? styles.badgePartial : styles.badgeDefault;
              return (
                <TouchableOpacity
                  key={action.plannedOperationId}
                  style={styles.row}
                  // Lot "refonte Planning/À faire" §3/§11 — EXACTEMENT le même
                  // composant d'action que Planning (ActionSheet), jamais un
                  // second moteur/flux de validation rapide séparé.
                  onPress={() => setActionTarget({ occurrence: occurrenceFromAction(action), rowLabel: action.label })}
                  testID={`todo-row-${action.plannedOperationId}`}
                >
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowTopLine}>
                      <Text style={styles.rowLabel} numberOfLines={1}>
                        {action.label}
                      </Text>
                      <Text style={styles.rowAmount}>{formatDh(action.remaining)}</Text>
                    </View>
                    {/* "04 nov. · Adil Compte Principal → Courses" — date + comptes sur une seule ligne compacte (§10). */}
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {formatShortDate(action.expectedDate)} · {sourceLabel ?? '—'} → {destinationLabel ?? '—'}
                    </Text>
                    <View style={styles.rowBottomLine}>
                      <Text style={styles.rowResponsible} numberOfLines={1}>
                        {responsibleLabel(action.responsibleMemberId)} ·{' '}
                        <Text style={{ color: KIND_COLOR[action.kind] }}>{KIND_LABEL[action.kind]}</Text>
                      </Text>
                      <View style={[styles.badge, stateStyle]} testID={`todo-row-${action.plannedOperationId}-badge`}>
                        <Text style={styles.badgeText}>{stateLabel}</Text>
                      </View>
                    </View>
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

      <PlannedOperationActionFlow
        target={actionTarget}
        accounts={accounts}
        categories={categories}
        members={members}
        onClose={() => setActionTarget(null)}
        onRefresh={async () => {
          await refresh();
        }}
        onRefreshAndResolve={async (plannedOperationId) => {
          const todo = await refresh();
          const fresh = todo.pending.find((a) => a.plannedOperationId === plannedOperationId);
          return fresh ? occurrenceFromAction(fresh) : null;
        }}
        showToast={showToast}
        onViewTransaction={(operationId) => navigation.navigate('TransactionDetail', { id: operationId })}
      />

      <Toast message={toast} />
    </View>
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
  rowTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { ...typography.body, fontWeight: '700', flex: 1, marginRight: spacing.sm },
  rowAmount: { ...typography.body, fontWeight: '800' },
  rowMeta: { ...typography.caption, marginTop: 1 },
  rowBottomLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 1 },
  rowResponsible: { ...typography.caption, flex: 1, marginRight: spacing.sm },
  rowReste: { ...typography.caption, color: colors.primaryDark, fontWeight: '700', marginTop: 1 },
  // Petit indicateur d'état (§10) — À faire/Partiel/En retard, jamais plus d'un badge à la fois.
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  badgeText: { fontSize: 10, fontWeight: '800' },
  badgeDefault: { backgroundColor: colors.surfaceSecondary },
  badgePartial: { backgroundColor: colors.warningLight },
  badgeLate: { backgroundColor: colors.dangerLight },
  doneHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  doneHeaderText: { ...typography.sectionLabel, color: colors.textSecondary },
  doneRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
});
