import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { MonthBucketApi, MonthlyLineItem, MonthlyProjectionApi, UNDETERMINED_ACCOUNT } from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { DateField } from '../../ui/DateField';

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
function ExpenseRow({
  item,
  onOpenDetail,
  onMove,
}: {
  item: MonthlyLineItem;
  onOpenDetail: (item: MonthlyLineItem) => void;
  onMove: (item: MonthlyLineItem) => void;
}) {
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
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.itemAmount}>{formatDh(item.amount)}</Text>
        {item.entityType === 'deadline' && !item.realized && (
          <TouchableOpacity testID={`move-${item.entityId}`} onPress={() => onMove(item)}>
            <Text style={styles.moveLink}>{item.movable ? 'Déplacer' : 'Simuler un décalage'}</Text>
          </TouchableOpacity>
        )}
      </View>
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

/** Carte mensuelle compacte, dépliable (§5/§8) — jamais un tableau desktop compressé. */
function MonthCard({
  month,
  scenarioMonth,
  expanded,
  onToggle,
  onOpenDetail,
  onMove,
}: {
  month: MonthBucketApi;
  scenarioMonth?: MonthBucketApi;
  expanded: boolean;
  onToggle: () => void;
  onOpenDetail: (item: MonthlyLineItem) => void;
  onMove: (item: MonthlyLineItem) => void;
}) {
  const deficit = month.balance < 0;
  const displayed = scenarioMonth ?? month;
  const impact = scenarioMonth ? Math.round((scenarioMonth.balance - month.balance) * 100) / 100 : 0;

  return (
    <View style={styles.monthCard} testID={`month-card-${month.month}`}>
      <TouchableOpacity style={styles.monthHeader} onPress={onToggle} testID={`month-toggle-${month.month}`}>
        <View style={{ flex: 1 }}>
          <Text style={styles.monthTitle}>{monthLabel(month)}</Text>
          <Text style={styles.monthMeta}>
            Revenus {formatDh(displayed.total_income)} · Dépenses {formatDh(displayed.total_expense)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.monthBalance, displayed.balance < 0 ? styles.balanceNegative : styles.balancePositive]}>
            {displayed.balance >= 0 ? '+' : ''}
            {formatDh(displayed.balance)}
          </Text>
          <Text style={[styles.monthStatus, displayed.balance < 0 ? styles.balanceNegative : styles.balancePositive]}>
            {displayed.balance < 0 ? 'Déficitaire' : 'Positif'}
          </Text>
          <Text style={styles.cumulLine}>
            Balance cumulée {displayed.cumulative_balance >= 0 ? '+' : ''}{formatDh(displayed.cumulative_balance)}
          </Text>
          <Text style={[styles.treasuryLine, displayed.projected_cash_balance < 0 && styles.balanceNegative]}>
            Trésorerie projetée {formatDh(displayed.projected_cash_balance)}
          </Text>
        </View>
      </TouchableOpacity>

      {scenarioMonth && (
        <View style={styles.impactRow}>
          <Text style={styles.impactLabel}>
            Avant {month.balance >= 0 ? '+' : ''}{formatDh(month.balance)} · Scénario {scenarioMonth.balance >= 0 ? '+' : ''}{formatDh(scenarioMonth.balance)}
          </Text>
          <Text style={[styles.impactValue, impact < 0 ? styles.balanceNegative : styles.balancePositive]}>
            Impact {impact >= 0 ? '+' : ''}{formatDh(impact)}
          </Text>
        </View>
      )}

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
          <Text style={styles.detailTotalLine}>Total revenus {formatDh(displayed.total_income)}</Text>

          <Text style={styles.detailSectionTitle}>Dépenses</Text>
          {month.expense_items.length === 0 ? (
            <Text style={styles.emptyText}>Aucune dépense prévue ce mois-ci.</Text>
          ) : (
            month.expense_items.map((item) => <ExpenseRow key={item.entityId + item.date} item={item} onOpenDetail={onOpenDetail} onMove={onMove} />)
          )}
          <Text style={styles.detailTotalLine}>Total dépenses {formatDh(displayed.total_expense)}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Projection Globale Mensuelle (Round 4) — moteur backend unique
 * (monthly-projection.util.ts), jamais un second calcul mobile. Vue mensuelle
 * consolidée : revenus/dépenses/balance/cumul, filtre-compte, détail dépliable,
 * mode simulation (déplacement de dépenses flexibles ou décalage simulé d'une
 * échéance contractuelle) avec comparaison avant/après — aucune donnée réelle
 * modifiée tant que « Appliquer les modifications » n'est pas explicitement
 * confirmé, et uniquement pour les dépenses réellement modifiables (§11/§12).
 */
export function ProjectionScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();

  const [horizonMonths, setHorizonMonths] = useState<number>(DEFAULT_HORIZON);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [incomeAccountIds, setIncomeAccountIds] = useState<string[] | null>(null); // null = "Tous"
  const [expenseAccountIds, setExpenseAccountIds] = useState<string[] | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [notionsInfoOpen, setNotionsInfoOpen] = useState(false);

  const [data, setData] = useState<MonthlyProjectionApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({});

  // Mode simulation (§12/§13) : `moves` reste purement local tant que
  // "Appliquer les modifications" n'est pas confirmé — jamais un déplacement réel.
  const [moves, setMoves] = useState<{ deadlineId: string; label: string; newDate: string; movable: boolean }[]>([]);
  const [scenarioData, setScenarioData] = useState<MonthlyProjectionApi | null>(null);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const [movingItem, setMovingItem] = useState<MonthlyLineItem | null>(null);
  const [moveDate, setMoveDate] = useState('');

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

  const recomputeScenario = useCallback(
    async (nextMoves: typeof moves) => {
      if (nextMoves.length === 0) {
        setScenarioData(null);
        return;
      }
      setScenarioLoading(true);
      try {
        const res = await api.simulateMonthlyProjection({
          horizonMonths,
          incomeAccountIds,
          expenseAccountIds,
          moves: nextMoves.map((m) => ({ deadlineId: m.deadlineId, newDate: m.newDate })),
        });
        setData(res.baseline);
        setScenarioData(res.scenario);
      } finally {
        setScenarioLoading(false);
      }
    },
    [horizonMonths, incomeAccountIds, expenseAccountIds],
  );

  function toggleAccount(kind: 'income' | 'expense', accountId: string) {
    const [current, setter] = kind === 'income' ? [incomeAccountIds, setIncomeAccountIds] : [expenseAccountIds, setExpenseAccountIds];
    const base = current ?? [];
    const next = base.includes(accountId) ? base.filter((a) => a !== accountId) : [...base, accountId];
    setter(next);
  }

  function resetScenario() {
    setMoves([]);
    setScenarioData(null);
    load();
  }

  function onOpenMoveDialog(item: MonthlyLineItem) {
    setMovingItem(item);
    setMoveDate(item.date);
  }

  async function onConfirmMove() {
    if (!movingItem || !moveDate) return;
    const nextMoves = [
      ...moves.filter((m) => m.deadlineId !== movingItem.entityId),
      { deadlineId: movingItem.entityId, label: movingItem.label, newDate: moveDate, movable: movingItem.movable },
    ];
    setMoves(nextMoves);
    setMovingItem(null);
    await recomputeScenario(nextMoves);
  }

  async function onApplyMoves() {
    const applicable = moves.filter((m) => m.movable);
    if (applicable.length === 0) {
      Alert.alert('Aucune modification applicable', 'Les échéances contractuelles restent en simulation — seule leur date affichée ici, jamais la vraie date.');
      return;
    }
    Alert.alert(
      'Confirmer le déplacement',
      `Déplacer réellement ${applicable.length} dépense(s) flexible(s) à la nouvelle date choisie ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Appliquer',
          onPress: async () => {
            setApplying(true);
            try {
              for (const m of applicable) {
                await api.updateDeadline(m.deadlineId, { dueDate: m.newDate });
              }
              setMoves((prev) => prev.filter((m) => !m.movable));
              setScenarioData(null);
              await load();
            } finally {
              setApplying(false);
            }
          },
        },
      ],
    );
  }

  function onOpenDetail(item: MonthlyLineItem) {
    if (item.entityType === 'deadline') {
      navigation.getParent()?.navigate('DeadlineDetail', { id: item.entityId });
    }
  }

  const scenarioMonthByKey: Record<string, MonthBucketApi> = {};
  if (scenarioData) for (const m of scenarioData.months) scenarioMonthByKey[m.month] = m;

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
          <Text style={styles.sectionLabel}>Comptes revenus</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity style={[styles.chip, incomeAccountIds === null && styles.chipActive]} onPress={() => setIncomeAccountIds(null)}>
              <Text style={[styles.chipText, incomeAccountIds === null && styles.chipTextActive]}>Tous</Text>
            </TouchableOpacity>
            {accounts.map((a) => (
              <TouchableOpacity
                key={a.id}
                testID={`income-account-${a.id}`}
                style={[styles.chip, incomeAccountIds?.includes(a.id) && styles.chipActive]}
                onPress={() => toggleAccount('income', a.id)}
              >
                <Text style={[styles.chipText, incomeAccountIds?.includes(a.id) && styles.chipTextActive]}>{a.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Comptes dépenses</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity style={[styles.chip, expenseAccountIds === null && styles.chipActive]} onPress={() => setExpenseAccountIds(null)}>
              <Text style={[styles.chipText, expenseAccountIds === null && styles.chipTextActive]}>Tous</Text>
            </TouchableOpacity>
            {accounts.map((a) => (
              <TouchableOpacity
                key={a.id}
                testID={`expense-account-${a.id}`}
                style={[styles.chip, expenseAccountIds?.includes(a.id) && styles.chipActive]}
                onPress={() => toggleAccount('expense', a.id)}
              >
                <Text style={[styles.chipText, expenseAccountIds?.includes(a.id) && styles.chipTextActive]}>{a.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              testID="expense-account-undetermined"
              style={[styles.chip, expenseAccountIds?.includes(UNDETERMINED_ACCOUNT) && styles.chipActive]}
              onPress={() => toggleAccount('expense', UNDETERMINED_ACCOUNT)}
            >
              <Text style={[styles.chipText, expenseAccountIds?.includes(UNDETERMINED_ACCOUNT) && styles.chipTextActive]}>Compte non déterminé</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.summaryCard} testID="summary-card">
        {!data.summary.is_complete && (
          <Text style={styles.warningText}>⚠ Projection incomplète — {data.summary.incomplete_months_count} mois avec montant(s) inconnu(s).</Text>
        )}
        <TouchableOpacity testID="projection-info-toggle" style={styles.infoToggleRow} onPress={() => setNotionsInfoOpen((v) => !v)}>
          <Text style={styles.infoToggleText}>ⓘ Balance / cumul / trésorerie : quelle différence ?</Text>
        </TouchableOpacity>
        {notionsInfoOpen && (
          <View style={styles.notionsInfoBox} testID="projection-info-panel">
            <Text style={styles.notionsInfoLine}>• Balance du mois : revenus − dépenses de CE mois uniquement.</Text>
            <Text style={styles.notionsInfoLine}>• Balance cumulée : somme des balances mensuelles depuis le premier mois affiché (flux purs, part de zéro).</Text>
            <Text style={styles.notionsInfoLine}>• Trésorerie projetée : trésorerie initiale réelle + balance cumulée — jamais confondue avec la balance cumulée seule.</Text>
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

      <View style={styles.scenarioBar}>
        {moves.length === 0 ? (
          <TouchableOpacity testID="start-scenario" style={styles.scenarioButton} onPress={() => Alert.alert('Tester un scénario', "Ouvrez « Déplacer » ou « Simuler un décalage » sur une dépense pour démarrer un scénario.")}>
            <Text style={styles.scenarioButtonText}>Tester un scénario</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.scenarioActiveBox}>
            <Text style={styles.scenarioActiveTitle}>SCÉNARIO EN COURS ({moves.length} déplacement(s) simulé(s))</Text>
            {scenarioLoading && <ActivityIndicator size="small" />}
            <View style={styles.scenarioButtonsRow}>
              <TouchableOpacity testID="reset-scenario" style={styles.scenarioSecondaryButton} onPress={resetScenario}>
                <Text style={styles.scenarioSecondaryButtonText}>Réinitialiser le scénario</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="apply-scenario" style={styles.scenarioButton} onPress={onApplyMoves} disabled={applying}>
                {applying ? <ActivityIndicator color="#fff" /> : <Text style={styles.scenarioButtonText}>Appliquer les modifications</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {data.months.map((m) => (
        <MonthCard
          key={m.month}
          month={m}
          scenarioMonth={scenarioMonthByKey[m.month]}
          expanded={!!expandedMonths[m.month]}
          onToggle={() => setExpandedMonths((prev) => ({ ...prev, [m.month]: !prev[m.month] }))}
          onOpenDetail={onOpenDetail}
          onMove={onOpenMoveDialog}
        />
      ))}

      {movingItem && (
        <View style={styles.moveModal} testID="move-dialog">
          <Text style={styles.moveModalTitle}>
            {movingItem.movable ? 'Déplacer' : 'Simuler un décalage'} — {movingItem.label}
          </Text>
          <Text style={styles.moveModalSubtitle}>{formatDh(movingItem.amount)} · prévu le {movingItem.date}</Text>
          {!movingItem.movable && (
            <Text style={styles.warningText}>
              Échéance obligatoire/contractuelle : la simulation ne change jamais la vraie date. Utilisez « Appliquer » uniquement pour les dépenses flexibles.
            </Text>
          )}
          <DateField label="Nouvelle date prévue" value={moveDate} onChange={setMoveDate} />
          <View style={styles.scenarioButtonsRow}>
            <TouchableOpacity style={styles.scenarioSecondaryButton} onPress={() => setMovingItem(null)}>
              <Text style={styles.scenarioSecondaryButtonText}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="confirm-move" style={styles.scenarioButton} onPress={onConfirmMove}>
              <Text style={styles.scenarioButtonText}>Confirmer</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
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
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5F2' },
  scroll: { padding: 20, paddingTop: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#172436', marginBottom: 16 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#172436', marginBottom: 8, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  chip: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  chipActive: { backgroundColor: '#172436', borderColor: '#172436' },
  chipText: { fontSize: 13, color: '#172436' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  filterToggle: { color: '#172436', fontWeight: '600', fontSize: 13, marginBottom: 12 },
  filterBox: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 16 },
  summaryCard: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  figure: { flex: 1 },
  figureLabel: { fontSize: 11, color: '#6B747C' },
  figureValue: { fontSize: 18, fontWeight: '800', color: '#172436', marginTop: 4 },
  summaryLine: { fontSize: 12, color: '#172436', marginTop: 4 },
  infoToggleRow: { marginBottom: 6 },
  infoToggleText: { fontSize: 11, color: '#6B747C', fontWeight: '600' },
  notionsInfoBox: { backgroundColor: '#F6F5F2', borderRadius: 10, padding: 10, marginBottom: 10 },
  notionsInfoLine: { fontSize: 11, color: '#172436', marginBottom: 4 },
  warningText: { fontSize: 12, color: '#B8860B', fontWeight: '600', marginBottom: 8 },
  scenarioBar: { marginBottom: 16 },
  scenarioButton: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', flex: 1 },
  scenarioButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  scenarioSecondaryButton: { backgroundColor: '#EEF0F3', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', flex: 1, marginRight: 8 },
  scenarioSecondaryButtonText: { color: '#172436', fontWeight: '600', fontSize: 14 },
  scenarioButtonsRow: { flexDirection: 'row', marginTop: 10 },
  scenarioActiveBox: { backgroundColor: '#FFF7E6', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E6C87A' },
  scenarioActiveTitle: { fontSize: 12, fontWeight: '800', color: '#8A6D1D' },
  monthCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10 },
  monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  monthTitle: { fontSize: 15, fontWeight: '700', color: '#172436' },
  monthMeta: { fontSize: 11, color: '#6B747C', marginTop: 4 },
  monthBalance: { fontSize: 16, fontWeight: '800' },
  monthStatus: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginTop: 2 },
  cumulLine: { fontSize: 10, color: '#6B747C', marginTop: 2 },
  treasuryLine: { fontSize: 10, color: '#172436', fontWeight: '600', marginTop: 2 },
  balancePositive: { color: '#2E7D5B' },
  balanceNegative: { color: '#B3261E' },
  impactRow: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EDEBE6' },
  impactLabel: { fontSize: 11, color: '#6B747C' },
  impactValue: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  monthDetail: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#EDEBE6' },
  deficitBox: { backgroundColor: '#FBEDEC', borderRadius: 10, padding: 10, marginBottom: 10 },
  deficitTitle: { fontSize: 12, fontWeight: '700', color: '#B3261E' },
  deficitText: { fontSize: 12, color: '#B3261E', marginTop: 4 },
  detailSectionTitle: { fontSize: 12, fontWeight: '700', color: '#172436', marginTop: 8, marginBottom: 4 },
  detailTotalLine: { fontSize: 11, color: '#6B747C', fontWeight: '600', marginTop: 4, textAlign: 'right' },
  emptyText: { fontSize: 12, color: '#6B747C', fontStyle: 'italic' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  itemLabel: { fontSize: 13, color: '#172436' },
  itemBadgeRow: { flexDirection: 'row', marginTop: 2 },
  itemBadge: { fontSize: 10, color: '#6B747C', backgroundColor: '#EDEBE6', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, marginRight: 4 },
  itemBadgeWarning: { fontSize: 10, color: '#8A6D1D', backgroundColor: '#FFF7E6', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  itemBadgeRealized: { fontSize: 10, color: '#2E7D5B', backgroundColor: '#E6F4EC', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, marginRight: 4, fontWeight: '700' },
  itemBadgePrevu: { fontSize: 10, color: '#6B747C', backgroundColor: '#EDEBE6', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2, marginRight: 4 },
  itemAmount: { fontSize: 13, fontWeight: '700', color: '#B3261E' },
  itemAmountPositive: { color: '#2E7D5B' },
  moveLink: { fontSize: 11, color: '#172436', fontWeight: '600', marginTop: 4 },
  moveModal: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginTop: 8, borderWidth: 1, borderColor: '#E3E1DC' },
  moveModalTitle: { fontSize: 14, fontWeight: '700', color: '#172436', marginBottom: 4 },
  moveModalSubtitle: { fontSize: 12, color: '#6B747C', marginBottom: 10 },
});
