import React, { useCallback, useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
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

type Mode = 'revenu' | 'paiement';

interface Account {
  id: string;
  name: string;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Saisie rapide « + » (§14) : deux actions Lot 2, revenu et paiement/charge.
 * Le compte est pré-rempli (favori > dernier utilisé > principal, cf.
 * AccountsService.getQuickAddDefaultAccount) mais reste toujours modifiable.
 * Le modèle exige une IncomeSource/ChargePlan porteurs — créés silencieusement
 * en une seule action utilisateur pour ne jamais alourdir la saisie.
 */
export function QuickAddScreen() {
  const navigation = useNavigation<any>();
  const [mode, setMode] = useState<Mode>('revenu');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const [list, quickDefault] = await Promise.all([api.listAccounts(), api.getQuickAddDefaultAccount()]);
      setAccounts(list);
      setAccountId(quickDefault.accountId ?? (list[0]?.id ?? null));
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  async function onSubmit() {
    setError(null);
    const numericAmount = Number(amount.replace(',', '.'));
    if (!label.trim()) {
      setError('Un libellé est requis');
      return;
    }
    if (!numericAmount || numericAmount <= 0) {
      setError('Montant invalide');
      return;
    }
    if (!accountId) {
      setError('Aucun compte disponible — créez un compte dans « Plus » d\'abord');
      return;
    }

    setSubmitting(true);
    try {
      const today = todayIso();
      if (mode === 'revenu') {
        const source = await api.createIncomeSource({
          label: label.trim(),
          usualAmount: numericAmount,
          defaultAccountId: accountId,
          isRecurring: false,
          recurrenceRule: 'ponctuel',
        });
        const occurrence = await api.createIncomeOccurrence(source.id, { usualDate: today, plannedAmount: numericAmount });
        await api.confirmIncomeOccurrence(occurrence.id, { actualAmount: numericAmount, actualDate: today, accountId });
      } else {
        const chargePlan = await api.createChargePlan({ label: label.trim(), startDate: today });
        const deadline = await api.createDeadline(chargePlan.id, { dueDate: today, amountCurrent: numericAmount });
        await api.createPayment(deadline.id, { amount: numericAmount, accountId, paidDate: today });
      }
      navigation.goBack();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Enregistrement impossible');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Ajouter</Text>

        <View style={styles.segment}>
          <TouchableOpacity style={[styles.segmentItem, mode === 'revenu' && styles.segmentActive]} onPress={() => setMode('revenu')}>
            <Text style={[styles.segmentText, mode === 'revenu' && styles.segmentTextActive]}>+ Revenu</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.segmentItem, mode === 'paiement' && styles.segmentActive]} onPress={() => setMode('paiement')}>
            <Text style={[styles.segmentText, mode === 'paiement' && styles.segmentTextActive]}>+ Paiement / charge</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.input}
          placeholder={mode === 'revenu' ? 'Libellé (ex. Salaire)' : 'Libellé (ex. Facture électricité)'}
          value={label}
          onChangeText={setLabel}
        />
        <TextInput style={styles.input} placeholder="Montant (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />

        <Text style={styles.sectionLabel}>Compte</Text>
        {loadingAccounts ? (
          <ActivityIndicator />
        ) : (
          <View style={styles.accountList}>
            {accounts.map((a) => (
              <TouchableOpacity
                key={a.id}
                style={[styles.accountChip, accountId === a.id && styles.accountChipActive]}
                onPress={() => setAccountId(a.id)}
              >
                <Text style={[styles.accountChipText, accountId === a.id && styles.accountChipTextActive]}>{a.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Enregistrer</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.cancel}>Annuler</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  scroll: { padding: 24, paddingTop: 40 },
  title: { fontSize: 22, fontWeight: '700', color: '#172436', marginBottom: 20, textAlign: 'center' },
  segment: { flexDirection: 'row', backgroundColor: '#EDEBE6', borderRadius: 10, padding: 4, marginBottom: 16 },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: '#fff' },
  segmentText: { fontSize: 12, color: '#6B747C', fontWeight: '600' },
  segmentTextActive: { color: '#172436' },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#172436', marginBottom: 8, marginTop: 4 },
  accountList: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  accountChip: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  accountChipActive: { backgroundColor: '#172436', borderColor: '#172436' },
  accountChipText: { fontSize: 13, color: '#172436' },
  accountChipTextActive: { color: '#fff', fontWeight: '600' },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  cancel: { color: '#6B747C', textAlign: 'center', marginTop: 16, fontSize: 13 },
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8 },
});
