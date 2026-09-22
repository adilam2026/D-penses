import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { DateField } from '../../ui/DateField';
import { FormField } from '../../ui/FormField';
import { Select } from '../../ui/Select';
import { TEMPORAL_STATUS_LABEL, temporalStatus, temporalStatusColor } from '../../ui/temporalStatus';
import { PageHeader } from '../../web/ui/PageHeader.web';
import { TwoColumnLayout } from '../../web/ui/TwoColumnLayout.web';
import { MAX_CONTENT_WIDTH, webColors, webRadius, webSpacing } from '../../web/webTheme';
import { AMOUNT_STATUS_OPTIONS, Account, Deadline, Payment, Provision, STATUS_LABEL, formatDate, n, todayIso } from './deadlineDetailLogic';

/**
 * Portail Web v4 (WEB-V4.4A) — DeadlineDetail desktop : synthèse à gauche
 * (statut, montant restant, historique des paiements en table dense) ;
 * panneau d'action sticky à droite avec, avant toute confirmation, un
 * récapitulatif toujours visible (montant payé / reste avant / reste après /
 * compte ou enveloppe) ; clôture/annulation dans un bloc séparé en bas du
 * panneau. Mêmes endpoints/règles que mobile (parcours de paiement unique).
 */
export function DeadlineDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const id = route.params?.id as string;

  const [deadline, setDeadline] = useState<Deadline | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [provision, setProvision] = useState<Provision | null>(null);
  const [loading, setLoading] = useState(true);
  const [seuilAPayerDays, setSeuilAPayerDays] = useState(7);

  const [confirmAmount, setConfirmAmount] = useState('');
  const [confirming, setConfirming] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editDueDate, setEditDueDate] = useState('');
  const [editAmountStatus, setEditAmountStatus] = useState<'confirme' | 'estime' | 'inconnu'>('confirme');
  const [editAmount, setEditAmount] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
      const [d, p, accountList, household] = await Promise.all([
        api.getDeadline(id),
        api.listPayments(id),
        api.listAccounts(),
        api.getMyHousehold(),
      ]);
      setDeadline(d);
      setPayments(p);
      setAccounts(accountList);
      setSeuilAPayerDays(household?.settings?.seuilAPayerDays ?? 7);
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

  function openEdit() {
    if (!deadline) return;
    setEditDueDate(deadline.dueDate.slice(0, 10));
    setEditAmountStatus(deadline.amountStatus);
    setEditAmount(deadline.amountCurrent !== null ? String(n(deadline.amountCurrent)) : '');
    setEditError(null);
    setEditOpen(true);
  }

  async function onSaveEdit() {
    if (!editDueDate) {
      setEditError('La date est obligatoire');
      return;
    }
    if (editAmountStatus !== 'inconnu' && (!editAmount.trim() || Number(editAmount.replace(',', '.')) <= 0)) {
      setEditError('Montant invalide');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await api.updateDeadline(id, {
        dueDate: editDueDate,
        amountStatus: editAmountStatus,
        amountCurrent: editAmountStatus !== 'inconnu' ? Number(editAmount.replace(',', '.')) : undefined,
      });
      setEditOpen(false);
      await load();
    } catch (err) {
      setEditError(err instanceof api.ApiError ? err.message : 'Modification impossible');
    } finally {
      setEditSaving(false);
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
  const isClosed = deadline.financialStatus === 'soldee' || deadline.financialStatus === 'annulee';
  const temporal = temporalStatus(deadline.dueDate, seuilAPayerDays, isClosed);

  const payValue = Number(payAmount.replace(',', '.'));
  const payAccount = accounts.find((a) => a.id === payAccountId) ?? null;
  const showRecap = isOpen && accounts.length > 0 && !!payAccount && !!payValue && payValue > 0;
  const soldeApres = payAccount ? payAccount.soldeCourant - payValue : null;
  const resteApresOperation = resteAPayer !== null ? Math.max(0, Math.round((resteAPayer - payValue) * 100) / 100) : null;

  const mainContent = (
    <>
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <Text style={styles.heroLabel}>{deadline.chargePlan.label}</Text>
          <TouchableOpacity testID="web-deadline-chargeplan-link" onPress={() => navigation.navigate('ChargePlanDetail', { id: deadline.chargePlanId })}>
            <Text style={styles.heroChargePlanLink}>Modifier le libellé / la catégorie →</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.heroMeta}>Échéance du {formatDate(deadline.dueDate)}</Text>
        <View style={styles.heroStatusRow}>
          <Text style={styles.heroStatus}>{STATUS_LABEL[deadline.financialStatus]}</Text>
          {temporal && (
            <Text testID="web-deadline-temporal-badge" style={[styles.heroTemporalBadge, { color: temporalStatusColor(temporal) }]}>
              {TEMPORAL_STATUS_LABEL[temporal]}
            </Text>
          )}
        </View>
        <Text style={styles.heroAmountLabel}>Montant restant</Text>
        <Text style={styles.heroAmount}>{resteAPayer !== null ? `${resteAPayer.toLocaleString('fr-FR')} DH` : 'À confirmer'}</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.sectionTitle}>Paiements enregistrés</Text>
      {payments.length === 0 ? (
        <Text style={styles.empty}>Aucun paiement enregistré pour l'instant.</Text>
      ) : (
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.th, styles.colDate]}>Date</Text>
            <Text style={[styles.th, styles.colAccount]}>Compte / Enveloppe</Text>
            <Text style={[styles.th, styles.colAmount]}>Montant</Text>
          </View>
          {payments.map((p) => (
            <TouchableOpacity
              key={p.id}
              testID={`web-deadline-payment-row-${p.id}`}
              style={styles.tableRow}
              onPress={() => navigation.navigate('TransactionDetail', { kind: 'payment', id: p.id })}
            >
              <Text style={[styles.td, styles.colDate]}>{formatDate(p.paidDate)}</Text>
              <Text style={[styles.td, styles.colAccount]}>
                {accounts.find((a) => a.id === p.accountId)?.name ?? '—'}
                {p.provisionId && provision?.id === p.provisionId ? ` · ${provision.name}` : ''}
              </Text>
              <Text style={[styles.td, styles.colAmount]}>{n(p.amount)?.toLocaleString('fr-FR')} DH</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </>
  );

  const panel = (
    <View style={{ gap: webSpacing.md }}>
      {isOpen && deadline.amountStatus !== 'confirme' && (
        <View style={styles.panelCard}>
          <Text style={styles.panelTitle}>Confirmer la facture</Text>
          <FormField testID="web-confirm-amount-input" label="Montant réel" placeholder="Montant réel (DH)" keyboardType="decimal-pad" value={confirmAmount} onChangeText={setConfirmAmount} />
          <TouchableOpacity style={styles.button} onPress={onConfirmBilling} disabled={confirming}>
            {confirming ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.buttonText}>Confirmer</Text>}
          </TouchableOpacity>
        </View>
      )}

      {isOpen && accounts.length === 0 && (
        <View style={styles.panelCard}>
          <Text style={styles.help}>Vous devez d'abord ajouter un compte pour enregistrer ce paiement.</Text>
          <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('QuickCreateAccount')}>
            <Text style={styles.buttonText}>Ajouter un compte</Text>
          </TouchableOpacity>
        </View>
      )}

      {isOpen && accounts.length > 0 && (
        <View style={styles.panelCard}>
          <Text style={styles.panelTitle}>Payer (total ou partiel)</Text>

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
                  <Text style={[styles.segmentText, fundingSource === 'provision' && styles.segmentTextActive]}>Enveloppe « {provision.name} »</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.segmentItem, fundingSource === 'compte' && styles.segmentActive]} onPress={() => setFundingSource('compte')}>
                  <Text style={[styles.segmentText, fundingSource === 'compte' && styles.segmentTextActive]}>Sans l'enveloppe</Text>
                </TouchableOpacity>
              </View>
              {fundingSource === 'provision' && (
                <Text style={styles.help}>
                  Disponible : {(n(provision.currentAmount) ?? 0).toLocaleString('fr-FR')} DH.
                  {provision.allocationMode === 'backed_by_account' ? ' Compte imposé.' : ' Choisissez le compte réel.'}
                </Text>
              )}
            </>
          )}

          {(fundingSource === 'compte' || !provision || provision.allocationMode !== 'backed_by_account') && (
            <Select
              testID="web-deadline-pay-account-select"
              label="Compte débité"
              placeholder="Choisir un compte"
              value={payAccountId}
              onChange={setPayAccountId}
              options={accounts.map((a) => ({ value: a.id, label: a.name, sublabel: `${a.soldeCourant.toLocaleString('fr-FR')} DH` }))}
            />
          )}
          {fundingSource === 'provision' && provision?.allocationMode === 'backed_by_account' && <Text style={styles.help}>Compte débité : {payAccount?.name ?? '—'}</Text>}

          <FormField testID="web-deadline-pay-amount-input" label="Montant à payer" placeholder="Montant (DH)" keyboardType="decimal-pad" value={payAmount} onChangeText={setPayAmount} />

          {showRecap && (
            <View style={styles.recapCard} testID="web-payment-recap">
              <Text style={styles.recapTitle}>RÉCAPITULATIF</Text>
              <View style={styles.recapRow}>
                <Text style={styles.recapLabel}>Montant payé</Text>
                <Text style={styles.recapValue}>{payValue.toLocaleString('fr-FR')} DH</Text>
              </View>
              <View style={styles.recapRow}>
                <Text style={styles.recapLabel}>Compte / Enveloppe</Text>
                <Text style={styles.recapValue}>{fundingSource === 'provision' && provision ? provision.name : payAccount!.name}</Text>
              </View>
              <View style={styles.recapRow}>
                <Text style={styles.recapLabel}>Reste avant</Text>
                <Text style={styles.recapValue}>{resteAPayer !== null ? resteAPayer.toLocaleString('fr-FR') : '—'} DH</Text>
              </View>
              <View style={styles.recapRow}>
                <Text style={styles.recapLabel}>Solde du compte après paiement</Text>
                <Text style={[styles.recapValue, soldeApres !== null && soldeApres < 0 && styles.recapValueNegative]}>{soldeApres !== null ? soldeApres.toLocaleString('fr-FR') : '—'} DH</Text>
              </View>
              <View style={[styles.recapRow, styles.recapRowLast]}>
                <Text style={styles.recapLabel}>Reste après paiement</Text>
                <Text style={[styles.recapValue, resteApresOperation !== null && resteApresOperation > 0 && styles.recapValueWarning]}>
                  {resteApresOperation !== null ? resteApresOperation.toLocaleString('fr-FR') : '—'} DH
                </Text>
              </View>
              {resteApresOperation !== null && resteApresOperation > 0 && (
                <Text style={styles.recapPartialNote}>Paiement partiel — il restera {resteApresOperation.toLocaleString('fr-FR')} DH à payer.</Text>
              )}
            </View>
          )}

          <TouchableOpacity testID="web-deadline-pay-submit" style={styles.buttonConfirm} onPress={onPay} disabled={paying || !showRecap}>
            {paying ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.buttonConfirmText}>CONFIRMER LE PAIEMENT</Text>}
          </TouchableOpacity>
        </View>
      )}

      {isOpen && (
        <View style={styles.dangerCard}>
          <Text style={styles.dangerTitle}>Clôture / Annulation</Text>
          <View style={styles.actionsRow}>
            <TouchableOpacity testID="web-deadline-close" style={styles.buttonSecondary} onPress={onClose} disabled={closing}>
              {closing ? <ActivityIndicator color={webColors.textPrimary} /> : <Text style={styles.buttonSecondaryText}>Clôturer</Text>}
            </TouchableOpacity>
            <TouchableOpacity testID="web-deadline-cancel" style={styles.buttonDanger} onPress={onCancel} disabled={cancelling}>
              {cancelling ? <ActivityIndicator color={webColors.danger} /> : <Text style={styles.buttonDangerText}>Annuler l'échéance</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <PageHeader
        title="Échéance"
        actions={
          isOpen ? (
            <TouchableOpacity testID="web-deadline-edit-button" onPress={openEdit}>
              <Text style={styles.headerEditLink}>Modifier</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />
      <TwoColumnLayout main={mainContent} panel={panel} />

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="web-deadline-edit-form">
            <Text style={styles.modalTitle}>Modifier l'échéance</Text>
            <DateField label="Date" value={editDueDate} onChange={setEditDueDate} />
            <Select
              testID="web-deadline-edit-amount-status"
              label="Statut du montant"
              value={editAmountStatus}
              onChange={(v) => setEditAmountStatus(v as 'confirme' | 'estime' | 'inconnu')}
              options={AMOUNT_STATUS_OPTIONS}
            />
            {editAmountStatus !== 'inconnu' && (
              <FormField testID="web-deadline-edit-amount" label="Montant (DH)" keyboardType="decimal-pad" value={editAmount} onChangeText={setEditAmount} />
            )}
            {editError && <Text style={styles.error}>{editError}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setEditOpen(false)}>
                <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="web-deadline-edit-save" style={styles.modalButton} onPress={onSaveEdit} disabled={editSaving}>
                {editSaving ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.modalButtonText}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center' },
  headerEditLink: { fontSize: 13, fontWeight: '700', color: webColors.primary },

  heroCard: { backgroundColor: webColors.primary, borderRadius: webRadius.xl, padding: webSpacing.lg, marginBottom: webSpacing.md },
  heroHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroLabel: { fontSize: 17, fontWeight: '700', color: webColors.textOnPrimary },
  heroChargePlanLink: { fontSize: 11, color: '#C9D2E0', textDecorationLine: 'underline' },
  heroMeta: { fontSize: 12, color: '#C9D2E0', marginTop: 4 },
  heroStatusRow: { flexDirection: 'row', alignItems: 'center', gap: webSpacing.sm, marginTop: webSpacing.sm },
  heroStatus: { fontSize: 11, fontWeight: '700', color: '#C9D2E0', textTransform: 'uppercase', letterSpacing: 0.5 },
  heroTemporalBadge: { fontSize: 11, fontWeight: '700' },
  heroAmountLabel: { fontSize: 11, color: '#C9D2E0', marginTop: webSpacing.sm },
  heroAmount: { fontSize: 28, fontWeight: '800', color: webColors.textOnPrimary, marginTop: 2 },

  error: { color: webColors.danger, fontSize: 12, marginBottom: webSpacing.sm },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.sm },
  empty: { color: webColors.textSecondary, fontSize: 13 },

  table: { backgroundColor: webColors.surface, borderRadius: webRadius.lg, borderWidth: 1, borderColor: webColors.border, overflow: 'hidden' },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: webColors.tableHeaderBg, paddingHorizontal: webSpacing.md, paddingVertical: 8 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: webSpacing.md, paddingVertical: 10, borderTopWidth: 1, borderTopColor: webColors.tableRowBorder },
  th: { fontSize: 11, fontWeight: '700', color: webColors.textSecondary, textTransform: 'uppercase' },
  td: { fontSize: 12, color: webColors.textPrimary },
  colDate: { width: 110 },
  colAccount: { flex: 1 },
  colAmount: { width: 110, textAlign: 'right', fontWeight: '700' },

  panelCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.lg, borderWidth: 1, borderColor: webColors.borderStrong },
  panelTitle: { fontSize: 14, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.sm },
  help: { fontSize: 11, color: webColors.textSecondary, marginBottom: webSpacing.sm, fontStyle: 'italic' },
  segment: { flexDirection: 'row', backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.md, padding: 4, marginBottom: webSpacing.sm },
  segmentItem: { flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderRadius: webRadius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: webColors.surface },
  segmentText: { fontSize: 11, color: webColors.textSecondary, fontWeight: '600', textAlign: 'center' },
  segmentTextActive: { color: webColors.textPrimary },
  button: { backgroundColor: webColors.primary, borderRadius: webRadius.md, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: webColors.textOnPrimary, fontWeight: '600', fontSize: 13 },

  recapCard: { backgroundColor: webColors.background, borderRadius: webRadius.md, padding: webSpacing.md, marginTop: webSpacing.xs, marginBottom: webSpacing.md },
  recapTitle: { fontSize: 10, fontWeight: '700', color: webColors.textSecondary, letterSpacing: 0.5, marginBottom: webSpacing.sm },
  recapRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: webColors.border },
  recapRowLast: { borderBottomWidth: 0 },
  recapLabel: { fontSize: 12, color: webColors.textSecondary },
  recapValue: { fontSize: 13, fontWeight: '700', color: webColors.textPrimary },
  recapValueNegative: { color: webColors.danger },
  recapValueWarning: { color: webColors.warning },
  recapPartialNote: { fontSize: 11, color: webColors.warning, fontWeight: '600', marginTop: webSpacing.sm, fontStyle: 'italic' },
  buttonConfirm: { backgroundColor: webColors.success, borderRadius: webRadius.md, paddingVertical: 13, alignItems: 'center' },
  buttonConfirmText: { color: webColors.textOnPrimary, fontWeight: '700', fontSize: 13, letterSpacing: 0.3 },

  dangerCard: { backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.xl, padding: webSpacing.lg, borderWidth: 1, borderColor: webColors.border },
  dangerTitle: { fontSize: 11, fontWeight: '700', color: webColors.textSecondary, textTransform: 'uppercase', marginBottom: webSpacing.sm },
  actionsRow: { flexDirection: 'row', gap: webSpacing.sm },
  buttonSecondary: { flex: 1, backgroundColor: webColors.surface, borderWidth: 1, borderColor: webColors.border, borderRadius: webRadius.md, paddingVertical: 11, alignItems: 'center' },
  buttonSecondaryText: { color: webColors.textPrimary, fontWeight: '600', fontSize: 13 },
  buttonDanger: { flex: 1, backgroundColor: webColors.dangerLight, borderRadius: webRadius.md, paddingVertical: 11, alignItems: 'center' },
  buttonDangerText: { color: webColors.danger, fontWeight: '600', fontSize: 13 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,26,41,0.45)', alignItems: 'center', justifyContent: 'center', padding: webSpacing.xl },
  modalCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.xl, width: 420, maxWidth: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.md },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: webSpacing.md, gap: webSpacing.sm },
  modalButton: { backgroundColor: webColors.primary, borderRadius: webRadius.sm, paddingHorizontal: 18, paddingVertical: 10 },
  modalButtonText: { color: webColors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  modalButtonSecondary: { paddingHorizontal: 14, paddingVertical: 10 },
  modalButtonSecondaryText: { color: webColors.textSecondary, fontWeight: '600', fontSize: 13 },
});
