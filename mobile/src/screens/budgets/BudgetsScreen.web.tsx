import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { DateField } from '../../ui/DateField';
import { Donut } from '../../ui/Donut';
import { FormField } from '../../ui/FormField';
import { Select } from '../../ui/Select';
import { PageHeader } from '../../web/ui/PageHeader.web';
import { TwoColumnLayout } from '../../web/ui/TwoColumnLayout.web';
import { MAX_CONTENT_WIDTH, webColors, webRadius, webSpacing } from '../../web/webTheme';
import { KIND_LABEL, LedgerEntry, formatDate } from '../transactions/transactionsLogic';
import { Budget, HEALTH_COLOR, HEALTH_LABEL } from './budgetsLogic';

interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
}

const MONTH_MODE_LABELS: Record<api.MonthMode, string> = {
  calendaire: 'Calendaire',
  financier: 'Financier',
  personnalise: 'Personnalisé',
};

const EXPENSES_LIMIT = 5;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Portail Web v4 §1/§3/§5 (WEB-V4.2 révisé) — Budgets desktop : blocs riches
 * (donut + figures + 5 dernières dépenses rattachées, GET /transactions?
 * budgetId=...&limit=5, déjà disponible) en colonne principale, panneau
 * "Nouveau budget" FIXE (sticky) reprenant exactement les champs/validations/
 * endpoint de CreateBudgetScreen (mobile) — aucun champ inventé.
 *
 * Garde-fou §1 — même principe que Comptes : liste d'abord, dépenses récentes
 * ensuite en parallèle (Promise.allSettled), un échec par budget n'affecte
 * que ce budget.
 */
