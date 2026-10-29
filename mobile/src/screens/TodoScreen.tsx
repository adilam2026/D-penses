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
    // /todo n'expose pas l'opération réelle liée : sur une ligne PAYÉ,
    // l'ActionSheet n'affiche donc pas « Voir la transaction » (sa règle
    // existante quand l'identifiant est absent) mais garde « Annuler le
    // paiement », « Modifier » et « Annuler l'échéance ».
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
  // §29-33 — une carte repliable par responsable (+ Non attribué si
  // nécessaire), toutes ouvertes par défaut ; état conservé pendant la
  // navigation tant que l'écran reste monté.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
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

  // §29-33 — regroupement PAR RESPONSABLE : une carte par membre du foyer
  // (dans l'ordre du foyer, jamais un ordre arbitraire/codé en dur), une
  // carte "Non attribué" distincte — affichée UNIQUEMENT si elle contient au
  // moins une opération (§32). Chaque carte porte son À FAIRE (restes des
  // échéances PENDING) et son PAYÉ (échéances réalisées + part déjà payée
  // d'un paiement partiel, dont le solde reste dans À FAIRE : jamais compté
  // deux fois).
  const byResponsible = new Map<string, ResponsibleBucket>();
  function bucketOf(action: api.TodoActionApi): ResponsibleBucket {
    const key = action.responsibleMemberId ?? UNASSIGNED_KEY;
    let bucket = byResponsible.get(key);
    if (!bucket) {
      bucket = { pending: [], paid: [] };
      byResponsible.set(key, bucket);
    }
    return bucket;
  }
  for (const action of data.done) bucketOf(action).paid.push({ action, amount: action.realizedAmount ?? action.expectedAmount, partial: false });
  for (const action of data.pending) {
    const bucket = bucketOf(action);
    bucket.pending.push(action);
    if ((action.realizedAmount ?? 0) > 0) bucket.paid.push({ action, amount: action.realizedAmount as number, partial: true });
  }
  const sections: { key: string; title: string; bucket: ResponsibleBucket }[] = [
    ...members.filter((m) => byResponsible.has(m.id)).map((m) => ({ key: m.id, title: m.user.firstName, bucket: byResponsible.get(m.id)! })),
    ...(byResponsible.has(UNASSIGNED_KEY) ? [{ key: UNASSIGNED_KEY, title: 'Non attribué', bucket: byResponsible.get(UNASSIGNED_KEY)! }] : []),
  ];

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
        ) : null}
        {sections.map((section) => (
          <TodoSection
            key={section.key}
            sectionKey={section.key}
            title={section.title}
            pending={section.bucket.pending}
            paid={section.bucket.paid}
            isCollapsed={collapsedSections.has(section.key)}
            onToggle={() => toggleSection(section.key)}
            onPressAction={(action) => setActionTarget({ occurrence: occurrenceFromAction(action), rowLabel: action.label })}
          />
        ))}
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

interface PaidEntry {
  action: api.TodoActionApi;
  /** Montant déjà exécuté : totalité pour une échéance réalisée, part payée pour un paiement partiel. */
  amount: number;
  partial: boolean;
}

interface ResponsibleBucket {
  pending: api.TodoActionApi[];
  paid: PaidEntry[];
}

/**
 * Carte "À faire" d'un responsable (proposition 3 validée) :
 *   Prénom · payé / total du mois (total = À FAIRE + PAYÉ, ne baisse pas quand on paie)
 *   bandeau À FAIRE · reste  → DÉPENSES puis VERSEMENTS (titres seuls, sans sous-total)
 *   bandeau PAYÉ · exécuté   → ✓ réalisées, ◐ part payée d'un partiel
 * Toute ligne ouvre l'ActionSheet de Planning : menu "à payer" pour une
 * échéance PENDING (y compris la ligne ◐ d'un partiel), menu "payée" pour
 * une échéance réalisée.
 */
