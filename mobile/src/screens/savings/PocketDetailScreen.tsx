import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';

interface Movement {
  id: string;
  status: 'prevu' | 'confirme' | 'en_retard' | 'annule';
  movementType: 'contribution' | 'retrait';
  plannedAmount: number;
  plannedDate: string;
  intentionLabel: string | null;
}

interface CoverageItem {
  deadlineId: string;
  dueDate: string;
  resteAPayer: number;
  coverageAffectee: number;
  engagementNonCouvert: number;
}

interface PocketDetail {
  id: string;
  name: string;
  allocationMode: 'virtual_allocation' | 'backed_by_account';
  currentAmount: number;
  isProtected?: boolean;
  targetAmount?: number | null;
  coverage?: CoverageItem[];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

/**
 * Fiche poche/provision (§27/§20) — solde dérivé, jamais un compte. Pour une
 * Provision, affiche aussi la couverture chronologique (RG-090) et permet de
 * payer une échéance couverte directement depuis la provision (§18-20).
 */
export function PocketDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const kind = route.params?.kind as 'pocket' | 'provision';
  const id = route.params?.id as string;
  const isProvision = kind === 'provision';

  const [detail, setDetail] = useState<PocketDetail | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [intentionLabel, setIntentionLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payingDeadlineId, setPayingDeadlineId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [payAccountId, setPayAccountId] = useState<string | null>(null);
  const [linkDeadlineId, setLinkDeadlineId] = useState('');
  const [openDeadlines, setOpenDeadlines] = useState<{ id: string; chargePlan: { label: string }; dueDate: string }[]>([]);
  const [linking, setLinking] = useState(false);
  const [confirmingMovementId, setConfirmingMovementId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = isProvision ? await api.getProvision(id) : await api.getPocket(id);
      setDetail(d);
      setMovements(isProvision ? await api.listProvisionMovements(id) : await api.listPocketMovements(id));
      if (isProvision) {
        const [accs, open] = await Promise.all([api.listAccounts(), api.listOpenDeadlines()]);
        setAccounts(accs);
        setOpenDeadlines(open);
        if (!payAccountId && accs.length) setPayAccountId(d.allocationMode === 'backed_by_account' ? d.linkedAccountId ?? accs[0].id : accs[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [id, isProvision]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onContribute() {
    setError(null);
    const value = Number(amount.replace(',', '.'));
    if (!value || value <= 0) {
      setError('Montant invalide');
      return;
    }
    setSubmitting(true);
    try {
      if (isProvision) await api.contributeProvision(id, { amount: value, intentionLabel: intentionLabel || undefined });
      else await api.contributePocket(id, { amount: value, intentionLabel: intentionLabel || undefined });
      setAmount('');
      setIntentionLabel('');
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Impossible de mettre de côté');
    } finally {
      setSubmitting(false);
    }
  }

  async function onWithdraw() {
    setError(null);
    const value = Number(amount.replace(',', '.'));
    if (!value || value <= 0) {
      setError('Montant invalide');
      return;
    }
    setSubmitting(true);
    try {
      if (isProvision) await api.withdrawProvision(id, { amount: value });
      else await api.withdrawPocket(id, { amount: value });
      setAmount('');
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Retrait impossible');
    } finally {
      setSubmitting(false);
    }
  }

  async function onLinkDeadline() {
    if (!linkDeadlineId || linking) return;
    setError(null);
    setLinking(true);
    try {
      await api.linkProvisionDeadline(id, linkDeadlineId);
      setLinkDeadlineId('');
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Liaison impossible');
    } finally {
      setLinking(false);
    }
  }

  async function onConfirmMovement(movementId: string) {
    if (confirmingMovementId) return;
    setConfirmingMovementId(movementId);
    try {
      if (isProvision) await api.confirmProvisionMovement(movementId);
      else await api.confirmPocketMovement(movementId);
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Confirmation impossible');
    } finally {
      setConfirmingMovementId(null);
    }
  }

  async function onPayWithProvision(deadlineId: string) {
    setError(null);
    const value = Number(payAmount.replace(',', '.'));
    if (!value || value <= 0 || !payAccountId) {
      setError('Montant ou compte invalide');
      return;
    }
    setSubmitting(true);
    try {
      await api.payDeadlineWithProvision(deadlineId, { amount: value, accountId: payAccountId, provisionId: id });
      setPayingDeadlineId(null);
      setPayAmount('');
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Paiement impossible — provision insuffisante ?');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !detail) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{detail.name}</Text>
        {detail.isProtected && <Text style={styles.protectedBadge}>Protégée</Text>}
      </View>
      <Text style={styles.amount}>{detail.currentAmount.toLocaleString('fr-FR')} DH</Text>
      {detail.targetAmount ? <Text style={styles.subtitle}>Objectif : {detail.targetAmount.toLocaleString('fr-FR')} DH</Text> : null}
      <Text style={styles.subtitle}>{detail.allocationMode === 'backed_by_account' ? 'Compte dédié' : 'Réservation virtuelle — reste sur votre compte'}</Text>

      {detail.allocationMode === 'virtual_allocation' ? (
        <View style={styles.formCard}>
          <TextInput style={styles.input} placeholder="Montant (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <TextInput style={styles.input} placeholder="Intention (facultatif)" value={intentionLabel} onChangeText={setIntentionLabel} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.button, styles.buttonHalf]} onPress={onContribute} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>+ Mettre de côté</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.buttonHalf, styles.buttonSecondary]} onPress={onWithdraw} disabled={submitting}>
              <Text style={[styles.buttonText, styles.buttonTextSecondary]}>Retirer</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <Text style={styles.help}>Utilisez un virement (écran Comptes) vers le compte dédié pour faire grandir cette provision — jamais une simple écriture logique.</Text>
      )}

      {isProvision && (
        <>
          <Text style={styles.sectionTitle}>Échéances liées</Text>
          <View style={styles.linkRow}>
            <TextInput style={[styles.input, styles.linkInput]} placeholder="ID de l'échéance à lier" value={linkDeadlineId} onChangeText={setLinkDeadlineId} />
            <TouchableOpacity style={styles.linkButton} onPress={onLinkDeadline} disabled={linking}>
              {linking ? <ActivityIndicator color="#fff" /> : <Text style={styles.linkButtonText}>Lier</Text>}
            </TouchableOpacity>
          </View>
          {openDeadlines.length > 0 && (
            <View style={styles.chipRow}>
              {openDeadlines.slice(0, 6).map((d) => (
                <TouchableOpacity key={d.id} style={styles.chip} onPress={() => setLinkDeadlineId(d.id)}>
                  <Text style={styles.chipText}>{d.chargePlan.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {(detail.coverage ?? []).map((c) => (
            <View key={c.deadlineId} style={styles.coverageCard}>
              <Text style={styles.coverageDate}>Échéance du {formatDate(c.dueDate)}</Text>
              <Text style={styles.coverageLine}>Reste à payer : {c.resteAPayer.toLocaleString('fr-FR')} DH</Text>
              <Text style={styles.coverageLine}>Couvert : {c.coverageAffectee.toLocaleString('fr-FR')} DH</Text>
              <Text style={[styles.coverageLine, c.engagementNonCouvert > 0 && styles.coverageWarning]}>
                Encore à couvrir : {c.engagementNonCouvert.toLocaleString('fr-FR')} DH
              </Text>

              {payingDeadlineId === c.deadlineId ? (
                <View style={styles.payForm}>
                  <TextInput style={styles.input} placeholder="Montant (DH)" keyboardType="decimal-pad" value={payAmount} onChangeText={setPayAmount} />
                  <View style={styles.chipRow}>
                    {accounts.map((a) => (
                      <TouchableOpacity key={a.id} style={[styles.chip, payAccountId === a.id && styles.chipActive]} onPress={() => setPayAccountId(a.id)}>
                        <Text style={[styles.chipText, payAccountId === a.id && styles.chipTextActive]}>{a.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity style={styles.button} onPress={() => onPayWithProvision(c.deadlineId)} disabled={submitting}>
                    {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Confirmer le paiement</Text>}
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.payLink}
                  onPress={() => {
                    setPayingDeadlineId(c.deadlineId);
                    setPayAmount(String(Math.min(c.coverageAffectee, c.resteAPayer)));
                  }}
                >
                  <Text style={styles.payLinkText}>Payer avec cette Provision</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </>
      )}

      <Text style={styles.sectionTitle}>Mouvements</Text>
      <FlatList
        data={movements}
        keyExtractor={(m) => m.id}
        scrollEnabled={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={<Text style={styles.empty}>Aucun mouvement pour l'instant.</Text>}
        renderItem={({ item }) => (
          <View style={styles.movementRow}>
            <View>
              <Text style={styles.movementLabel}>
                {item.movementType === 'contribution' ? 'Contribution' : 'Retrait'} · {formatDate(item.plannedDate)}
                {item.status === 'prevu' ? ' (prévue)' : ''}
              </Text>
              {item.intentionLabel ? <Text style={styles.movementIntention}>{item.intentionLabel}</Text> : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.movementAmount, item.movementType === 'retrait' && styles.movementAmountNegative]}>
                {item.movementType === 'contribution' ? '+' : '-'}
                {item.plannedAmount.toLocaleString('fr-FR')} DH
              </Text>
              {item.status === 'prevu' && (
                <TouchableOpacity onPress={() => onConfirmMovement(item.id)} disabled={confirmingMovementId === item.id}>
                  {confirmingMovementId === item.id ? <ActivityIndicator size="small" /> : <Text style={styles.confirmLink}>Confirmer</Text>}
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      />

      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.cancel}>Retour</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5F2' },
  scroll: { padding: 20, paddingTop: 24 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '700', color: '#172436' },
  protectedBadge: { fontSize: 10, fontWeight: '700', color: '#2E7D5B', backgroundColor: '#E6F2EC', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  amount: { fontSize: 28, fontWeight: '800', color: '#172436', marginTop: 8 },
  subtitle: { fontSize: 12, color: '#6B747C', marginTop: 4 },
  help: { fontSize: 12, color: '#6B747C', marginTop: 12, fontStyle: 'italic' },
  formCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 16 },
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
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  buttonHalf: { flex: 1, marginRight: 8 },
  buttonSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#172436', marginRight: 0 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  buttonTextSecondary: { color: '#172436' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#172436', marginTop: 24, marginBottom: 10 },
  linkRow: { flexDirection: 'row', marginBottom: 8 },
  linkInput: { flex: 1, marginRight: 8, marginBottom: 0 },
  linkButton: { backgroundColor: '#172436', borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  linkButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  chip: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  chipActive: { backgroundColor: '#172436', borderColor: '#172436' },
  chipText: { fontSize: 12, color: '#172436' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  coverageCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10 },
  coverageDate: { fontSize: 13, fontWeight: '700', color: '#172436', marginBottom: 4 },
  coverageLine: { fontSize: 12, color: '#6B747C', marginTop: 2 },
  coverageWarning: { color: '#B8860B', fontWeight: '600' },
  payLink: { marginTop: 8 },
  payLinkText: { color: '#2E7D5B', fontSize: 12, fontWeight: '700' },
  payForm: { marginTop: 10 },
  empty: { color: '#6B747C', fontSize: 13 },
  movementRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  movementLabel: { fontSize: 12, color: '#172436', fontWeight: '600' },
  movementIntention: { fontSize: 11, color: '#6B747C', marginTop: 2, fontStyle: 'italic' },
  movementAmount: { fontSize: 13, fontWeight: '700', color: '#2E7D5B' },
  movementAmountNegative: { color: '#B3261E' },
  confirmLink: { color: '#172436', fontSize: 11, fontWeight: '600', marginTop: 4 },
  cancel: { color: '#6B747C', textAlign: 'center', marginTop: 16, fontSize: 13, marginBottom: 24 },
  error: { color: '#B3261E', fontSize: 12, marginBottom: 8 },
});
