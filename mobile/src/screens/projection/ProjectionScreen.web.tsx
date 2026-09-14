import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { MonthBucketApi, MonthlyLineItem, MonthlyProjectionApi, PlannedTransferItem, UNDETERMINED_ACCOUNT } from '../../api/client';
import { MultiSelect } from '../../ui/MultiSelect';
import { KpiTile } from '../../web/ui/KpiTile.web';
import { PageHeader } from '../../web/ui/PageHeader.web';
import { MAX_CONTENT_WIDTH, webColors, webRadius, webSpacing } from '../../web/webTheme';
import { CATEGORY_LABEL, formatDh, formatShortDate } from './projectionLogic';

interface Account {
  id: string;
  name: string;
}

const HORIZONS = [3, 6, 12, 24, 36, 60] as const;
const DEFAULT_HORIZON = 12;

/**
 * Portail Web v4 §2 (WEB-V4.3) — Projection desktop : bande KPI (mêmes
 * chiffres que le résumé mobile), horizon + filtres-compte toujours visibles
 * (jamais masqués derrière un bouton), tableau mensuel large en dessous
 * (Revenus/Dépenses/Balance/Cumul/Situation/Statut) avec lignes dépliables —
 * le détail (revenus/dépenses/transferts) est déjà entièrement chargé par
 * GET /projection/monthly (aucun appel supplémentaire au dépli).
 */