function TodoSection({
  sectionKey,
  title,
  pending,
  paid,
  isCollapsed,
  onToggle,
  onPressAction,
}: {
  sectionKey: string;
  title: string;
  pending: api.TodoActionApi[];
  paid: PaidEntry[];
  isCollapsed: boolean;
  onToggle: () => void;
  onPressAction: (action: api.TodoActionApi) => void;
}) {
  const totalToDo = pending.reduce((sum, a) => sum + a.remaining, 0);
  const totalPaid = paid.reduce((sum, p) => sum + p.amount, 0);
  const groups = [
    // Même identité que les blocs du Planning : DÉPENSES = danger, VERSEMENTS = secondary.
    { key: 'depenses', title: 'DÉPENSES', color: colors.danger, actions: pending.filter((a) => a.kind !== 'SAVINGS_CONTRIBUTION') },
    { key: 'versements', title: 'VERSEMENTS', color: colors.secondary, actions: pending.filter((a) => a.kind === 'SAVINGS_CONTRIBUTION') },
  ].filter((g) => g.actions.length > 0);
  return (
    <View style={styles.sectionCard} testID={`todo-section-${sectionKey}`}>
      <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} testID={`todo-section-${sectionKey}-toggle`}>
        <Text style={styles.sectionTitle} numberOfLines={1}>
          {title}
        </Text>
        {/* « payé / total du mois » : le premier montant monte au fil des paiements (part réellement payée d'un partiel comprise), le total reste stable. */}
        <Text style={styles.sectionTotal} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} testID={`todo-section-${sectionKey}-total`}>
          {`${Math.round(totalPaid).toLocaleString('fr-FR')} / ${formatDh(totalToDo + totalPaid)}`}
        </Text>
        <Ionicons name={isCollapsed ? 'chevron-forward' : 'chevron-down'} size={16} color={colors.textSecondary} />
      </TouchableOpacity>
      {!isCollapsed && (
        <>
          {pending.length > 0 && (
            <>
              <Text style={[styles.band, styles.bandToDo]} testID={`todo-section-${sectionKey}-todo-band`}>
                À FAIRE · {formatDh(totalToDo)}
              </Text>
              {/* Dépenses puis versements — un groupe vide n'est jamais affiché. */}
              {groups.map((group, idx) => (
                <View key={group.key} style={[styles.group, idx > 0 && styles.groupSeparated]} testID={`todo-section-${sectionKey}-group-${group.key}`}>
                  <Text style={[styles.groupLabel, { color: group.color }]} testID={`todo-section-${sectionKey}-group-${group.key}-label`}>
                    {group.title}
                  </Text>
                  {group.actions.map((action) => (
                    // Libellé + montant restant uniquement ; le détail (prévu,
                    // déjà payé, source, destination…) reste dans l'ActionSheet.
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
            </>
          )}
          {paid.length > 0 && (
            <>
              <Text style={[styles.band, styles.bandPaid]} testID={`todo-section-${sectionKey}-paid-band`}>
                PAYÉ · {formatDh(totalPaid)}
              </Text>
              <View style={styles.paidList}>
                {paid.map(({ action, amount, partial }) => (
                  <TouchableOpacity key={action.plannedOperationId} style={styles.row} onPress={() => onPressAction(action)} testID={`todo-paid-row-${action.plannedOperationId}`}>
                    <Ionicons
                      name={partial ? 'contrast' : 'checkmark-circle'}
                      size={15}
                      color={colors.success}
                      style={styles.paidIcon}
                      accessibilityLabel={partial ? 'Payé partiellement' : 'Payé'}
                      testID={`todo-paid-row-${action.plannedOperationId}-${partial ? 'partial' : 'full'}`}
                    />
                    <Text style={styles.rowLabel} numberOfLines={2}>
                      {action.label}
                    </Text>
                    <Text style={styles.rowAmount} testID={`todo-paid-row-${action.plannedOperationId}-amount`}>
                      {formatDh(amount)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
        </>
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
  // Carte par responsable (proposition 3) — même carte blanche que les accordéons Planning.
  sectionCard: { backgroundColor: colors.surface, borderRadius: radius.lg, marginTop: spacing.md, overflow: 'hidden', ...elevation.card },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 54, paddingVertical: spacing.md, paddingHorizontal: spacing.lg - 2, gap: spacing.sm },
  sectionTitle: { ...typography.body, fontSize: 15, fontWeight: '800', flex: 1 },
  sectionTotal: { ...typography.body, fontSize: 15, fontWeight: '700' },
  // Bandeaux À FAIRE / PAYÉ : fond à peine teinté sur toute la largeur, sans bordure ni arrondi (jamais l'air d'un bouton).
  band: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, paddingVertical: 9, paddingHorizontal: spacing.lg - 2 },
  bandToDo: { backgroundColor: colors.surfaceMuted, color: colors.textPrimary },
  bandPaid: { backgroundColor: colors.successSoft, color: colors.successDark },
  // Sous-catégorie DÉPENSES / VERSEMENTS : petit titre coloré, sans sous-total ; un filet fin sépare les deux groupes.
  group: { paddingHorizontal: spacing.lg - 2, paddingTop: spacing.md, paddingBottom: spacing.md + 2 },
  groupSeparated: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  groupLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: spacing.xs },
  paidList: { paddingHorizontal: spacing.lg - 2, paddingTop: spacing.sm, paddingBottom: spacing.md },
  paidIcon: { marginRight: spacing.sm },
  // Une opération = une ligne : libellé à gauche (2 lignes max si très long),
  // montant à droite, jamais rétréci, sans filet entre les lignes. Pas
  // d'alignItems 'flex-start' sur le conteneur : Android donnerait une
  // largeur nulle au libellé.
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  rowLabel: { ...typography.body, flexGrow: 1, flexShrink: 1, flexBasis: 'auto', marginRight: spacing.md },
  rowAmount: { ...typography.body, fontWeight: '600', flexShrink: 0 },
});
