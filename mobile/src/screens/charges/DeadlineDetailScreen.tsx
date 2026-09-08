import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { FormField } from '../../ui/FormField';
import { Select } from '../../ui/Select';
import { colors, elevation, radius, spacing } from '../../ui/theme';

interface Deadline {
  id: string;
  dueDate: string;
  amountCurrent: number | string | null;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  financialStatus: 'ouverte' | 'partiellement_payee' | 'soldee' | 'annulee';
  resteAPayer: number | string | null;
  provisionId: string | null;
  chargePlan: { label: string };
}

interface Payment {
  id: string;
  amount: number | string;
  paidDate: string;
  type: string;
  accountId: string;
  provisionId: string | null;
}

interface Account {
  id: string;
  name: string;
  soldeCourant: number;
}

interface Provision {
  id: string;
  name: string;
  allocationMode: 'virtual_allocation' | 'backed_by_account';
  linkedAccountId: string | null;
  currentAmount: number | string;
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

/**
 * Détail d'une échéance — parcours de paiement UNIQUE de l'app (R6 clôture §5) :
 * confirmer, payer (total/partiel), clôturer, annuler. Aucune ambiguïté sur ce
 * qui va se produire — le récapitulatif (solde actuel → solde après paiement,
 * reste à payer après opération) est toujours affiché AVANT confirmation,
 * recalculé en direct, jamais après coup.
 */
export function DeadlineDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const id = route.params?.id as string;

  const [deadline, setDeadline] = useState<Deadline | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [provision, setProvision] = useState<Provision | null>(null);
  const [loading, setLoading] = useState(true);

  const [confirmAmount, setConfirmAmount] = useState('');
  const [confirming, setConfirming] = useState(false);

  const [fundingSource, setFundingSource] = useState<'compte' | 'provision'>('compte');
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
      if (d.amountCurrent !== null) setConfirmAmount(String(n(d.amountCurrent)));

      if (d.provisionId) {
        const prov: Provision = await api.getProvision(d.provisionId);
        setProvision(prov);
        setFundingSource('provision');
        setPayAccountId((current) =>
          prov.allocationMode === 'backed_by_account' ? prov.linkedAccountId : current ?? prov.linkedAccountId ?? accountList[0]?.id ?? null,
        );
      } else {
        setProvision(null);
        setFundingSource('compte');
        setPayAccountId((current) => current ?? accountList[0]?.id ?? null);
      }
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
    if (fundingSource === 'provision' && provision) {
      const available = n(provision.currentAmount) ?? 0;
      if (value > available) {
        setError(`Enveloppe insuffisante : ${available.toLocaleString('fr-FR')} DH disponibles dans « ${provision.name} »`);
        return;
      }
    }
    setPaying(true);
    try {
      if (fundingSource === 'provision' && provision) {
        await api.payDeadlineWithProvision(id, { amount: value, accountId: payAccountId, provisionId: provision.id, paidDate: todayIso() });
      } else {
        await api.createPayment(id, { amount: value, accountId: payAccountId, paidDate: todayIso() });
      }
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

  const payValue = Number(payAmount.replace(',', '.'));
  const payAccount = accounts.find((a) => a.id === payAccountId) ?? null;
  const showRecap = isOpen && accounts.length > 0 && !!payAccount && !!payValue && payValue > 0;
  const soldeApres = payAccount ? payAccount.soldeCourant - payValue : null;
  const resteApresOperation = resteAPayer !== null ? Math.max(0, Math.round((resteAPayer - payValue) * 100) / 100) : null;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>{deadline.chargePlan.label}</Text>
          <Text style={styles.heroMeta}>Échéance du {formatDate(deadline.dueDate)}</Text>
          <Text style={styles.heroStatus}>{STATUS_LABEL[deadline.financialStatus]}</Text>
          <Text style={styles.heroAmountLabel}>Montant restant</Text>
          <Text style={styles.heroAmount}>{resteAPayer !== null ? `${resteAPayer.toLocaleString('fr-FR')} DH` : 'À confirmer'}</Text>
        </View>

        {isOpen && deadline.amountStatus !== 'confirme' && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Confirmer la facture</Text>
            <FormField
              testID="confirm-amount-input"
              label="Montant réel"
              placeholder="Montant réel (DH)"
              keyboardType="decimal-pad"
              value={confirmAmount}
              onChangeText={setConfirmAmount}
              onFocus={handleFocus}
            />
            <TouchableOpacity style={styles.button} onPress={onConfirmBilling} disabled={confirming}>
              {confirming ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Confirmer</Text>}
            </TouchableOpacity>
          </View>
        )}

