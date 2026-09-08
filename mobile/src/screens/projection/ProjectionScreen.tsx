import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { MonthBucketApi, MonthlyLineItem, MonthlyProjectionApi, UNDETERMINED_ACCOUNT } from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { colors, elevation, radius, spacing } from '../../ui/theme';
import { MultiSelect } from '../../ui/MultiSelect';

interface Account {
  id: string;
  name: string;
}

const HORIZONS = [3, 6, 12, 24, 36, 60] as const;
const DEFAULT_HORIZON = 12;

const CATEGORY_LABEL: Record<NonNullable<MonthlyLineItem['category']>, string> = {
  obligatoire: 'Obligatoire',
  flexible: 'Flexible',
  projet: 'Projet',
};

function formatDh(n: number): string {
  return `${n.toLocaleString('fr-FR')} DH`;
}

function monthLabel(m: MonthBucketApi): string {
  return m.label;
}

/**
 * Ligne de dépense dépliée (§8/§9/§10/§11) — composant au niveau module (jamais
 * une closure : même règle que partout ailleurs depuis le correctif du bug de
 * remount/focus, Vague 1).
 */
function ExpenseRow({ item, onOpenDetail }: { item: MonthlyLineItem; onOpenDetail: (item: MonthlyLineItem) => void }) {
  return (
    <View style={styles.itemRow}>
      <TouchableOpacity style={{ flex: 1 }} onPress={() => onOpenDetail(item)} disabled={item.entityType !== 'deadline'}>
        <Text style={styles.itemLabel}>{item.label}</Text>
        <View style={styles.itemBadgeRow}>
          <Text style={item.realized ? styles.itemBadgeRealized : styles.itemBadgePrevu}>{item.realized ? 'Réel' : 'Prévu'}</Text>
          {item.category && <Text style={styles.itemBadge}>{CATEGORY_LABEL[item.category]}</Text>}
          {item.amountStatus === 'estime' && <Text style={styles.itemBadgeWarning}>Estimée</Text>}
        </View>
      </TouchableOpacity>
      <Text style={styles.itemAmount}>{formatDh(item.amount)}</Text>
    </View>
  );
}

function IncomeRow({ item }: { item: MonthlyLineItem }) {
  return (
    <View style={styles.itemRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.itemLabel}>{item.label}</Text>
        <View style={styles.itemBadgeRow}>
          <Text style={item.realized ? styles.itemBadgeRealized : styles.itemBadgePrevu}>{item.realized ? 'Réel' : 'Prévu'}</Text>
        </View>
      </View>
      <Text style={[styles.itemAmount, styles.itemAmountPositive]}>+{formatDh(item.amount)}</Text>
    </View>
  );
}

/**
 * Carte mensuelle compacte, dépliable (§5/§8) — jamais un tableau desktop compressé.
 * R6.1 §14 : la « situation projetée fin de mois » (trésorerie initiale réelle +
 * cumul des flux) est désormais l'indicateur PRINCIPAL de chaque mois — la balance
 * du mois seule (revenus − dépenses de ce mois) ne dit rien de la trésorerie
 * réelle et ne doit donc plus porter la couleur/le poids visuel principal.
 */
