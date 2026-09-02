import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';

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

const DECISION_LABEL: Record<PurchaseResult['decision'], string> = {
  POSSIBLE_ET_PRUDENT: 'Possible',
  POSSIBLE_MAIS_TENSION: 'Possible mais risqué',
  IMPOSSIBLE_DEFICIT: 'Pas maintenant',
  INDETERMINE_INCOMPLET: 'Calcul incomplet',
};

const DECISION_COLOR: Record<PurchaseResult['decision'], string> = {
  POSSIBLE_ET_PRUDENT: '#2E7D5B',
  POSSIBLE_MAIS_TENSION: '#B8860B',
  IMPOSSIBLE_DEFICIT: '#B3261E',
  INDETERMINE_INCOMPLET: '#6B747C',
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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const [compare, setCompare] = useState<CompareRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Puis-je me le permettre ?</Text>

      <Text style={styles.sectionLabel}>Montant</Text>
      <TextInput style={styles.input} placeholder="Montant (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />

      <Text style={styles.sectionLabel}>Date</Text>
      <TextInput style={styles.input} placeholder="AAAA-MM-JJ" value={date} onChangeText={setDate} />

      <Text style={styles.sectionLabel}>Compte</Text>
      <View style={styles.chipRow}>
        {accounts.map((a) => (
          <TouchableOpacity key={a.id} style={[styles.chip, accountId === a.id && styles.chipActive]} onPress={() => setAccountId(a.id)}>
            <Text style={[styles.chipText, accountId === a.id && styles.chipTextActive]}>{a.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={onSimulate} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Simuler</Text>}
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

      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.cancel}>Retour</Text>
      </TouchableOpacity>
    </ScrollView>
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
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  scroll: { padding: 20, paddingTop: 24, paddingBottom: 40 },
  title: { fontSize: 18, fontWeight: '700', color: '#172436', marginBottom: 16 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#172436', marginBottom: 8, marginTop: 12 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
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
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  error: { color: '#B3261E', fontSize: 13, marginTop: 8 },
  resultCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 20 },
  decision: { fontSize: 18, fontWeight: '800' },
  warning: { fontSize: 12, color: '#B8860B', marginTop: 8, fontWeight: '600' },
  info: { fontSize: 12, color: '#6B747C', marginTop: 8 },
  figuresRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  figure: { flex: 1 },
  figureLabel: { fontSize: 11, color: '#6B747C' },
  figureValue: { fontSize: 18, fontWeight: '800', color: '#172436', marginTop: 4 },
  figureValueNegative: { color: '#B3261E' },
  dateLine: { fontSize: 12, color: '#172436', marginTop: 10 },
  reasons: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#EDEBE6' },
  reasonsTitle: { fontSize: 11, color: '#6B747C', fontWeight: '600' },
  reasonText: { fontSize: 13, color: '#172436', marginTop: 4 },
  compareRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  compareLabel: { fontSize: 12, fontWeight: '700', color: '#172436' },
  compareDate: { fontSize: 11, color: '#6B747C', marginTop: 2 },
  compareDecision: { fontSize: 11, fontWeight: '700', flex: 1, textAlign: 'center' },
  compareFigure: { fontSize: 12, fontWeight: '700', color: '#172436' },
  compareFigureSub: { fontSize: 10, color: '#6B747C', marginTop: 2 },
  cancel: { color: '#6B747C', textAlign: 'center', marginTop: 20, fontSize: 13 },
});
