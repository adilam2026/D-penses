import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { colors, elevation, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatMonthLabel, formatMonthShort } from '../ui/formatMoney';
import { MonthNavigator } from '../ui/MonthNavigator';
import { monthKeyDiff, shiftMonthKey } from '../ui/monthKey';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { HelpButton } from '../ui/HelpButton';
import { Toast } from '../ui/Toast';
import { PlannedOperationActionFlow } from './PlanningScreen';

const TOAST_DURATION_MS = 1800;
const UNASSIGNED_KEY = '__unassigned__';
const DONE_KEY = '__done__';

/** "2026-10" → "octobre" (minuscule — "✓ Tout est fait pour octobre"). */
function monthNameLower(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
}

/**
 * Reconstruit une occurrence "Payer / Ajuster" (même forme que Planning) à
 * partir d'une action À faire — ActionSheet est STRICTEMENT le composant de
 * Planning, réutilisé tel quel (§36 "aucune variante métier spécifique à Todo").
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
 * "À faire" (lot "refonte Planning/À faire" §28-39) — vue opérationnelle
 * compacte des actions à exécuter ce mois-ci, lue intégralement depuis
 * Planning (GET /todo, lui-même bâti sur buildPlanningTable()) : jamais un
 * second moteur de calcul du réalisé/reste. Structurée en accordéons PAR
 * RESPONSABLE (plus de filtres Tous/Adil/Lamiaa) — ouvrir une ligne ouvre
 * EXACTEMENT le même composant d'action (ActionSheet) que Planning.
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
  const [loading, setLoading] = useState(true);
  // §29-34 — un accordéon par section (un par membre + Non attribué si
  // nécessaire + Effectué) ; toutes ouvertes par défaut SAUF Effectué, état
  // conservé pendant la navigation tant que l'écran reste monté.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set([DONE_KEY]));
  function toggleSection(key: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  // Lot "refonte Planning/À faire" §3/§11/§36 — ActionSheet est le SEUL point
  // d'entrée d'exécution, identique à Planning (jamais un second flux de
  // validation rapide séparé).
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

  if (loading && !data) {
    return (
      <View style={[styles.center, { paddingTop: topInset }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (!data) return null;

  const pendingCount = data.pending.length;
  const totalRemaining = data.pending.reduce((sum, a) => sum + a.remaining, 0);
  const nothingEverPlanned = data.pending.length === 0 && data.done.length === 0;

  // §29-33 — regroupement PAR RESPONSABLE : un bucket par membre du foyer
  // (dans l'ordre du foyer, jamais un ordre arbitraire/codé en dur), un
  // bucket "Non attribué" distinct — affiché UNIQUEMENT s'il contient au
  // moins une échéance (§32), jamais pour repérer une anomalie masquée.
  const pendingByMember = new Map<string, api.TodoActionApi[]>();
  const unassigned: api.TodoActionApi[] = [];
  for (const action of data.pending) {
    if (action.responsibleMemberId) {
      const list = pendingByMember.get(action.responsibleMemberId) ?? [];
      list.push(action);
      pendingByMember.set(action.responsibleMemberId, list);
    } else {
      unassigned.push(action);
    }
  }
  const doneTotal = data.done.reduce((sum, a) => sum + (a.realizedAmount ?? a.expectedAmount), 0);

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
            text="Les actions à exécuter ce mois-ci, regroupées par responsable. Touchez une ligne pour la payer, la payer partiellement, la modifier ou l'annuler."
          />
        </View>

        {/* Navigation commune avec Planning : mois voisins tactiles, swipe
            sur la barre, mois central = sélecteur de période. Tout reste
            exprimé en monthsOffset (décalage depuis le mois courant envoyé
            tel quel à /todo). */}
        <MonthNavigator
          testIDPrefix="todo-period"
          style={styles.periodBar}
          activeFlex={1.8}
          previous={{ monthKey: shiftMonthKey(data.month, -1), label: formatMonthShort(shiftMonthKey(data.month, -1)).toUpperCase(), onPress: () => setMonthsOffset((o) => o - 1) }}
          active={{ monthKey: data.month, label: formatMonthLabel(data.month).toUpperCase() }}
          next={{ monthKey: shiftMonthKey(data.month, 1), label: formatMonthShort(shiftMonthKey(data.month, 1)).toUpperCase(), onPress: () => setMonthsOffset((o) => o + 1) }}
          picker={{
            // Années glissantes sans limite, comme le Planning (cf. PeriodPickerSheet).
            onSelect: (m) => setMonthsOffset(monthsOffset + monthKeyDiff(data.month, m)),
          }}
        />

        <View style={styles.synthese} testID="todo-synthese">
          <Text style={styles.syntheseCount} testID="todo-synthese-count">
            {pendingCount} action{pendingCount > 1 ? 's' : ''} restante{pendingCount > 1 ? 's' : ''}
          </Text>
          <Text style={styles.syntheseAmount} testID="todo-synthese-amount">
            {formatDh(totalRemaining)} à exécuter
          </Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: bottomInset }}>
        {nothingEverPlanned ? (
          <Text style={styles.emptyText} testID="todo-empty">
            Aucune action prévue ce mois-ci.
          </Text>
        ) : pendingCount === 0 ? (
          <Text style={styles.emptyText} testID="todo-all-done">
            ✓ Tout est fait pour {monthNameLower(data.month)}
          </Text>
        ) : (
          <>
            {members.map((m) => {
              const list = pendingByMember.get(m.id);
              if (!list || list.length === 0) return null;
              return (
                <TodoSection
                  key={m.id}
                  sectionKey={m.id}
                  title={m.user.firstName}
                  icon="person-circle-outline"
                  actions={list}
                  isCollapsed={collapsedSections.has(m.id)}
                  onToggle={() => toggleSection(m.id)}
                  onPressAction={(action) => setActionTarget({ occurrence: occurrenceFromAction(action), rowLabel: action.label })}
                />
              );
            })}
            {unassigned.length > 0 && (
              <TodoSection
                sectionKey={UNASSIGNED_KEY}
                title="Non attribué"
                icon="help-circle-outline"
                actions={unassigned}
                isCollapsed={collapsedSections.has(UNASSIGNED_KEY)}
                onToggle={() => toggleSection(UNASSIGNED_KEY)}
                onPressAction={(action) => setActionTarget({ occurrence: occurrenceFromAction(action), rowLabel: action.label })}
                neutral
              />
            )}
          </>
        )}

        {/* §34 — "Effectué" : accordéon global fermé par défaut, informatif uniquement. */}
        <View style={styles.sectionCard} testID="todo-section-done">
          <TouchableOpacity style={styles.sectionHeader} onPress={() => toggleSection(DONE_KEY)} testID="todo-done-toggle">
            <View style={[styles.sectionIconCircle, { backgroundColor: colors.successLight }]}>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            </View>
            <Text style={styles.sectionTitle} numberOfLines={1}>
              Effectué
            </Text>
            <Text style={styles.sectionMeta} numberOfLines={1}>
              {data.done.length} échéance{data.done.length > 1 ? 's' : ''}
              {data.done.length > 0 ? ` · ${formatDh(doneTotal)}` : ''}
            </Text>
            <Ionicons name={collapsedSections.has(DONE_KEY) ? 'chevron-forward' : 'chevron-down'} size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          {!collapsedSections.has(DONE_KEY) && (
            <View style={styles.sectionBody}>
              {data.done.length === 0 ? (
                <Text style={styles.emptyText}>Aucune action réalisée ce mois-ci.</Text>
              ) : (
                data.done.map((action) => (
                  <View key={action.plannedOperationId} style={styles.doneRow} testID={`todo-done-row-${action.plannedOperationId}`}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                    <Text style={[styles.rowLabel, { marginLeft: spacing.sm }]} numberOfLines={2}>
                      {action.label}
                    </Text>
                    <Text style={styles.rowAmount}>{formatDh(action.realizedAmount ?? action.expectedAmount)}</Text>
                  </View>
                ))
              )}
            </View>
          )}
        </View>
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
        showToast={showToast}
        onViewTransaction={(operationId) => navigation.navigate('TransactionDetail', { id: operationId })}
      />

      <Toast message={toast} />
    </View>
  );
}

