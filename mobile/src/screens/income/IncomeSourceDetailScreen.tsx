import React, { useCallback, useState } from 'react';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { DateField } from '../../ui/DateField';

interface Occurrence {
  id: string;
  usualDate: string;
  plannedAmount: number | string;
  actualAmount: number | string | null;
  actualDate: string | null;
  status: 'prevu' | 'recu';
}

function n(v: number | string | null): number {
  if (v === null) return 0;
  return typeof v === 'number' ? v : Number(v);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Cycle prévu → reçu d'une source de revenu (Lot 1 — recette), montant réel pouvant différer du prévu (RG-014bis). */
export function IncomeSourceDetailScreen() {
  const route = useRoute<any>();
  const bottomInset = useBottomInset();
  const sourceId = route.params?.id as string;
  const label = route.params?.label as string;

  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);

  const [plannedDate, setPlannedDate] = useState(todayIso());
  const [plannedAmount, setPlannedAmount] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [actualAmounts, setActualAmounts] = useState<Record<string, string>>({});
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOccurrences(await api.listIncomeOccurrences(sourceId));
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onCreateOccurrence() {
    setCreateError(null);
    setCreating(true);
    try {
      await api.createIncomeOccurrence(sourceId, {
        usualDate: plannedDate,
        plannedAmount: plannedAmount.trim() ? Number(plannedAmount.replace(',', '.')) : undefined,
      });
      setPlannedAmount('');
      await load();
    } catch (err) {
      setCreateError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setCreating(false);
    }
  }

  async function onConfirm(occurrenceId: string) {
    setConfirmError(null);
    const raw = actualAmounts[occurrenceId];
    const value = raw ? Number(raw.replace(',', '.')) : NaN;
    if (!value || value <= 0) {
      setConfirmError('Montant réel invalide');
      return;
    }
    setConfirmingId(occurrenceId);
    try {
      await api.confirmIncomeOccurrence(occurrenceId, { actualAmount: value, actualDate: todayIso() });
      await load();
    } catch (err) {
      setConfirmError(err instanceof api.ApiError ? err.message : 'Confirmation impossible');
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{label}</Text>

        <Text style={styles.sectionTitle}>Prochaine occurrence prévue</Text>
        <DateField label="Date prévue" value={plannedDate} onChange={setPlannedDate} />
        <TextInput
          style={styles.input}
          placeholder="Montant prévu (DH, facultatif — reprend le montant habituel)"
          keyboardType="decimal-pad"
          value={plannedAmount}
          onChangeText={setPlannedAmount}
        />
        {createError ? <Text style={styles.error}>{createError}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={onCreateOccurrence} disabled={creating}>
          {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Planifier</Text>}
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Occurrences</Text>
        {loading ? (
          <ActivityIndicator />
        ) : occurrences.length === 0 ? (
          <Text style={styles.empty}>Aucune occurrence planifiée pour l'instant.</Text>
        ) : (
          occurrences.map((o) => (
            <View key={o.id} style={styles.card}>
              <Text style={styles.cardTitle}>{formatDate(o.usualDate)}</Text>
              <Text style={styles.cardMeta}>Prévu : {n(o.plannedAmount).toLocaleString('fr-FR')} DH</Text>
              {o.status === 'recu' ? (
                <Text style={styles.received}>
                  Reçu : {n(o.actualAmount).toLocaleString('fr-FR')} DH{o.actualDate ? ` le ${formatDate(o.actualDate)}` : ''}
                </Text>
              ) : (
                <View style={styles.confirmRow}>
                  <TextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    placeholder="Montant réel (DH)"
                    keyboardType="decimal-pad"
                    value={actualAmounts[o.id] ?? String(n(o.plannedAmount))}
                    onChangeText={(v) => setActualAmounts((prev) => ({ ...prev, [o.id]: v }))}
                  />
                  <TouchableOpacity style={styles.buttonSmall} onPress={() => onConfirm(o.id)} disabled={confirmingId === o.id}>
                    {confirmingId === o.id ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonSmallText}>Reçu</Text>}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))
        )}
        {confirmError ? <Text style={styles.error}>{confirmError}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  scroll: { padding: 20 },
  title: { fontSize: 20, fontWeight: '700', color: '#172436', marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#172436', marginTop: 16, marginBottom: 8 },
  empty: { color: '#6B747C', fontSize: 13 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#E3E1DC',
    marginBottom: 8,
  },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  buttonSmall: { backgroundColor: '#172436', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginLeft: 8, justifyContent: 'center' },
  buttonSmallText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#E3E1DC' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#172436' },
  cardMeta: { fontSize: 12, color: '#6B747C', marginTop: 2 },
  received: { fontSize: 12, color: '#2E7D5B', marginTop: 6, fontWeight: '600' },
  confirmRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8 },
});
