import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { DateField } from '../../ui/DateField';
import { Select } from '../../ui/Select';
import { FormField } from '../../ui/FormField';
import { colors, radius, spacing } from '../../ui/theme';

interface Account {
  id: string;
  name: string;
}

interface PurchaseResult {
  decision: 'POSSIBLE_ET_PRUDENT' | 'POSSIBLE_MAIS_TENSION' | 'IMPOSSIBLE_DEFICIT' | 'INDETERMINE_INCOMPLET';
  possible_date: string | null;
  recommended_date: string | null;
  margin_after_purchase: number;
  physical_low_point_after: number;
  reason_codes: string[];
  is_complete: boolean;
  contains_estimates: boolean;
}

interface CompareRow {
  label: string;
  date: string;
  decision: PurchaseResult['decision'];
  margin: number;
  lowPoint: number;
}

interface SavingsCapacityResult {
  max_amount: number;
  recurring: boolean;
  horizon_end: string;
  contribution_dates: string[];
  is_complete: boolean;
  contains_estimates: boolean;
}

const DECISION_LABEL: Record<PurchaseResult['decision'], string> = {
  POSSIBLE_ET_PRUDENT: 'Possible',
  POSSIBLE_MAIS_TENSION: 'Possible mais risqué',
  IMPOSSIBLE_DEFICIT: 'Pas maintenant',
  INDETERMINE_INCOMPLET: 'Calcul incomplet',
};

const DECISION_COLOR: Record<PurchaseResult['decision'], string> = {
  POSSIBLE_ET_PRUDENT: colors.success,
  POSSIBLE_MAIS_TENSION: colors.warning,
  IMPOSSIBLE_DEFICIT: colors.danger,
  INDETERMINE_INCOMPLET: colors.textSecondary,
};

