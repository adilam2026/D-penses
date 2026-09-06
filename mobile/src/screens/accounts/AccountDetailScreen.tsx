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

interface Account {
  id: string;
  name: string;
  type: string;
  soldeCourant: number;
}

interface Reconciliation {
  id: string;
  declaredBalance: number | string;
  discrepancy: number | string;
  status: 'pending' | 'resolue';
  createdAt: string;
}

function n(v: number | string): number {
  return typeof v === 'number' ? v : Number(v);
}

/**
 * Détail d'un compte (Lot 1 — recette) : rapprochement (constater un écart entre
 * le solde déclaré et le solde calculé), ajustement (corriger explicitement,
 * jamais automatiquement — RG-083), et transfert vers un autre compte.
 */
export function AccountDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const accountId = route.params?.id as string;

  const [account, setAccount] = useState<Account | null>(null);
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [otherAccounts, setOtherAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const [declaredBalance, setDeclaredBalance] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  const [adjustReason, setAdjustReason] = useState('');
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, recon] = await Promise.all([api.listAccounts(), api.listReconciliations(accountId)]);
      const found = all.find((a: Account) => a.id === accountId) ?? null;
      setAccount(found);
      setOtherAccounts(all.filter((a: Account) => a.id !== accountId));
      setReconciliations(recon);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onReconcile() {
    setReconcileError(null);
    const value = Number(declaredBalance.replace(',', '.'));
    if (Number.isNaN(value)) {
      setReconcileError('Solde constaté invalide');
      return;
    }
    setReconciling(true);
    try {
      await api.createReconciliation(accountId, { declaredBalance: value });
      setDeclaredBalance('');
      await load();
    } catch (err) {
      setReconcileError(err instanceof api.ApiError ? err.message : 'Rapprochement impossible');
    } finally {
      setReconciling(false);
    }
  }

  async function onAdjust(reconciliationId: string) {
    setAdjustError(null);
    setAdjustingId(reconciliationId);
    try {
      await api.adjustReconciliation(accountId, reconciliationId, adjustReason.trim() ? { reason: adjustReason.trim() } : {});
      setAdjustReason('');
      await load();
    } catch (err) {
      setAdjustError(err instanceof api.ApiError ? err.message : 'Ajustement impossible');
    } finally {
      setAdjustingId(null);
    }
  }

  async function onTransfer() {
    setTransferError(null);
    const value = Number(transferAmount.replace(',', '.'));
    if (!toAccountId) {
      setTransferError('Choisissez un compte destination');
      return;
    }
    if (!value || value <= 0) {
      setTransferError('Montant invalide');
      return;
    }
    setTransferring(true);
    try {
      await api.createTransfer({ fromAccountId: accountId, toAccountId, amount: value });
      setTransferAmount('');
      await load();
    } catch (err) {
      setTransferError(err instanceof api.ApiError ? err.message : 'Transfert impossible');
    } finally {
      setTransferring(false);
    }
  }

  if (loading && !account) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!account) return null;

  const pendingReconciliation = reconciliations.find((r) => r.status === 'pending' && n(r.discrepancy) !== 0);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}>
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>{account.name}</Text>
          <Text style={styles.heroValue}>{account.soldeCourant.toLocaleString('fr-FR')} DH</Text>
        </View>

        <Text style={styles.sectionTitle}>Rapprochement</Text>
        <Text style={styles.help}>Saisissez le solde constaté (ex. sur votre relevé bancaire) pour vérifier s'il correspond au solde calculé.</Text>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder="Solde constaté (DH)"
            keyboardType="decimal-pad"
            value={declaredBalance}
            onChangeText={setDeclaredBalance}
          />
          <TouchableOpacity style={styles.button} onPress={onReconcile} disabled={reconciling}>
            {reconciling ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Vérifier</Text>}
          </TouchableOpacity>
        </View>
        {reconcileError ? <Text style={styles.error}>{reconcileError}</Text> : null}

        {reconciliations.map((r) => (
          <View key={r.id} style={styles.card}>
            <Text style={styles.cardTitle}>Solde constaté : {n(r.declaredBalance).toLocaleString('fr-FR')} DH</Text>
            <Text style={styles.cardMeta}>
              Écart : {n(r.discrepancy).toLocaleString('fr-FR')} DH · {r.status === 'resolue' ? 'Résolu' : 'En attente'}
            </Text>
            {r.status === 'pending' && n(r.discrepancy) !== 0 && (
              <View style={styles.adjustBox}>
                <TextInput
                  style={styles.input}
                  placeholder="Raison (facultatif, ex. Frais bancaires)"
                  value={pendingReconciliation?.id === r.id ? adjustReason : ''}
                  onChangeText={setAdjustReason}
                />
                <TouchableOpacity style={styles.buttonSecondary} onPress={() => onAdjust(r.id)} disabled={adjustingId === r.id}>
                  {adjustingId === r.id ? (
                    <ActivityIndicator color="#172436" />
                  ) : (
                    <Text style={styles.buttonSecondaryText}>Ajuster le solde à {n(r.declaredBalance).toLocaleString('fr-FR')} DH</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
        {adjustError ? <Text style={styles.error}>{adjustError}</Text> : null}

        <Text style={styles.sectionTitle}>Transfert vers un autre compte</Text>
        {otherAccounts.length === 0 ? (
          <Text style={styles.help}>Créez un second compte pour pouvoir y transférer de l'argent.</Text>
        ) : (
          <>
            <View style={styles.chipRow}>
              {otherAccounts.map((a) => (
                <TouchableOpacity
                  key={a.id}
                  style={[styles.chip, toAccountId === a.id && styles.chipActive]}
                  onPress={() => setToAccountId(a.id)}
                >
                  <Text style={[styles.chipText, toAccountId === a.id && styles.chipTextActive]}>{a.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Montant (DH)"
                keyboardType="decimal-pad"
                value={transferAmount}
                onChangeText={setTransferAmount}
              />
              <TouchableOpacity style={styles.button} onPress={onTransfer} disabled={transferring}>
                {transferring ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Transférer</Text>}
              </TouchableOpacity>
            </View>
            {transferError ? <Text style={styles.error}>{transferError}</Text> : null}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5F2' },
  scroll: { padding: 20 },
  heroCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18, marginBottom: 20 },
  heroLabel: { fontSize: 13, color: '#6B747C', fontWeight: '600' },
  heroValue: { fontSize: 28, fontWeight: '800', color: '#172436', marginTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#172436', marginTop: 12, marginBottom: 6 },
  help: { fontSize: 12, color: '#6B747C', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#E3E1DC',
    marginRight: 8,
    marginBottom: 8,
  },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  buttonSecondary: { backgroundColor: '#EEF0F3', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  buttonSecondaryText: { color: '#172436', fontWeight: '600', fontSize: 12 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#E3E1DC' },
  cardTitle: { fontSize: 13, fontWeight: '700', color: '#172436' },
  cardMeta: { fontSize: 12, color: '#6B747C', marginTop: 2 },
  adjustBox: { marginTop: 10 },
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
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8 },
});