export function ProjectionScreen() {
  const navigation = useNavigation<any>();

  const [horizonMonths, setHorizonMonths] = useState<number>(DEFAULT_HORIZON);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [incomeAccountIds, setIncomeAccountIds] = useState<string[] | null>(null);
  const [expenseAccountIds, setExpenseAccountIds] = useState<string[] | null>(null);

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
      navigation.navigate('DeadlineDetail', { id: item.entityId });
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <PageHeader title="Projection" />

      {loading && !data ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : data ? (
        <>
          <View style={styles.kpiRow}>
            <KpiTile label="Revenus totaux" value={formatDh(data.summary.total_income)} variant="light" width={190} />
            <KpiTile label="Dépenses totales" value={formatDh(data.summary.total_expense)} variant="light" width={190} />
            <KpiTile
              label="Balance totale"
              value={`${data.summary.total_balance >= 0 ? '+' : ''}${formatDh(data.summary.total_balance)}`}
              variant="light"
              width={190}
            />
            <KpiTile label="Trésorerie initiale" value={formatDh(data.summary.opening_cash_balance)} variant="light" width={190} />
            <KpiTile
              label="Point bas de trésorerie"
              value={data.summary.cash_low_point ? formatDh(data.summary.cash_low_point.value) : '—'}
              sub={data.summary.cash_low_point?.month}
              variant="light"
              width={190}
            />
            <KpiTile label="Besoin de financement" value={formatDh(data.summary.max_financing_need)} variant="light" width={190} />
          </View>

          {!data.summary.is_complete && (
            <Text style={styles.warningText}>⚠ Projection incomplète — {data.summary.incomplete_months_count} mois avec montant(s) inconnu(s).</Text>
          )}
          {data.summary.worst_month && (
            <Text style={styles.summaryLine}>
              Mois le plus déficitaire : {data.summary.worst_month.month} ({formatDh(data.summary.worst_month.balance)}) · {data.summary.deficit_months_count} mois déficitaire(s)
            </Text>
          )}

          <View style={styles.filtersBar}>
            <View>
              <Text style={styles.filtersLabel}>Horizon</Text>
              <View style={styles.chipRow}>
                {HORIZONS.map((h) => (
                  <TouchableOpacity
                    key={h}
                    testID={`web-horizon-${h}`}
                    style={[styles.chip, horizonMonths === h && styles.chipActive]}
                    onPress={() => setHorizonMonths(h)}
                  >
                    <Text style={[styles.chipText, horizonMonths === h && styles.chipTextActive]}>{h} mois</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.filterField}>
              <MultiSelect
                testID="web-projection-income-accounts"
                label="Comptes revenus"
                placeholder="Tous"
                value={incomeAccountIds ?? []}
                onChange={(next) => setIncomeAccountIds(next.length === 0 ? null : next)}
                options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              />
            </View>
            <View style={styles.filterField}>
              <MultiSelect
                testID="web-projection-expense-accounts"
                label="Comptes dépenses"
                placeholder="Tous"
                value={expenseAccountIds ?? []}
                onChange={(next) => setExpenseAccountIds(next.length === 0 ? null : next)}
                options={[...accounts.map((a) => ({ value: a.id, label: a.name })), { value: UNDETERMINED_ACCOUNT, label: 'Compte non déterminé' }]}
              />
            </View>
          </View>

          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.th, styles.colMonth]}>Mois</Text>
              <Text style={[styles.th, styles.colAmount]}>Revenus</Text>
              <Text style={[styles.th, styles.colAmount]}>Dépenses</Text>
              <Text style={[styles.th, styles.colAmount]}>Balance</Text>
              <Text style={[styles.th, styles.colAmount]}>Cumul</Text>
              <Text style={[styles.th, styles.colAmount]}>Situation fin de mois</Text>
              <Text style={[styles.th, styles.colStatus]}>Statut</Text>
            </View>

            {data.months.map((m) => (
              <MonthRow
                key={m.month}
                month={m}
                expanded={!!expandedMonths[m.month]}
                onToggle={() => setExpandedMonths((prev) => ({ ...prev, [m.month]: !prev[m.month] }))}
                onOpenDetail={onOpenDetail}
              />
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function MonthRow({
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
  const situationDeficit = month.projected_cash_balance < 0;
  const hasDetail = month.income_items.length > 0 || month.expense_items.length > 0 || month.planned_transfer_items.length > 0;

  return (
    <View testID={`web-month-row-${month.month}`}>
      <TouchableOpacity testID={`web-month-toggle-${month.month}`} style={styles.tableRow} onPress={onToggle} disabled={!hasDetail}>
        <Text style={[styles.td, styles.colMonth, styles.monthLabel]}>{month.label}</Text>
        <Text style={[styles.td, styles.colAmount, styles.amountPositive]}>{formatDh(month.total_income)}</Text>
        <Text style={[styles.td, styles.colAmount, styles.amountNegative]}>{formatDh(month.total_expense)}</Text>
        <Text style={[styles.td, styles.colAmount, month.balance >= 0 ? styles.amountPositive : styles.amountNegative]}>
          {month.balance >= 0 ? '+' : ''}
          {formatDh(month.balance)}
        </Text>
        <Text style={[styles.td, styles.colAmount, month.cumulative_balance >= 0 ? styles.amountPositive : styles.amountNegative]}>
          {month.cumulative_balance >= 0 ? '+' : ''}
          {formatDh(month.cumulative_balance)}
        </Text>
        <Text style={[styles.td, styles.colAmount, styles.situationValue, situationDeficit ? styles.amountNegative : styles.amountPositive]}>
          {formatDh(month.projected_cash_balance)}
        </Text>
        <View style={styles.colStatus}>
          <Text style={[styles.statusBadge, situationDeficit ? styles.statusBadgeNegative : styles.statusBadgePositive]}>
            {situationDeficit ? 'Déficitaire' : 'Positif'}
          </Text>
        </View>
      </TouchableOpacity>

      {!month.is_complete && (
        <Text style={styles.rowWarning}>
          ⚠ Projection incomplète — {month.unknown_count} montant(s) inconnu(s) ({month.unknown_labels.join(', ')})
        </Text>
      )}
      {month.excluded_by_filter_count > 0 && (
        <Text style={styles.rowWarning}>
          ⚠ {month.excluded_by_filter_count} opération(s) exclue(s) par le filtre-compte ({formatDh(month.excluded_by_filter_total)})
        </Text>
      )}

      {expanded && hasDetail && (
        <View style={styles.detailPanel}>
          <View style={styles.detailCol}>
            <Text style={styles.detailTitle}>Revenus</Text>
            {month.income_items.length === 0 ? (
              <Text style={styles.emptyText}>Aucun revenu prévu.</Text>
            ) : (
              month.income_items.map((item) => (
                <View key={item.entityId + item.date} style={styles.detailRow}>
                  <Text style={styles.detailLabel}>
                    {item.label} {item.realized ? '· Réel' : '· Prévu'}
                  </Text>
                  <Text style={[styles.detailAmount, styles.amountPositive]}>+{formatDh(item.amount)}</Text>
                </View>
              ))
            )}
          </View>
          <View style={styles.detailCol}>
            <Text style={styles.detailTitle}>Dépenses</Text>
            {month.expense_items.length === 0 ? (
              <Text style={styles.emptyText}>Aucune dépense prévue.</Text>
            ) : (
              month.expense_items.map((item) => (
                <TouchableOpacity
                  key={item.entityId + item.date}
                  style={styles.detailRow}
                  disabled={item.entityType !== 'deadline'}
                  onPress={() => onOpenDetail(item)}
                >
                  <Text style={styles.detailLabel}>
                    {item.label} {item.realized ? '· Réel' : '· Prévu'}
                    {item.category ? ` · ${CATEGORY_LABEL[item.category]}` : ''}
                    {item.amountStatus === 'estime' ? ' · Estimée' : ''}
                  </Text>
                  <Text style={styles.detailAmount}>{formatDh(item.amount)}</Text>
                </TouchableOpacity>
              ))
            )}
          </View>
          {month.planned_transfer_items.length > 0 && (
            <View style={styles.detailCol}>
              <Text style={styles.detailTitle}>Transferts</Text>
              {month.planned_transfer_items.map((t) => (
                <TransferRow key={t.id} item={t} />
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function TransferRow({ item }: { item: PlannedTransferItem }) {
  const isOutflow = item.direction === 'sortie_pilotee';
  const otherAccount = isOutflow ? item.toAccountName : item.fromAccountName;
  const description = isOutflow ? `Vers ${otherAccount ?? 'compte hors pilotage'}` : `Depuis ${otherAccount ?? 'compte hors pilotage'}`;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>
        {item.label} · {formatShortDate(item.date)} · {description}
      </Text>
      <Text style={[styles.detailAmount, item.netAmount >= 0 && styles.amountPositive]}>
        {item.netAmount >= 0 ? '+' : ''}
        {formatDh(item.netAmount)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center' },

  kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: webSpacing.md, marginBottom: webSpacing.md },
  warningText: { fontSize: 12, color: webColors.warning, fontWeight: '700', marginBottom: webSpacing.xs },
  summaryLine: { fontSize: 12, color: webColors.textSecondary, marginBottom: webSpacing.lg },

  filtersBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: webSpacing.lg, marginBottom: webSpacing.lg },
  filtersLabel: { fontSize: 11, fontWeight: '700', color: webColors.textSecondary, textTransform: 'uppercase', marginBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: webSpacing.xs },
  chip: { backgroundColor: webColors.surface, borderRadius: webRadius.pill, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: webColors.border },
  chipActive: { backgroundColor: webColors.primary, borderColor: webColors.primary },
  chipText: { fontSize: 12, color: webColors.textPrimary },
  chipTextActive: { color: webColors.textOnPrimary, fontWeight: '700' },
  filterField: { width: 220 },

  table: { backgroundColor: webColors.surface, borderRadius: webRadius.lg, borderWidth: 1, borderColor: webColors.border, overflow: 'hidden' },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: webColors.tableHeaderBg, paddingHorizontal: webSpacing.md, paddingVertical: 8 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: webSpacing.md, paddingVertical: 10, borderTopWidth: 1, borderTopColor: webColors.tableRowBorder },
  th: { fontSize: 11, fontWeight: '700', color: webColors.textSecondary, textTransform: 'uppercase' },
  td: { fontSize: 12, color: webColors.textPrimary },
  colMonth: { width: 160 },
  monthLabel: { fontWeight: '700', textTransform: 'capitalize' },
  colAmount: { flex: 1, textAlign: 'right', paddingRight: webSpacing.sm },
  situationValue: { fontWeight: '800', fontSize: 13 },
  colStatus: { width: 110, alignItems: 'flex-end' },
  statusBadge: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', borderRadius: webRadius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  statusBadgePositive: { color: webColors.success, backgroundColor: webColors.successLight },
  statusBadgeNegative: { color: webColors.danger, backgroundColor: webColors.dangerLight },
  amountPositive: { color: webColors.success },
  amountNegative: { color: webColors.danger },
  rowWarning: { fontSize: 11, color: webColors.warning, fontWeight: '600', paddingHorizontal: webSpacing.md, paddingBottom: 6 },

  detailPanel: { flexDirection: 'row', gap: webSpacing.xl, padding: webSpacing.md, backgroundColor: webColors.surfaceMuted, borderTopWidth: 1, borderTopColor: webColors.tableRowBorder },
  detailCol: { flex: 1, minWidth: 0 },
  detailTitle: { fontSize: 11, fontWeight: '700', color: webColors.textSecondary, textTransform: 'uppercase', marginBottom: 6 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  detailLabel: { fontSize: 12, color: webColors.textPrimary, flex: 1, paddingRight: webSpacing.sm },
  detailAmount: { fontSize: 12, fontWeight: '700', color: webColors.danger },
  emptyText: { fontSize: 12, color: webColors.textSecondary, fontStyle: 'italic' },
});
