import React, { useCallback, useState } from 'react';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { FormField } from '../../ui/FormField';
import { colors, radius, spacing } from '../../ui/theme';

interface GoalDetail {
  id: string;
  label: string;
  targetAmount: number;
  targetDate: string | null;
  savedAmount: number;
  remainingToConstitute: number;
  progressPercent: number;
}

interface Contribution {
  id: string;
  status: 'prevu' | 'confirme' | 'annule';
  plannedAmount: number;
  plannedDate: string;
}

interface GoalTest {
  remaining_amount: number;
  necessary_monthly_amount: number | null;
  prudent_monthly_amount: number;
  target_date: string | null;
  realistic_date: string | null;
  target_status: 'FEASIBLE_AT_REQUESTED_PACE' | 'NOT_FEASIBLE_AT_REQUESTED_PACE' | 'NO_TARGET_DATE';
  is_complete: boolean;
}

interface ContributionImpact {
  delta_free_capacity_low_point: number;
  contribution_dates: string[];
  reserve_added_total: number;
  is_complete: boolean;
  contains_estimates: boolean;
  scenario: { free_capacity_low_point: number; free_capacity_low_point_date: string; physical_low_point: number };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Fiche objectif (§25) : objectif, déjà mis de côté, reste à constituer, progression. */
export function GoalDetailScreen() {
  const route = useRoute<any>();
  const id = route.params?.id as string;
  const bottomInset = useBottomInset();

  const [goal, setGoal] = useState<GoalDetail | null>(null);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<GoalTest | null>(null);
  const [testing, setTesting] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [impact, setImpact] = useState<ContributionImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGoal(await api.getGoal(id));
      setContributions(await api.listGoalContributions(id));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onAddContribution(confirmed: boolean) {
    setError(null);
    const value = Number(amount.replace(',', '.'));
    if (!value || value <= 0) {
      setError('Montant invalide');
      return;
    }
    setSubmitting(true);
    try {
      await api.addGoalContribution(id, { plannedDate: todayIso(), plannedAmount: value, confirmed });
      setAmount('');
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Contribution impossible');
    } finally {
      setSubmitting(false);
    }
  }

  async function onSimulateImpact() {
    setImpactError(null);
    const value = Number(amount.replace(',', '.'));
    if (!value || value <= 0) {
      setImpactError('Montant invalide');
      return;
    }
    setImpactLoading(true);
    try {
      setImpact((await api.simulateGoalContribution({ goalId: id, amount: value, date: todayIso() })) as ContributionImpact);
    } catch (err) {
      setImpactError(err instanceof api.ApiError ? err.message : 'Simulation impossible');
    } finally {
      setImpactLoading(false);
    }
  }

  async function onTestGoal() {
    setTesting(true);
    try {
      setTest((await api.analyzeGoal(id)) as GoalTest);
    } finally {
      setTesting(false);
    }
  }

  async function onConfirmContribution(contributionId: string) {
    if (confirmingId) return;
    setConfirmingId(contributionId);
    try {
      await api.confirmGoalContribution(contributionId);
      await load();
    } finally {
      setConfirmingId(null);
    }
  }

  if (loading || !goal) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{goal.label}</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${goal.progressPercent}%` }]} />
        </View>
        <View style={styles.figuresGrid}>
          <Figure label="Objectif" value={goal.targetAmount} />
          <Figure label="Déjà mis de côté" value={goal.savedAmount} highlight />
          <Figure label="Reste à constituer" value={goal.remainingToConstitute} />
          <Figure label="Progression" value={goal.progressPercent} suffix="%" />
        </View>

        <View style={styles.formCard}>
          <FormField
            testID="goal-contribute-amount-input"
            placeholder="Montant (DH)"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
            containerStyle={styles.amountField}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.button, styles.buttonHalf]} onPress={() => onAddContribution(true)} disabled={submitting}>
              {submitting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Mettre de côté maintenant</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.buttonHalf, styles.buttonSecondary]} onPress={() => onAddContribution(false)} disabled={submitting}>
              <Text style={[styles.buttonText, styles.buttonTextSecondary]}>Planifier</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={onSimulateImpact} disabled={impactLoading}>
            {impactLoading ? (
              <ActivityIndicator style={{ marginTop: 10 }} size="small" />
            ) : (
              <Text style={styles.simulateLink}>Simuler l'impact de ce montant avant de décider</Text>
            )}
          </TouchableOpacity>
          {impactError ? <Text style={styles.error}>{impactError}</Text> : null}
          {impact && (
            <View style={styles.impactBox}>
              {!impact.is_complete && <Text style={styles.warning}>Calcul basé sur les montants connus uniquement.</Text>}
              <Text style={styles.impactLine}>
                Disponible libre minimum après cette mise de côté :{' '}
                <Text style={styles.impactValue}>{impact.scenario.free_capacity_low_point.toLocaleString('fr-FR')} DH</Text>
              </Text>
              <Text style={styles.impactLineSub}>
                {impact.delta_free_capacity_low_point < 0 ? '' : '+'}
                {impact.delta_free_capacity_low_point.toLocaleString('fr-FR')} DH par rapport à aujourd'hui sans cette mise de côté
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.testButton} onPress={onTestGoal} disabled={testing}>
          {testing ? <ActivityIndicator color={colors.textPrimary} /> : <Text style={styles.testButtonText}>Tester mon objectif</Text>}
        </TouchableOpacity>

        {test && (
          <View style={styles.testCard}>
            {!test.is_complete && <Text style={styles.warning}>Calcul basé sur les montants connus — certains montants restent inconnus.</Text>}
            <View style={styles.figuresGrid}>
              <Figure label="Objectif restant" value={test.remaining_amount} />
              {test.necessary_monthly_amount !== null && <Figure label="Contribution nécessaire" value={test.necessary_monthly_amount} />}
              <Figure label="Contribution prudente" value={test.prudent_monthly_amount} highlight />
            </View>
            {test.target_date && <Text style={styles.testLine}>Date souhaitée : {formatDate(test.target_date)}</Text>}
            {test.target_status === 'NOT_FEASIBLE_AT_REQUESTED_PACE' && test.realistic_date && (
              <Text style={[styles.testLine, styles.testLineWarning]}>Date réaliste estimée : {formatDate(test.realistic_date)}</Text>
            )}
            {test.target_status === 'FEASIBLE_AT_REQUESTED_PACE' && <Text style={styles.testLineOk}>Compatible avec vos finances actuelles.</Text>}
          </View>
        )}

        <Text style={styles.sectionTitle}>Contributions</Text>
        <FlatList
          data={contributions}
          keyExtractor={(c) => c.id}
          scrollEnabled={false}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          ListEmptyComponent={<Text style={styles.empty}>Aucune contribution pour l'instant.</Text>}
          renderItem={({ item }) => (
            <View style={styles.contributionRow}>
              <Text style={styles.contributionLabel}>
                {formatDate(item.plannedDate)}
                {item.status === 'prevu' ? ' (prévue)' : ''}
              </Text>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.contributionAmount}>{item.plannedAmount.toLocaleString('fr-FR')} DH</Text>
                {item.status === 'prevu' && (
                  <TouchableOpacity onPress={() => onConfirmContribution(item.id)} disabled={confirmingId === item.id}>
                    {confirmingId === item.id ? <ActivityIndicator size="small" /> : <Text style={styles.confirmLink}>Confirmer</Text>}
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Figure({ label, value, suffix, highlight }: { label: string; value: number; suffix?: string; highlight?: boolean }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={[styles.figureValue, highlight && styles.figureValueHighlight]}>
        {value.toLocaleString('fr-FR')}
        {suffix ?? ' DH'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingTop: spacing.md, paddingHorizontal: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  progressTrack: { height: 8, backgroundColor: colors.surfaceSecondary, borderRadius: 4, overflow: 'hidden', marginBottom: spacing.lg },
  progressFill: { height: '100%', backgroundColor: colors.success },
  figuresGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.lg },
  figure: { width: '50%', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  figureLabel: { fontSize: 11, color: colors.textSecondary },
  figureValue: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginTop: 4 },
  figureValueHighlight: { color: colors.success },
  formCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg },
  amountField: { marginBottom: spacing.sm },
  buttonRow: { flexDirection: 'row' },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  buttonHalf: { flex: 1, marginRight: spacing.sm },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary, marginRight: 0 },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 12, textAlign: 'center' },
  buttonTextSecondary: { color: colors.textPrimary },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  empty: { color: colors.textSecondary, fontSize: 13 },
  contributionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  contributionLabel: { fontSize: 12, color: colors.textPrimary },
  contributionAmount: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  confirmLink: { color: colors.success, fontSize: 11, fontWeight: '600', marginTop: 4 },
  error: { color: colors.danger, fontSize: 12, marginBottom: spacing.sm },
  testButton: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, paddingVertical: 12, alignItems: 'center', marginBottom: spacing.md },
  testButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  testCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg },
  testLine: { fontSize: 12, color: colors.textPrimary, marginTop: 6 },
  testLineWarning: { color: colors.warning, fontWeight: '600' },
  testLineOk: { fontSize: 12, color: colors.success, fontWeight: '600', marginTop: 6 },
  warning: { fontSize: 12, color: colors.warning, fontWeight: '600', marginBottom: spacing.sm },
  simulateLink: { color: colors.textPrimary, fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 10 },
  impactBox: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.surfaceSecondary },
  impactLine: { fontSize: 13, color: colors.textPrimary },
  impactValue: { fontWeight: '700' },
  impactLineSub: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
});