        {isOpen && accounts.length === 0 && (
          <View style={styles.noAccountCard}>
            <Text style={styles.noAccountText}>Vous devez d'abord ajouter un compte pour enregistrer ce paiement.</Text>
            <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('QuickCreateAccount')}>
              <Text style={styles.buttonText}>Ajouter un compte</Text>
            </TouchableOpacity>
          </View>
        )}

        {isOpen && accounts.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Payer (total ou partiel)</Text>

            {provision && (
              <>
                <View style={styles.segment}>
                  <TouchableOpacity
                    style={[styles.segmentItem, fundingSource === 'provision' && styles.segmentActive]}
                    onPress={() => {
                      setFundingSource('provision');
                      setPayAccountId(provision.allocationMode === 'backed_by_account' ? provision.linkedAccountId : payAccountId ?? provision.linkedAccountId ?? accounts[0]?.id ?? null);
                    }}
                  >
                    <Text style={[styles.segmentText, fundingSource === 'provision' && styles.segmentTextActive]}>Utiliser l'enveloppe « {provision.name} »</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.segmentItem, fundingSource === 'compte' && styles.segmentActive]}
                    onPress={() => setFundingSource('compte')}
                  >
                    <Text style={[styles.segmentText, fundingSource === 'compte' && styles.segmentTextActive]}>Payer sans utiliser l'enveloppe</Text>
                  </TouchableOpacity>
                </View>
                {fundingSource === 'provision' && (
                  <Text style={styles.help}>
                    Disponible dans cette enveloppe : {(n(provision.currentAmount) ?? 0).toLocaleString('fr-FR')} DH.
                    {provision.allocationMode === 'backed_by_account'
                      ? ' Cette enveloppe est un compte dédié : le compte à débiter est imposé.'
                      : ' Choisissez le compte réel qui enregistre ce paiement.'}
                  </Text>
                )}
              </>
            )}

            {(fundingSource === 'compte' || !provision || provision.allocationMode !== 'backed_by_account') && (
              <Select
                testID="deadline-pay-account-select"
                label="Compte débité"
                placeholder="Choisir un compte"
                value={payAccountId}
                onChange={setPayAccountId}
                options={accounts.map((a) => ({ value: a.id, label: a.name, sublabel: `${a.soldeCourant.toLocaleString('fr-FR')} DH` }))}
              />
            )}
            {fundingSource === 'provision' && provision?.allocationMode === 'backed_by_account' && (
              <Text style={styles.help}>Compte débité : {payAccount?.name ?? '—'}</Text>
            )}

            <FormField
              testID="deadline-pay-amount-input"
              label="Montant à payer"
              placeholder="Montant (DH)"
              keyboardType="decimal-pad"
              value={payAmount}
              onChangeText={setPayAmount}
              onFocus={handleFocus}
            />

            {showRecap && (
              <View style={styles.recapCard} testID="payment-recap">
                <Text style={styles.recapTitle}>RÉCAPITULATIF</Text>
                <View style={styles.recapRow}>
                  <Text style={styles.recapLabel}>Montant payé</Text>
                  <Text style={styles.recapValue}>{payValue.toLocaleString('fr-FR')} DH</Text>
                </View>
                <View style={styles.recapRow}>
                  <Text style={styles.recapLabel}>Compte</Text>
                  <Text style={styles.recapValue}>{payAccount!.name}</Text>
                </View>
                <View style={styles.recapRow}>
                  <Text style={styles.recapLabel}>Solde actuel</Text>
                  <Text style={styles.recapValue}>{payAccount!.soldeCourant.toLocaleString('fr-FR')} DH</Text>
                </View>
                <View style={styles.recapRow}>
                  <Text style={styles.recapLabel}>Solde après paiement</Text>
                  <Text style={[styles.recapValue, soldeApres !== null && soldeApres < 0 && styles.recapValueNegative]}>
                    {soldeApres !== null ? soldeApres.toLocaleString('fr-FR') : '—'} DH
                  </Text>
                </View>
                <View style={[styles.recapRow, styles.recapRowLast]}>
                  <Text style={styles.recapLabel}>Reste à payer après opération</Text>
                  <Text style={[styles.recapValue, resteApresOperation !== null && resteApresOperation > 0 && styles.recapValueWarning]}>
                    {resteApresOperation !== null ? resteApresOperation.toLocaleString('fr-FR') : '—'} DH
                  </Text>
                </View>
                {resteApresOperation !== null && resteApresOperation > 0 && (
                  <Text style={styles.recapPartialNote}>Paiement partiel — il restera {resteApresOperation.toLocaleString('fr-FR')} DH à payer.</Text>
                )}
              </View>
            )}

            <TouchableOpacity style={styles.buttonConfirm} onPress={onPay} disabled={paying || !showRecap}>
              {paying ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonConfirmText}>CONFIRMER LE PAIEMENT</Text>}
            </TouchableOpacity>
          </View>
        )}

        {payments.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Paiements enregistrés</Text>
            {payments.map((p) => (
              <View key={p.id} style={styles.paymentRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentText}>{formatDate(p.paidDate)}</Text>
                  <Text style={styles.paymentMeta}>
                    Compte {accounts.find((a) => a.id === p.accountId)?.name ?? '—'}
                    {p.provisionId && provision?.id === p.provisionId ? ` · Enveloppe ${provision.name}` : ''}
                  </Text>
                </View>
                <Text style={styles.paymentAmount}>{n(p.amount)?.toLocaleString('fr-FR')} DH</Text>
              </View>
            ))}
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {isOpen && (
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.buttonSecondary} onPress={onClose} disabled={closing}>
              {closing ? <ActivityIndicator color={colors.textPrimary} /> : <Text style={styles.buttonSecondaryText}>Clôturer</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.buttonDanger} onPress={onCancel} disabled={cancelling}>
              {cancelling ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.buttonDangerText}>Annuler l'échéance</Text>}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  scroll: { padding: spacing.xl },
  heroCard: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.md },
  heroLabel: { fontSize: 16, fontWeight: '700', color: colors.textOnPrimary },
  heroMeta: { fontSize: 12, color: '#C9D2E0', marginTop: 4 },
  heroStatus: { fontSize: 11, fontWeight: '700', color: '#C9D2E0', marginTop: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroAmountLabel: { fontSize: 11, color: '#C9D2E0', marginTop: spacing.sm },
  heroAmount: { fontSize: 26, fontWeight: '800', color: colors.textOnPrimary, marginTop: 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.raised,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  noAccountCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  noAccountText: { fontSize: 13, color: colors.textPrimary, marginBottom: spacing.md },
  help: { fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm, fontStyle: 'italic' },
  segment: { flexDirection: 'row', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, marginBottom: spacing.sm },
  segmentItem: { flex: 1, paddingVertical: 10, paddingHorizontal: 4, borderRadius: radius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { fontSize: 11, color: colors.textSecondary, fontWeight: '600', textAlign: 'center' },
  segmentTextActive: { color: colors.textPrimary },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  recapCard: { backgroundColor: colors.background, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.xs, marginBottom: spacing.md },
  recapTitle: { fontSize: 10, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5, marginBottom: spacing.sm },
  recapRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider },
  recapRowLast: { borderBottomWidth: 0 },
  recapLabel: { fontSize: 12, color: colors.textSecondary },
  recapValue: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  recapValueNegative: { color: colors.danger },
  recapValueWarning: { color: colors.warning },
  recapPartialNote: { fontSize: 11, color: colors.warning, fontWeight: '600', marginTop: spacing.sm, fontStyle: 'italic' },
  buttonConfirm: { backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  buttonConfirmText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14, letterSpacing: 0.3 },
  paymentRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  paymentText: { fontSize: 12, color: colors.textSecondary },
  paymentMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  paymentAmount: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  actionsRow: { flexDirection: 'row', marginTop: spacing.sm, justifyContent: 'space-between' },
  buttonSecondary: { flex: 1, backgroundColor: colors.surfaceActive, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginRight: spacing.sm },
  buttonSecondaryText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  buttonDanger: { flex: 1, backgroundColor: colors.dangerLight, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  buttonDangerText: { color: colors.danger, fontWeight: '600', fontSize: 13 },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm, marginTop: spacing.sm },
});
