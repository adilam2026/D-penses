import React, { useCallback, useState } from 'react';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';

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

  const [goal, setGoal] = useState<GoalDetail | null>(null);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<GoalTest | null>(null);
  const [testing, setTesting] = useState(false);

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

  async function onTestGoal() {
    setTesting(true);
    try {
      setTest((await api.analyzeGoal(id)) as GoalTest);
    } finally {
      setTesting(false);
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
    <View style={styles.container}>
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
        <TextInput style={styles.input} placeholder="Montant (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.buttonRow}>
          <TouchableOpacity style={[styles.button, styles.buttonHalf]} onPress={() => onAddContribution(true)} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Mettre de côté maintenant</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.buttonHalf, styles.buttonSecondary]} onPress={() => onAddContribution(false)} disabled={submitting}>
            <Text style={[styles.buttonText, styles.buttonTextSecondary]}>Planifier</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.testButton} onPress={onTestGoal} disabled={testing}>
        {testing ? <ActivityIndicator color="#172436" /> : <Text style={styles.testButtonText}>Tester mon objectif</Text>}
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
                <TouchableOpacity
                  onPress={async () => {
                    await api.confirmGoalContribution(item.id);
                    await load();
                  }}
                >
                  <Text style={styles.confirmLink}>Confirmer</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      />
    </View>
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
  container: { flex: 1, backgroundColor: '#F6F5F2', paddingTop: 16, paddingHorizontal: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5F2' },
  title: { fontSize: 20, fontWeight: '700', color: '#172436', marginBottom: 12 },
  progressTrack: { height: 8, backgroundColor: '#EDEBE6', borderRadius: 4, overflow: 'hidden', marginBottom: 16 },
  progressFill: { height: '100%', backgroundColor: '#2E7D5B' },
  figuresGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  figure: { width: '50%', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  figureLabel: { fontSize: 11, color: '#6B747C' },
  figureValue: { fontSize: 16, fontWeight: '700', color: '#172436', marginTop: 4 },
  figureValueHighlight: { color: '#2E7D5B' },
  formCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 16 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  buttonRow: { flexDirection: 'row' },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonHalf: { flex: 1, marginRight: 8 },
  buttonSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#172436', marginRight: 0 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 12, textAlign: 'center' },
  buttonTextSecondary: { color: '#172436' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#172436', marginBottom: 8 },
  empty: { color: '#6B747C', fontSize: 13 },
  contributionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  contributionLabel: { fontSize: 12, color: '#172436' },
  contributionAmount: { fontSize: 13, fontWeight: '700', color: '#172436' },
  confirmLink: { color: '#2E7D5B', fontSize: 11, fontWeight: '600', marginTop: 4 },
  error: { color: '#B3261E', fontSize: 12, marginBottom: 8 },
  testButton: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#172436', paddingVertical: 12, alignItems: 'center', marginBottom: 12 },
  testButtonText: { color: '#172436', fontWeight: '600', fontSize: 13 },
  testCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 16 },
  testLine: { fontSize: 12, color: '#172436', marginTop: 6 },
  testLineWarning: { color: '#B8860B', fontWeight: '600' },
  testLineOk: { fontSize: 12, color: '#2E7D5B', fontWeight: '600', marginTop: 6 },
  warning: { fontSize: 12, color: '#B8860B', fontWeight: '600', marginBottom: 8 },
});
