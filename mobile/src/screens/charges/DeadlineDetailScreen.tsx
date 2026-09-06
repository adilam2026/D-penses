import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
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

interface Deadline {
  id: string;
  dueDate: string;
  amountCurrent: number | string | null;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  financialStatus: 'ouverte' | 'partiellement_payee' | 'soldee' | 'annulee';
  resteAPayer: number | string | null;
  chargePlan: { label: string };
}

interface Payment {
  id: string;
  amount: number | string;
  paidDate: string;
  type: string;
}

interface Account {
  id: string;
  name: string;
}

const STATUS_LABEL: Record<Deadline['financialStatus'], string> = {
  ouverte: 'Ouverte',
  partiellement_payee: 'Partiellement payée',
  soldee: 'Soldée',
  annulee: 'Annulée',
};

function n(v: number | string | null): number | null {
  if (v === null) return null;
  return typeof v === 'number' ? v : Number(v);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Détail d'une échéance (Lot 1 — recette) : confirmer, payer (total/partiel), clôturer, annuler. */
export function DeadlineDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const id = route.params?.id as string;

  const [deadline, setDeadline] = useState<Deadline | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const [confirmAmount, setConfirmAmount] = useState('');
  const [confirming, setConfirming] = useState(false);

  const [payAmount, setPayAmount] = useState('');
  const [payAccountId, setPayAccountId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const [closing, setClosing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p, accountList] = await Promise.all([api.getDeadline(id), api.listPayments(id), api.listAccounts()]);
      setDeadline(d);
      setPayments(p);
      setAccounts(accountList);
      setPayAccountId((current) => current ?? accountList[0]?.id ?? null);
      if (d.amountCurrent !== null) setConfirmAmount(String(n(d.amountCurrent)));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onConfirmBilling() {
    setError(null);
    const value = Number(confirmAmount.replace(',', '.'));
    if (!value || value <= 0) {
      setError('Montant invalide');
      return;
    }
    setConfirming(true);
    try {
      await api.updateDeadline(id, { amountCurrent: value, amountStatus: 'confirme', billingDate: todayIso() });
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Confirmation impossible');
    } finally {
      setConfirming(false);
    }
  }

  async function onPay() {
    setError(null);
    const value = Number(payAmount.replace(',', '.'));
    if (!value || value <= 0) {
      setError('Montant invalide');
      return;
    }
    if (!payAccountId) {
      setError('Choisissez un compte');
      return;
    }
    setPaying(true);
    try {
      await api.createPayment(id, { amount: value, accountId: payAccountId, paidDate: todayIso() });
      setPayAmount('');
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Paiement impossible');
    } finally {
      setPaying(false);
    }
  }

  async function onClose() {
    setError(null);
    setClosing(true);
    try {
      await api.closeDeadline(id);
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Clôture impossible');
    } finally {
      setClosing(false);
    }
  }

  async function onCancel() {
    setError(null);
    setCancelling(true);
    try {
      await api.cancelDeadline(id);
      navigation.goBack();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Annulation impossible');
    } finally {
      setCancelling(false);
    }
  }

  if (loading && !deadline) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!deadline) return null;

  const resteAPayer = n(deadline.resteAPayer);
  const isOpen = deadline.financialStatus === 'ouverte' || deadline.financialStatus === 'partiellement_payee';

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}>
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>{deadline.chargePlan.label}</Text>
          <Text style={styles.heroMeta}>Échéance du {formatDate(deadline.dueDate)}</Text>
          <Text style={styles.heroStatus}>{STATUS_LABEL[deadline.financialStatus]}</Text>
          <Text style={styles.heroAmount}>{resteAPayer !== null ? `${resteAPayer.toLocaleString('fr-FR')} DH restants` : 'Montant à confirmer'}</Text>
        </View>

        {isOpen && deadline.amountStatus !== 'confirme' && (
          <>
            <Text style={styles.sectionTitle}>Confirmer la facture</Text>
            <TextInput style={styles.input} placeholder="Montant réel (DH)" keyboardType="decimal-pad" value={confirmAmount} onChangeText={setConfirmAmount} />
            <TouchableOpacity style={styles.button} onPress={onConfirmBilling} disabled={confirming}>
              {confirming ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Confirmer</Text>}
            </TouchableOpacity>
          </>
        )}

        {isOpen && (
          <>
            <Text style={styles.sectionTitle}>Payer (total ou partiel)</Text>
            <View style={styles.chipRow}>
              {accounts.map((a) => (
                <TouchableOpacity key={a.id} style={[styles.chip, payAccountId === a.id && styles.chipActive]} onPress={() => setPayAccountId(a.id)}>
                  <Text style={[styles.chipText, payAccountId === a.id && styles.chipTextActive]}>{a.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.row}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Montant (DH)" keyboardType="decimal-pad" value={payAmount} onChangeText={setPayAmount} />
              <TouchableOpacity style={styles.button} onPress={onPay} disabled={paying}>
                {paying ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Payer</Text>}
              </TouchableOpacity>
            </View>
          </>
        )}

        {payments.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Paiements enregistrés</Text>
            {payments.map((p) => (
              <View key={p.id} style={styles.paymentRow}>
                <Text style={styles.paymentText}>{formatDate(p.paidDate)}</Text>
                <Text style={styles.paymentAmount}>{n(p.amount)?.toLocaleString('fr-FR')} DH</Text>
              </View>
            ))}
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {isOpen && (
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.buttonSecondary} onPress={onClose} disabled={closing}>
              {closing ? <ActivityIndicator color="#172436" /> : <Text style={styles.buttonSecondaryText}>Clôturer</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.buttonDanger} onPress={onCancel} disabled={cancelling}>
              {cancelling ? <ActivityIndicator color="#B3261E" /> : <Text style={styles.buttonDangerText}>Annuler l'échéance</Text>}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5F2' },
  scroll: { padding: 20 },
  heroCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18, marginBottom: 16 },
  heroLabel: { fontSize: 18, fontWeight: '700', color: '#172436' },
  heroMeta: { fontSize: 12, color: '#6B747C', marginTop: 4 },
  heroStatus: { fontSize: 12, fontWeight: '700', color: '#6B747C', marginTop: 8, textTransform: 'uppercase' },
  heroAmount: { fontSize: 22, fontWeight: '800', color: '#172436', marginTop: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#172436', marginTop: 16, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center' },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#E3E1DC',
    marginBottom: 8,
    marginRight: 8,
  },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  chip: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  chipActive: { backgroundColor: '#172436', borderColor: '#172436' },
  chipText: { fontSize: 12, color: '#172436' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  paymentRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 10, padding: 10, marginBottom: 6 },
  paymentText: { fontSize: 12, color: '#6B747C' },
  paymentAmount: { fontSize: 13, fontWeight: '700', color: '#172436' },
  actionsRow: { flexDirection: 'row', marginTop: 16, justifyContent: 'space-between' },
  buttonSecondary: { flex: 1, backgroundColor: '#EEF0F3', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginRight: 8 },
  buttonSecondaryText: { color: '#172436', fontWeight: '600', fontSize: 13 },
  buttonDanger: { flex: 1, backgroundColor: '#FBEAEA', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonDangerText: { color: '#B3261E', fontWeight: '600', fontSize: 13 },
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8, marginTop: 8 },
});