export function BudgetsScreen() {
  const navigation = useNavigation<any>();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState<Record<string, LedgerEntry[]>>({});
  const [expensesLoading, setExpensesLoading] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<'semaine' | 'mois'>('semaine');
  const [monthMode, setMonthMode] = useState<api.MonthMode>('calendaire');
  const [customStartDay, setCustomStartDay] = useState('');
  const [includeInPrudentProjection, setIncludeInPrudentProjection] = useState(true);
  const [startDate, setStartDate] = useState(todayIso());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listCategories().then((list: Category[]) => setCategories(list.filter((c) => c.kind === 'expense' || c.kind === 'both')));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    let list: Budget[] = [];
    try {
      list = await api.listVariableBudgets();
      setBudgets(list);
    } finally {
      setLoading(false);
    }

    setExpensesLoading(true);
    const results = await Promise.allSettled(list.map((b) => api.listTransactions({ budgetId: b.id, limit: EXPENSES_LIMIT })));
    const next: Record<string, LedgerEntry[]> = {};
    results.forEach((r, i) => {
      next[list[i].id] = r.status === 'fulfilled' ? r.value : [];
    });
    setExpenses(next);
    setExpensesLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onSubmit() {
    setError(null);
    const numericAmount = Number(amount.replace(',', '.'));
    if (!categoryId) {
      setError('Choisissez une catégorie');
      return;
    }
    if (!numericAmount || numericAmount <= 0) {
      setError('Montant invalide');
      return;
    }
    const numericCustomStartDay = customStartDay ? Number(customStartDay) : undefined;
    if (period === 'mois' && monthMode === 'personnalise' && !numericCustomStartDay) {
      setError('Indiquez le jour de départ personnalisé');
      return;
    }
    setSubmitting(true);
    try {
      await api.createVariableBudget({
        categoryId,
        referenceAmount: numericAmount,
        referencePeriod: period,
        startDate,
        monthMode: period === 'mois' ? monthMode : undefined,
        customStartDay: period === 'mois' && monthMode === 'personnalise' ? numericCustomStartDay : undefined,
        includeInPrudentProjection,
      });
      setCategoryId(null);
      setAmount('');
      setMonthMode('calendaire');
      setCustomStartDay('');
      setIncludeInPrudentProjection(true);
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setSubmitting(false);
    }
  }

  const mainContent =
    loading && budgets.length === 0 ? (
      <ActivityIndicator style={{ marginTop: 24 }} />
    ) : budgets.length === 0 ? (
      <Text style={styles.empty}>Aucun budget pour l'instant.</Text>
    ) : (
      <View style={styles.blockList}>
        {budgets.map((item) => {
          const ratio = item.status.budgetPeriode > 0 ? Math.min(item.status.consommeADate / item.status.budgetPeriode, 1) : 0;
          const warn = item.status.healthStatus === 'depasse' || item.status.healthStatus === 'proche_limite';
          const entries = expenses[item.id];
          return (
            <View key={item.id} style={styles.block}>
              <TouchableOpacity testID={`web-budget-card-${item.id}`} style={styles.blockHeader} onPress={() => navigation.navigate('BudgetDetail', { id: item.id })}>
                <Donut size={64} pct={ratio * 100} warn={warn} />
                <View style={styles.blockContent}>
                  <View style={styles.blockTitleRow}>
                    <Text style={styles.blockTitle} numberOfLines={1}>
                      {item.category.name}
                    </Text>
                    <Text style={[styles.statusBadge, { color: HEALTH_COLOR[item.status.healthStatus] }]}>{HEALTH_LABEL[item.status.healthStatus]}</Text>
                  </View>
                  <Text style={styles.blockSubtitle}>
                    {item.referenceAmount.toLocaleString('fr-FR')} DH / {item.referencePeriod}
                  </Text>
                  <View style={styles.figuresRow}>
                    <View>
                      <Text style={styles.figureLabel}>Dépensé</Text>
                      <Text style={styles.figureValue}>{item.status.consommeADate.toLocaleString('fr-FR')} DH</Text>
                    </View>
                    <View>
                      <Text style={styles.figureLabel}>Restant</Text>
                      <Text style={styles.figureValue}>{item.status.budgetContractuelRestant.toLocaleString('fr-FR')} DH</Text>
                    </View>
                    <View>
                      <Text style={styles.figureLabel}>Rythme</Text>
                      <Text style={styles.figureValue}>{item.status.rythmeProjete.toLocaleString('fr-FR')} DH</Text>
                    </View>
                  </View>
                  {item.status.rythmeAlerte && (
                    <Text style={styles.rythmeAlertBadge} testID={`web-budget-rythme-alerte-${item.id}`}>
                      ⚠ Rythme élevé — {Math.round(item.status.consumptionRatio * 100)}% consommé / {Math.round(item.status.elapsedRatio * 100)}% de période écoulée
                    </Text>
                  )}
                </View>
              </TouchableOpacity>

              <View style={styles.activitySection}>
                <Text style={styles.activityTitle}>Dernières dépenses</Text>
                {entries === undefined && expensesLoading ? (
                  <ActivityIndicator style={{ marginTop: 8 }} />
                ) : !entries || entries.length === 0 ? (
                  <Text style={styles.activityEmpty}>Aucune dépense rattachée récemment.</Text>
                ) : (
                  entries.map((tx) => (
                    <TouchableOpacity
                      key={`${tx.kind}-${tx.id}`}
                      style={styles.activityRow}
                      onPress={() => navigation.navigate('TransactionDetail', { kind: tx.kind, id: tx.id })}
                    >
                      <Text style={styles.activityDate}>{formatDate(tx.occurredAt)}</Text>
                      <Text style={styles.activityLabel} numberOfLines={1}>
                        {tx.label ?? KIND_LABEL[tx.displayKind] ?? tx.kind}
                      </Text>
                      <Text style={styles.activityAmount}>{tx.amount.toLocaleString('fr-FR')} DH</Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            </View>
          );
        })}
      </View>
    );

  const panel = (
    <View style={styles.panelCard}>
      <Text style={styles.panelTitle}>Nouveau budget</Text>

      {categories.length === 0 ? (
        <ActivityIndicator />
      ) : (
        <Select testID="web-budget-category-select" label="Catégorie" placeholder="Choisir une catégorie" value={categoryId} onChange={setCategoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
      )}

      <FormField testID="web-budget-amount-input" label="Montant" placeholder="Montant (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />

      <Text style={styles.sectionLabel}>Période</Text>
      <View style={styles.segment}>
        <TouchableOpacity style={[styles.segmentItem, period === 'semaine' && styles.segmentActive]} onPress={() => setPeriod('semaine')}>
          <Text style={[styles.segmentText, period === 'semaine' && styles.segmentTextActive]}>Semaine</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segmentItem, period === 'mois' && styles.segmentActive]} onPress={() => setPeriod('mois')}>
          <Text style={[styles.segmentText, period === 'mois' && styles.segmentTextActive]}>Mois</Text>
        </TouchableOpacity>
      </View>

      {period === 'mois' && (
        <>
          <Text style={styles.sectionLabel}>Mode du mois</Text>
          <View style={styles.segment}>
            {(Object.keys(MONTH_MODE_LABELS) as api.MonthMode[]).map((mode) => (
              <TouchableOpacity key={mode} testID={`web-budget-month-mode-${mode}`} style={[styles.segmentItem, monthMode === mode && styles.segmentActive]} onPress={() => setMonthMode(mode)}>
                <Text style={[styles.segmentText, monthMode === mode && styles.segmentTextActive]}>{MONTH_MODE_LABELS[mode]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {monthMode === 'personnalise' && (
            <FormField testID="web-budget-custom-start-day-input" label="Jour de départ (1-31)" placeholder="Ex. 25" keyboardType="number-pad" value={customStartDay} onChangeText={setCustomStartDay} />
          )}
        </>
      )}

      <View style={styles.prudentRow}>
        <View style={{ flex: 1, marginRight: webSpacing.sm }}>
          <Text style={styles.prudentLabel}>Inclure le restant dans la projection prudente</Text>
        </View>
        <Switch testID="web-budget-include-prudent-switch" value={includeInPrudentProjection} onValueChange={setIncludeInPrudentProjection} />
      </View>

      <Text style={styles.sectionLabel}>Date de début</Text>
      <DateField value={startDate} onChange={setStartDate} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity testID="web-budget-create-submit" style={styles.submitButton} onPress={onSubmit} disabled={submitting}>
        {submitting ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.submitButtonText}>Créer le budget</Text>}
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <PageHeader title="Budgets" />
      <TwoColumnLayout main={mainContent} panel={panel} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center' },
  empty: { color: webColors.textSecondary, fontSize: 13, lineHeight: 20 },

  blockList: { gap: webSpacing.md },
  block: { backgroundColor: webColors.surface, borderRadius: webRadius.lg, borderWidth: 1, borderColor: webColors.borderStrong, overflow: 'hidden' },
  blockHeader: { flexDirection: 'row', alignItems: 'center', padding: webSpacing.md },
  blockContent: { flex: 1, marginLeft: webSpacing.md, minWidth: 0 },
  blockTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  blockTitle: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary, flexShrink: 1, marginRight: webSpacing.xs },
  statusBadge: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  blockSubtitle: { fontSize: 11, color: webColors.textSecondary, marginTop: 2 },
  figuresRow: { flexDirection: 'row', gap: webSpacing.xl, marginTop: webSpacing.sm },
  figureLabel: { fontSize: 10, color: webColors.textSecondary },
  figureValue: { fontSize: 13, fontWeight: '700', color: webColors.textPrimary, marginTop: 2 },
  rythmeAlertBadge: { fontSize: 11, fontWeight: '700', color: webColors.warning, marginTop: webSpacing.sm },

  activitySection: { borderTopWidth: 1, borderTopColor: webColors.border, backgroundColor: webColors.surfaceMuted, paddingHorizontal: webSpacing.md, paddingVertical: webSpacing.sm },
  activityTitle: { fontSize: 10, fontWeight: '700', color: webColors.textSecondary, textTransform: 'uppercase', marginBottom: 4 },
  activityEmpty: { fontSize: 12, color: webColors.textSecondary, paddingVertical: 4 },
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  activityDate: { fontSize: 11, color: webColors.textSecondary, width: 80 },
  activityLabel: { fontSize: 12, color: webColors.textPrimary, flex: 1, paddingRight: webSpacing.sm },
  activityAmount: { fontSize: 12, fontWeight: '700', width: 100, textAlign: 'right', color: webColors.danger },

  panelCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.lg, borderWidth: 1, borderColor: webColors.borderStrong },
  panelTitle: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.md },
  sectionLabel: { fontSize: 12, fontWeight: '600', color: webColors.textPrimary, marginBottom: webSpacing.xs, marginTop: webSpacing.xs },
  segment: { flexDirection: 'row', backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.md, padding: 3, marginBottom: webSpacing.sm },
  segmentItem: { flex: 1, paddingVertical: 8, borderRadius: webRadius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: webColors.surface },
  segmentText: { fontSize: 12, color: webColors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: webColors.textPrimary },
  prudentRow: { flexDirection: 'row', alignItems: 'center', marginTop: webSpacing.xs, marginBottom: webSpacing.sm },
  prudentLabel: { fontSize: 12, fontWeight: '600', color: webColors.textPrimary },
  submitButton: { backgroundColor: webColors.primary, borderRadius: webRadius.md, paddingVertical: 12, alignItems: 'center', marginTop: webSpacing.sm },
  submitButtonText: { color: webColors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  error: { color: webColors.danger, fontSize: 12, marginBottom: webSpacing.sm },
});