const REASON_LABEL: Record<string, string> = {
  PHYSICAL_DEFICIT: 'Le compte passerait en négatif',
  FREE_CAPACITY_NEGATIVE: 'Le disponible libre deviendrait négatif',
  SAFETY_BUFFER_AT_RISK: 'Votre coussin de sécurité serait entamé',
  UNKNOWN_FUTURE_AMOUNT: 'Un montant à venir est encore inconnu',
  PROTECTED_SAVINGS: 'Ce compte est une épargne protégée',
  GOAL_TARGET_TOO_AGGRESSIVE: 'Le rythme demandé est trop ambitieux',
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

/**
 * Simulateur What-if (§39 Lot 8) — « Puis-je me le permettre ? ». Aucune donnée réelle
 * n'est jamais modifiée par cet écran (IF-10) : une simulation reste une lecture, jamais
 * un achat, un transfert ou une contribution automatique (§42).
 */
export function SimulatorScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [mode, setMode] = useState<'achat' | 'capacite'>('achat');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const [compare, setCompare] = useState<CompareRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [capacityRecurring, setCapacityRecurring] = useState(false);
  const [capacity, setCapacity] = useState<SavingsCapacityResult | null>(null);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const [capacityError, setCapacityError] = useState<string | null>(null);

  useEffect(() => {
    api.listAccounts().then((list: Account[]) => {
      setAccounts(list);
      if (list.length) setAccountId(list[0].id);
    });
  }, []);

  async function onSimulate() {
    setError(null);
    const numericAmount = Number(amount.replace(',', '.'));
    if (!numericAmount || numericAmount <= 0) {
      setError('Montant invalide');
      return;
    }
    if (!accountId) {
      setError('Choisissez un compte');
      return;
    }
    setSubmitting(true);
    try {
      const main = (await api.simulatePurchase({ amount: numericAmount, date, accountId })) as PurchaseResult;
      setResult(main);

      // Comparateur (§41) : Aujourd'hui / date choisie / première date possible — côte à côte.
      const rows: CompareRow[] = [];
      const today = todayIso();
      if (date !== today) {
        const r = (await api.simulatePurchase({ amount: numericAmount, date: today, accountId })) as PurchaseResult;
        rows.push({ label: "Aujourd'hui", date: today, decision: r.decision, margin: r.margin_after_purchase, lowPoint: r.physical_low_point_after });
      }
      rows.push({ label: 'Date choisie', date, decision: main.decision, margin: main.margin_after_purchase, lowPoint: main.physical_low_point_after });
      if (main.possible_date && main.possible_date.slice(0, 10) !== date) {
        const r = (await api.simulatePurchase({ amount: numericAmount, date: main.possible_date.slice(0, 10), accountId })) as PurchaseResult;
        rows.push({ label: 'Première date possible', date: main.possible_date, decision: r.decision, margin: r.margin_after_purchase, lowPoint: r.physical_low_point_after });
      }
      setCompare(rows);
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Simulation impossible');
    } finally {
      setSubmitting(false);
    }
  }

  async function onTestCapacity() {
    setCapacityError(null);
    setCapacityLoading(true);
    try {
      setCapacity((await api.getSavingsCapacity({ recurring: capacityRecurring })) as SavingsCapacityResult);
    } catch (err) {
      setCapacityError(err instanceof api.ApiError ? err.message : 'Calcul impossible');
    } finally {
      setCapacityLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{mode === 'achat' ? 'Puis-je me le permettre ?' : 'Combien puis-je mettre de côté ?'}</Text>

        <View style={styles.segment}>
          <TouchableOpacity style={[styles.segmentItem, mode === 'achat' && styles.segmentActive]} onPress={() => setMode('achat')}>
            <Text style={[styles.segmentText, mode === 'achat' && styles.segmentTextActive]}>Un achat</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.segmentItem, mode === 'capacite' && styles.segmentActive]} onPress={() => setMode('capacite')}>
            <Text style={[styles.segmentText, mode === 'capacite' && styles.segmentTextActive]}>Capacité d'épargne</Text>
          </TouchableOpacity>
        </View>

        {mode === 'capacite' ? (
          <>
            <Text style={styles.hint}>Estime, sans rien réserver réellement, le montant que vous pourriez mettre de côté sans risquer votre coussin de sécurité ni votre disponible libre.</Text>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Versement récurrent (mensuel) plutôt qu'unique</Text>
              <Switch value={capacityRecurring} onValueChange={setCapacityRecurring} />
            </View>

            <TouchableOpacity style={styles.button} onPress={onTestCapacity} disabled={capacityLoading} testID="simulator-capacity-submit">
              {capacityLoading ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Calculer</Text>}
            </TouchableOpacity>
            {capacityError ? <Text style={styles.error}>{capacityError}</Text> : null}

            {capacity && (
              <View style={styles.resultCard}>
                {!capacity.is_complete && <Text style={styles.warning}>Calcul basé sur les montants connus uniquement.</Text>}
                {capacity.contains_estimates && capacity.is_complete && <Text style={styles.info}>Inclut des montants estimés.</Text>}
                <Text style={styles.capacityLabel}>{capacity.recurring ? 'Montant mensuel prudent' : 'Montant unique prudent, aujourd\'hui'}</Text>
                <Text style={styles.capacityValue}>{capacity.max_amount.toLocaleString('fr-FR')} DH</Text>
                <Text style={styles.dateLine}>
                  {capacity.recurring
                    ? `Sur ${capacity.contribution_dates.length} versement(s) d'ici le ${formatDate(capacity.horizon_end)}`
                    : `Sans risque d'ici le ${formatDate(capacity.horizon_end)}`}
                </Text>
              </View>
            )}
          </>
        ) : (
          <>
            <FormField
              testID="simulator-amount-input"
              label="Montant"
              placeholder="Montant (DH)"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              onFocus={handleFocus}
            />

            <Text style={styles.sectionLabel}>Date</Text>
            <DateField value={date} onChange={setDate} />

            <Select
              testID="simulator-account-select"
              label="Compte"
              placeholder="Choisir un compte"
              value={accountId}
              options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              onChange={setAccountId}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity style={styles.button} onPress={onSimulate} disabled={submitting} testID="simulator-submit">
              {submitting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Simuler</Text>}
            </TouchableOpacity>

            {result && (
              <View style={styles.resultCard}>
                <Text style={[styles.decision, { color: DECISION_COLOR[result.decision] }]}>{DECISION_LABEL[result.decision]}</Text>
                {!result.is_complete && <Text style={styles.warning}>Calcul basé sur les montants connus uniquement — certains montants restent inconnus.</Text>}
                {result.contains_estimates && result.is_complete && <Text style={styles.info}>Inclut des montants estimés.</Text>}

                <View style={styles.figuresRow}>
                  <Figure label="Marge minimale restante" value={result.margin_after_purchase} />
                  <Figure label="Point bas" value={result.physical_low_point_after} />
                </View>

                {result.possible_date && <Text style={styles.dateLine}>Première date possible : {formatDate(result.possible_date)}</Text>}
                {result.recommended_date && <Text style={styles.dateLine}>Date recommandée : {formatDate(result.recommended_date)}</Text>}

                {result.reason_codes.length > 0 && (
                  <View style={styles.reasons}>
                    <Text style={styles.reasonsTitle}>Raison principale</Text>
                    <Text style={styles.reasonText}>{REASON_LABEL[result.reason_codes[0]] ?? result.reason_codes[0]}</Text>
                  </View>
                )}
              </View>
            )}

            {compare.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Comparateur</Text>
                {compare.map((row, i) => (
                  <View key={i} style={styles.compareRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.compareLabel}>{row.label}</Text>
                      <Text style={styles.compareDate}>{formatDate(row.date)}</Text>
                    </View>
                    <Text style={[styles.compareDecision, { color: DECISION_COLOR[row.decision] }]}>{DECISION_LABEL[row.decision]}</Text>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.compareFigure}>{row.margin.toLocaleString('fr-FR')} DH</Text>
                      <Text style={styles.compareFigureSub}>bas: {row.lowPoint.toLocaleString('fr-FR')} DH</Text>
                    </View>
                  </View>
                ))}
              </>
            )}
          </>
        )}

        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.cancel}>Retour</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={[styles.figureValue, value < 0 && styles.figureValueNegative]}>{value.toLocaleString('fr-FR')} DH</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl, paddingTop: 24 },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.lg },
  segment: { flexDirection: 'row', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, marginBottom: spacing.lg },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: colors.textPrimary },
  hint: { fontSize: 12, color: colors.textSecondary, lineHeight: 18, marginBottom: spacing.lg },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  toggleLabel: { fontSize: 13, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  capacityLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '600', marginTop: 4 },
  capacityValue: { fontSize: 28, fontWeight: '800', color: colors.success, marginTop: 4 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm, marginTop: spacing.md },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 15 },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.sm },
  resultCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.xl },
  decision: { fontSize: 18, fontWeight: '800' },
  warning: { fontSize: 12, color: colors.warning, marginTop: spacing.sm, fontWeight: '600' },
  info: { fontSize: 12, color: colors.textSecondary, marginTop: spacing.sm },
  figuresRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  figure: { flex: 1 },
  figureLabel: { fontSize: 11, color: colors.textSecondary },
  figureValue: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, marginTop: 4 },
  figureValueNegative: { color: colors.danger },
  dateLine: { fontSize: 12, color: colors.textPrimary, marginTop: 10 },
  reasons: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.surfaceSecondary },
  reasonsTitle: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  reasonText: { fontSize: 13, color: colors.textPrimary, marginTop: 4 },
  compareRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  compareLabel: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  compareDate: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  compareDecision: { fontSize: 11, fontWeight: '700', flex: 1, textAlign: 'center' },
  compareFigure: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  compareFigureSub: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },
  cancel: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xl, fontSize: 13 },
});