/**
 * Accordéon "À faire" par responsable (§30-32) — header : icône + nom +
 * nombre d'échéances + montant restant total + chevron. Contenu : lignes
 * compactes (§35), chacune ouvrant l'ActionSheet au tap.
 */
function TodoSection({
  sectionKey,
  title,
  icon,
  actions,
  isCollapsed,
  onToggle,
  onPressAction,
  neutral,
}: {
  sectionKey: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  actions: api.TodoActionApi[];
  isCollapsed: boolean;
  onToggle: () => void;
  onPressAction: (action: api.TodoActionApi) => void;
  /** "Non attribué" (§32) — couleur neutre/orange très clair, jamais la même teinte qu'un membre réel. */
  neutral?: boolean;
}) {
  const total = actions.reduce((sum, a) => sum + a.remaining, 0);
  const groups = [
    // Même identité que les blocs du Planning : DÉPENSES = danger, VERSEMENTS = secondary.
    { key: 'depenses', title: 'DÉPENSES', color: colors.danger, actions: actions.filter((a) => a.kind !== 'SAVINGS_CONTRIBUTION') },
    { key: 'versements', title: 'VERSEMENTS', color: colors.secondary, actions: actions.filter((a) => a.kind === 'SAVINGS_CONTRIBUTION') },
  ].filter((g) => g.actions.length > 0);
  return (
    <View style={styles.sectionCard} testID={`todo-section-${sectionKey}`}>
      <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} testID={`todo-section-${sectionKey}-toggle`}>
        <View style={[styles.sectionIconCircle, { backgroundColor: neutral ? colors.warningLight : colors.surfaceActive }]}>
          <Ionicons name={icon} size={16} color={neutral ? colors.warning : colors.primary} />
        </View>
        <Text style={styles.sectionTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.sectionMeta} numberOfLines={1}>
          {actions.length} échéance{actions.length > 1 ? 's' : ''} · {formatDh(total)}
        </Text>
        <Ionicons name={isCollapsed ? 'chevron-forward' : 'chevron-down'} size={16} color={colors.textSecondary} />
      </TouchableOpacity>
      {!isCollapsed && (
        <View style={styles.sectionBody}>
          {/* Dépenses puis versements, séparés par un simple petit libellé —
              un groupe vide n'est jamais affiché. */}
          {groups.map((group, idx) => (
            <View key={group.key} testID={`todo-section-${sectionKey}-group-${group.key}`}>
              <Text style={[styles.groupLabel, { color: group.color }, idx > 0 && styles.groupLabelSeparated]} testID={`todo-section-${sectionKey}-group-${group.key}-label`}>
                {group.title}
              </Text>
              {group.actions.map((action) => (
                // Vue synthétique : libellé + montant restant uniquement. Le
                // détail (prévu, déjà payé, source, destination…) reste dans
                // l'ActionSheet ouvert au tap.
                <TouchableOpacity key={action.plannedOperationId} style={styles.row} onPress={() => onPressAction(action)} testID={`todo-row-${action.plannedOperationId}`}>
                  <Text style={styles.rowLabel} numberOfLines={2} testID={`todo-row-${action.plannedOperationId}-label`}>
                    {action.label}
                  </Text>
                  <Text style={styles.rowAmount} testID={`todo-row-${action.plannedOperationId}-amount`}>
                    {formatDh(action.remaining)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  title: { ...typography.screenTitle },
  subtitle: { ...typography.bodySecondary, marginTop: 2 },
  periodBar: { paddingHorizontal: spacing.lg },
  synthese: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  syntheseCount: { ...typography.body, fontWeight: '700' },
  syntheseAmount: { ...typography.body, fontWeight: '700', color: colors.primaryDark },
  emptyText: { ...typography.bodySecondary, paddingVertical: spacing.lg, textAlign: 'center' },
  // Accordéon par responsable (§30-34) — même langage visuel que les accordéons Planning.
  sectionCard: { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.md, overflow: 'hidden', ...elevation.card },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  sectionIconCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  sectionTitle: { ...typography.body, fontWeight: '800', flex: 1 },
  sectionMeta: { ...typography.caption, fontWeight: '700', color: colors.textSecondary, marginRight: spacing.sm },
  sectionBody: { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  // Petit libellé de groupe (DÉPENSES / VERSEMENTS) — jamais une carte ni un bloc coloré.
  groupLabel: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.5, paddingHorizontal: spacing.xs, paddingTop: spacing.sm, paddingBottom: 2 },
  groupLabelSeparated: { marginTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  // Une échéance = une ligne : libellé à gauche (2 lignes max si très long),
  // montant en gras à droite, jamais rétréci. Pas d'alignItems 'flex-start'
  // sur le conteneur : Android donnerait une largeur nulle au libellé.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowLabel: { ...typography.body, fontWeight: '600', flexGrow: 1, flexShrink: 1, flexBasis: 'auto', marginRight: spacing.md },
  rowAmount: { ...typography.body, fontWeight: '800', flexShrink: 0 },
  doneRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: spacing.xs },
});