function MonthCard({
  month,
  expanded,
  onToggle,
  onOpenDetail,
}: {
  month: MonthBucketApi;
  expanded: boolean;
  onToggle: () => void;
  onOpenDetail: (item: MonthlyLineItem) => void;
}) {
  const deficit = month.balance < 0;
  const situationDeficit = month.projected_cash_balance < 0;

  return (
    <View style={styles.monthCard} testID={`month-card-${month.month}`}>
      <TouchableOpacity style={styles.monthHeader} onPress={onToggle} testID={`month-toggle-${month.month}`}>
        <View style={{ flex: 1 }}>
          <Text style={styles.monthTitle}>{monthLabel(month)}</Text>
          <Text style={styles.monthMeta}>
            Revenus {formatDh(month.total_income)} · Dépenses {formatDh(month.total_expense)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.situationLabel}>SITUATION PROJETÉE FIN DE MOIS</Text>
          <Text style={[styles.monthBalance, situationDeficit ? styles.balanceNegative : styles.balancePositive]}>
            {formatDh(month.projected_cash_balance)}
          </Text>
          <Text style={[styles.monthStatus, situationDeficit ? styles.balanceNegative : styles.balancePositive]}>
            {situationDeficit ? 'Déficitaire' : 'Positif'}
          </Text>
          <Text style={styles.cumulLine}>
            Balance du mois {month.balance >= 0 ? '+' : ''}{formatDh(month.balance)}
          </Text>
          <Text style={styles.cumulLine}>
            Cumul des flux {month.cumulative_balance >= 0 ? '+' : ''}{formatDh(month.cumulative_balance)}
          </Text>
        </View>
      </TouchableOpacity>

      {!month.is_complete && (
        <Text style={styles.warningText}>
          ⚠ Projection incomplète — {month.unknown_count} montant(s) encore inconnu(s) ({month.unknown_labels.join(', ')})
        </Text>
      )}
      {month.excluded_by_filter_count > 0 && (
        <Text style={styles.warningText}>
          ⚠ {month.excluded_by_filter_count} opération(s) exclue(s) par le filtre-compte ({formatDh(month.excluded_by_filter_total)}) — non
          perdues, seulement masquées.
        </Text>
      )}

      {expanded && (
        <View style={styles.monthDetail}>
          {deficit && (
            <View style={styles.deficitBox}>
              <Text style={styles.deficitTitle}>Pourquoi ce déficit ?</Text>
              <Text style={styles.deficitText}>Dépenses potentiellement décalables : {formatDh(month.movable_expense_total)}</Text>
            </View>
          )}

          <Text style={styles.detailSectionTitle}>Revenus</Text>
          {month.income_items.length === 0 ? (
            <Text style={styles.emptyText}>Aucun revenu prévu ce mois-ci.</Text>
          ) : (
            month.income_items.map((item) => <IncomeRow key={item.entityId + item.date} item={item} />)
          )}
          <Text style={styles.detailTotalLine}>Total revenus {formatDh(month.total_income)}</Text>

          <Text style={styles.detailSectionTitle}>Dépenses</Text>
          {month.expense_items.length === 0 ? (
            <Text style={styles.emptyText}>Aucune dépense prévue ce mois-ci.</Text>
          ) : (
            month.expense_items.map((item) => <ExpenseRow key={item.entityId + item.date} item={item} onOpenDetail={onOpenDetail} />)
          )}
          <Text style={styles.detailTotalLine}>Total dépenses {formatDh(month.total_expense)}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Projection Globale Mensuelle (Round 4, refonte R6.1 §14) — moteur backend
 * unique (monthly-projection.util.ts), jamais un second calcul mobile. Vue
 * mensuelle consolidée : revenus/dépenses/balance/cumul, filtre-compte, détail
 * dépliable. Le mode simulation (déplacement de dépenses) a été retiré : il
 * n'était jamais accessible qu'après un clic supplémentaire sur une dépense
 * précise et créait une confusion (bouton « Tester un scénario » visible sans
 * effet tant qu'aucune dépense n'était choisie) — la seule action encore
 * possible sur une échéance est sa consultation via DeadlineDetail.
 */
export function ProjectionScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef } = useKeyboardAwareScroll();

  const [horizonMonths, setHorizonMonths] = useState<number>(DEFAULT_HORIZON);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [incomeAccountIds, setIncomeAccountIds] = useState<string[] | null>(null); // null = "Tous"
  const [expenseAccountIds, setExpenseAccountIds] = useState<string[] | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [notionsInfoOpen, setNotionsInfoOpen] = useState(false);

  const [data, setData] = useState<MonthlyProjectionApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accs, body] = await Promise.all([
        api.listAccounts(),
        api.getMonthlyProjection({ horizonMonths, incomeAccountIds, expenseAccountIds }),
      ]);
      setAccounts(accs);
      setData(body);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizonMonths, incomeAccountIds, expenseAccountIds]);

  // Recharge à chaque changement d'horizon/filtre-compte (§3/§4) — useFocusEffect
  // seul ne suffit pas : il ne se redéclenche qu'au regain de focus, pas quand une
  // dépendance change alors que l'écran est déjà affiché (même limite que l'ancien
  // ProjectionScreen, corrigée ici par le même double câblage useEffect+useFocusEffect).
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  function onOpenDetail(item: MonthlyLineItem) {
    if (item.entityType === 'deadline') {
      navigation.getParent()?.navigate('DeadlineDetail', { id: item.entityId });
    }
  }

  if (loading || !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Projection</Text>

      <Text style={styles.sectionLabel}>Horizon</Text>
      <View style={styles.chipRow}>
        {HORIZONS.map((h) => (
          <TouchableOpacity
            key={h}
            testID={`horizon-${h}`}
            style={[styles.chip, horizonMonths === h && styles.chipActive]}
            onPress={() => setHorizonMonths(h)}
          >
            <Text style={[styles.chipText, horizonMonths === h && styles.chipTextActive]}>{h} mois</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity onPress={() => setShowFilters((v) => !v)} testID="toggle-filters">
        <Text style={styles.filterToggle}>{showFilters ? 'Masquer les filtres de compte' : 'Filtrer par compte'}</Text>
      </TouchableOpacity>
      {showFilters && (
        <View style={styles.filterBox}>
          {/* R6 finition UX/UI §2 — filtres compte potentiellement nombreux : sélecteur
              multi-select compact plutôt qu'un mur de chips (aucune sélection = Tous). */}
          <MultiSelect
            testID="projection-income-accounts-select"
            label="Comptes revenus"
            placeholder="Tous"
            value={incomeAccountIds ?? []}
            onChange={(next) => setIncomeAccountIds(next.length === 0 ? null : next)}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
          <MultiSelect
            testID="projection-expense-accounts-select"
            label="Comptes dépenses"
            placeholder="Tous"
            value={expenseAccountIds ?? []}
            onChange={(next) => setExpenseAccountIds(next.length === 0 ? null : next)}
            options={[...accounts.map((a) => ({ value: a.id, label: a.name })), { value: UNDETERMINED_ACCOUNT, label: 'Compte non déterminé' }]}
          />
        </View>
      )}

      <View style={styles.summaryCard} testID="summary-card">
        {!data.summary.is_complete && (
          <Text style={styles.warningText}>⚠ Projection incomplète — {data.summary.incomplete_months_count} mois avec montant(s) inconnu(s).</Text>
        )}
        <TouchableOpacity testID="projection-info-toggle" style={styles.infoToggleRow} onPress={() => setNotionsInfoOpen((v) => !v)}>
          <Text style={styles.infoToggleText}>ⓘ Balance / cumul / situation projetée : quelle différence ?</Text>
        </TouchableOpacity>
        {notionsInfoOpen && (
          <View style={styles.notionsInfoBox} testID="projection-info-panel">
            <Text style={styles.notionsInfoLine}>• Balance du mois : revenus − dépenses de CE mois uniquement.</Text>
            <Text style={styles.notionsInfoLine}>• Cumul des flux : somme des balances mensuelles depuis le premier mois affiché (flux purs, part de zéro).</Text>
            <Text style={styles.notionsInfoLine}>
              • Situation projetée fin de mois : trésorerie initiale réelle + cumul des flux — c'est l'indicateur principal de chaque mois, jamais
              confondu avec le cumul des flux seul.
            </Text>
          </View>
        )}
        <View style={styles.summaryRow}>
          <SummaryFigure label="Revenus totaux" value={data.summary.total_income} />
          <SummaryFigure label="Dépenses totales" value={data.summary.total_expense} />
        </View>
        <View style={styles.summaryRow}>
          <SummaryFigure label="Balance totale" value={data.summary.total_balance} signed />
          <SummaryFigure label="Mois déficitaires" value={data.summary.deficit_months_count} isCount />
        </View>
        {data.summary.worst_month && (
          <Text style={styles.summaryLine}>
            Mois le plus déficitaire : {data.summary.worst_month.month} ({formatDh(data.summary.worst_month.balance)})
          </Text>
        )}

        {/* Round 4bis §6-§9 : "Balance cumulée" (flux purs) N'EST PAS "Trésorerie" (compte
            tenu du disponible réel initial) — deux notions toujours affichées séparément,
            jamais confondues sous un même libellé. */}
        <Text style={styles.summaryLine}>Trésorerie initiale (comptes inclus) : {formatDh(data.summary.opening_cash_balance)}</Text>
        {data.summary.cash_low_point && (
          <Text style={styles.summaryLine}>
            Point bas de trésorerie : {data.summary.cash_low_point.month} ({formatDh(data.summary.cash_low_point.value)})
          </Text>
        )}
        <Text style={styles.summaryLine}>Besoin temporaire de financement : {formatDh(data.summary.max_financing_need)}</Text>
        {data.summary.first_positive_cash_balance_month && (
          <Text style={styles.summaryLine}>Retour à une trésorerie positive : {data.summary.first_positive_cash_balance_month}</Text>
        )}
      </View>

      {data.months.map((m) => (
        <MonthCard
          key={m.month}
          month={m}
          expanded={!!expandedMonths[m.month]}
          onToggle={() => setExpandedMonths((prev) => ({ ...prev, [m.month]: !prev[m.month] }))}
          onOpenDetail={onOpenDetail}
        />
      ))}
    </ScrollView>
  );
}

function SummaryFigure({ label, value, signed, isCount }: { label: string; value: number; signed?: boolean; isCount?: boolean }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={[styles.figureValue, signed && value < 0 && styles.balanceNegative]}>
        {isCount ? value : `${signed && value >= 0 ? '+' : ''}${formatDh(value)}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  scroll: { padding: spacing.xl, paddingTop: spacing.lg },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.lg },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.textPrimary },
  chipTextActive: { color: colors.textOnPrimary, fontWeight: '600' },
  filterToggle: { color: colors.textPrimary, fontWeight: '600', fontSize: 13, marginBottom: spacing.md },
  filterBox: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, marginBottom: spacing.lg },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.raised,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  figure: { flex: 1 },
  figureLabel: { fontSize: 11, color: colors.textSecondary },
  figureValue: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, marginTop: 4 },
  summaryLine: { fontSize: 12, color: colors.textPrimary, marginTop: 4 },
  infoToggleRow: { marginBottom: 6 },
  infoToggleText: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  notionsInfoBox: { backgroundColor: colors.background, borderRadius: radius.md, padding: 10, marginBottom: 10 },
  notionsInfoLine: { fontSize: 11, color: colors.textPrimary, marginBottom: 4 },
  warningText: { fontSize: 12, color: colors.warning, fontWeight: '600', marginBottom: spacing.sm },
  monthCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  monthTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  monthMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
  situationLabel: { fontSize: 9, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.4 },
  monthBalance: { fontSize: 20, fontWeight: '800', marginTop: 2 },
  monthStatus: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginTop: 2 },
  cumulLine: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },
  balancePositive: { color: colors.success },
  balanceNegative: { color: colors.danger },
  monthDetail: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  deficitBox: { backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: 10, marginBottom: 10 },
  deficitTitle: { fontSize: 12, fontWeight: '700', color: colors.danger },
  deficitText: { fontSize: 12, color: colors.danger, marginTop: 4 },
  detailSectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.sm, marginBottom: 4 },
  detailTotalLine: { fontSize: 11, color: colors.textSecondary, fontWeight: '600', marginTop: 4, textAlign: 'right' },
  emptyText: { fontSize: 12, color: colors.textSecondary, fontStyle: 'italic' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  itemLabel: { fontSize: 13, color: colors.textPrimary },
  itemBadgeRow: { flexDirection: 'row', marginTop: 2 },
  itemBadge: { fontSize: 10, color: colors.textSecondary, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2, marginRight: 4 },
  itemBadgeWarning: { fontSize: 10, color: colors.amberAccentText, backgroundColor: colors.warningLight, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2 },
  itemBadgeRealized: { fontSize: 10, color: colors.success, backgroundColor: colors.successLight, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2, marginRight: 4, fontWeight: '700' },
  itemBadgePrevu: { fontSize: 10, color: colors.textSecondary, backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 2, marginRight: 4 },
  itemAmount: { fontSize: 13, fontWeight: '700', color: colors.danger },
  itemAmountPositive: { color: colors.success },
});
