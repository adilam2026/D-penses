import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { FormField } from '../../ui/FormField';
import { Select } from '../../ui/Select';
import { DateField } from '../../ui/DateField';
import { colors, elevation, radius, spacing } from '../../ui/theme';
import { TEMPORAL_STATUS_LABEL, temporalStatus, temporalStatusColor } from '../../ui/temporalStatus';
import { AMOUNT_STATUS_OPTIONS, Account, Deadline as BaseDeadline, Payment, Provision, STATUS_LABEL, formatDate, n } from './deadlineDetailLogic';

// Corrections consolidées §8 — compte d'imputation par défaut du ChargePlan,
// UNIQUEMENT un préremplissage au moment du paiement (jamais imposé) :
// extension LOCALE (jamais dans deadlineDetailLogic.ts, partagé avec le
// portail Web protégé WEB-V4.4A — aucune modification de ce fichier partagé).
type Deadline = BaseDeadline & { chargePlan: BaseDeadline['chargePlan'] & { defaultAccountId?: string | null } };

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
  // Mini-lot Paiements/Échéances — même seuil que ChargesScreen/HomeScreen
  // (seuil_a_payer_days du foyer), jamais une valeur dupliquée en dur.
  const [seuilAPayerDays, setSeuilAPayerDays] = useState(7);

  // R6.4 (§3) — "Modifier" une échéance existante : libellé/catégorie sont des
  // propriétés du ChargePlan parent (déjà éditables via ChargePlanDetailScreen,
  // jamais dupliquées ici), montant/statut/date sont des propriétés de LA
  // Deadline elle-même — c'est ici qu'on les modifie, un paiement réel n'est
  // jamais affecté (PATCH /deadlines/:id, RG-104).
  const [editOpen, setEditOpen] = useState(false);
  const [editDueDate, setEditDueDate] = useState('');
  const [editAmountStatus, setEditAmountStatus] = useState<'confirme' | 'estime' | 'inconnu'>('confirme');
  const [editAmount, setEditAmount] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [fundingSource, setFundingSource] = useState<'compte' | 'provision'>('compte');
  const [payAmount, setPayAmount] = useState('');
  const [payAccountId, setPayAccountId] = useState<string | null>(null);
  // Correction UX (date réelle éditable) : pré-remplie avec la date PRÉVUE de
  // l'échéance (dueDate), jamais figée sur aujourd'hui — une facture prévue
  // le 30 mais payée le 2 du mois suivant doit pouvoir être corrigée ici.
  const [payDate, setPayDate] = useState('');
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
      setPayDate(d.dueDate.slice(0, 10));

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
        // Corrections consolidées §8 — préremplit le compte d'imputation par
        // défaut de la charge si défini, jamais imposé (le Select reste modifiable).
        setPayAccountId((current) => current ?? d.chargePlan.defaultAccountId ?? accountList[0]?.id ?? null);
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
    if (!payDate) {
      setError('La date de paiement est requise');
      return;
    }
    if (fundingSource === 'provision' && provision) {
      const available = n(provision.currentAmount) ?? 0;
      if (value > available) {
        setError(`Enveloppe insuffisante : ${available.toLocaleString('fr-FR')} DH disponibles dans « ${provision.name} »`);
        return;
      }
    }
    // Corrections consolidées §2 — RG-014 (backend) ne clôture jamais une échéance
    // automatiquement : c'est le mobile qui orchestre l'action explicite de clôture
    // dès que le montant saisi couvre le reste à payer ACTUEL (pas le montant
    // d'origine de l'échéance) — jamais de reliquat fantôme en Projection/Calendrier.
    const currentResteAPayer = deadline ? n(deadline.resteAPayer) : null;
    // Corrections consolidées §2bis — garde-fou en profondeur : le bouton est déjà
    // désactivé en cas de trop-payé (isOverpayment ci-dessus), mais on revalide ici
    // au cas où l'état aurait changé entre le rendu et l'appel (jamais de confiance
    // aveugle dans un state React capturé plus tôt) ; le backend refuse aussi (RG-015bis).
    if (currentResteAPayer !== null && value > currentResteAPayer) {
      setError(
        `Montant supérieur au reste à payer : ${currentResteAPayer.toLocaleString('fr-FR')} DH restent dus sur cette échéance.`,
      );
      return;
    }
    const shouldClose = currentResteAPayer !== null && value >= currentResteAPayer;
    setPaying(true);
    try {
      if (fundingSource === 'provision' && provision) {
        await api.payDeadlineWithProvision(id, { amount: value, accountId: payAccountId, provisionId: provision.id, paidDate: payDate });
      } else {
        await api.createPayment(id, { amount: value, accountId: payAccountId, paidDate: payDate });
      }
      if (shouldClose) {
        await api.closeDeadline(id);
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
  // Corrections consolidées §2bis — un montant qui dépasse le reste à payer ACTUEL est
  // bloqué explicitement : jamais masqué par le clamp à 0 de resteApresOperation
  // ci-dessous, qui aurait sinon affiché à tort "paiement total, aucun reliquat".
  const isOverpayment = showRecap && resteAPayer !== null && payValue > resteAPayer;
  const resteApresOperation = resteAPayer !== null ? Math.max(0, Math.round((resteAPayer - payValue) * 100) / 100) : null;
  // Corrections consolidées §2 — le libellé de l'action reflète ce qui va réellement
  // se produire : un montant qui couvre EXACTEMENT le reste à payer ACTUEL clôture
  // l'échéance (paiement + close() explicite), jamais une simple "confirmation" ambiguë.
  const willClosePayment = showRecap && !isOverpayment && resteApresOperation === 0;
  const payButtonLabel = !showRecap || isOverpayment ? 'CONFIRMER LE PAIEMENT' : willClosePayment ? "PAYÉ — CLÔTURER L'ÉCHÉANCE" : 'ENREGISTRER LE PAIEMENT PARTIEL';

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        <View style={styles.heroCard}>
          <View style={styles.heroHeaderRow}>
            <Text style={styles.heroLabel}>{deadline.chargePlan.label}</Text>
            {isOpen && (
              <TouchableOpacity testID="deadline-edit-button" onPress={openEdit}>
                <Text style={styles.heroEditLink}>Modifier</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.heroMeta}>Échéance du {formatDate(deadline.dueDate)}</Text>
          <View style={styles.heroStatusRow}>
            <Text style={styles.heroStatus}>{STATUS_LABEL[deadline.financialStatus]}</Text>
            {temporal && (
              <Text testID="deadline-temporal-badge" style={[styles.heroTemporalBadge, { color: temporalStatusColor(temporal) }]}>
                {TEMPORAL_STATUS_LABEL[temporal]}
              </Text>
            )}
          </View>
          <Text style={styles.heroAmountLabel}>Montant restant</Text>
          <Text style={styles.heroAmount}>{resteAPayer !== null ? `${resteAPayer.toLocaleString('fr-FR')} DH` : 'À confirmer'}</Text>
          <TouchableOpacity testID="deadline-edit-chargeplan-link" onPress={() => navigation.navigate('ChargePlanDetail', { id: deadline.chargePlanId })}>
            <Text style={styles.heroChargePlanLink}>Modifier le libellé / la catégorie →</Text>
          </TouchableOpacity>
        </View>

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
            <DateField label="Date de paiement" value={payDate} onChange={setPayDate} />

            {isOverpayment && (
              <View style={styles.overpaymentCard} testID="payment-overpayment-error">
                <Text style={styles.overpaymentText}>
                  Montant supérieur au reste à payer : {resteAPayer!.toLocaleString('fr-FR')} DH restent dus sur cette échéance. Réduisez le
                  montant, ou saisissez exactement {resteAPayer!.toLocaleString('fr-FR')} DH pour payer et clôturer.
                </Text>
              </View>
            )}

            {showRecap && !isOverpayment && (
              <View style={styles.recapCard} testID="payment-recap">
                <Text style={styles.recapTitle}>RÉCAPITULATIF</Text>
                <View style={styles.recapRow}>
                  <Text style={styles.recapLabel}>Montant payé</Text>
                  <Text style={styles.recapValue}>{payValue.toLocaleString('fr-FR')} DH</Text>
                </View>
                <View style={styles.recapRow}>
                  <Text style={styles.recapLabel}>Date de paiement</Text>
                  <Text style={styles.recapValue}>{payDate ? formatDate(payDate) : '—'}</Text>
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
                  <Text style={styles.recapPartialNote} testID="payment-recap-partial-note">
                    Paiement partiel — il restera {resteApresOperation.toLocaleString('fr-FR')} DH à payer.
                  </Text>
                )}
                {resteApresOperation === 0 && (
                  <Text style={styles.recapFullNote} testID="payment-recap-full-note">
                    Paiement total — cette échéance pourra être clôturée, aucun reliquat.
                  </Text>
                )}
              </View>
            )}

            <TouchableOpacity
              testID="deadline-pay-button"
              style={styles.buttonConfirm}
              onPress={onPay}
              disabled={paying || !showRecap || isOverpayment}
            >
              {paying ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonConfirmText}>{payButtonLabel}</Text>}
            </TouchableOpacity>
          </View>
        )}

        {payments.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Paiements enregistrés</Text>
            {payments.map((p) => (
              <TouchableOpacity
                key={p.id}
                testID={`deadline-payment-row-${p.id}`}
                style={styles.paymentRow}
                onPress={() => navigation.navigate('TransactionDetail', { kind: 'payment', id: p.id })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentText}>{formatDate(p.paidDate)}</Text>
                  <Text style={styles.paymentMeta}>
                    Compte {accounts.find((a) => a.id === p.accountId)?.name ?? '—'}
                    {p.provisionId && provision?.id === p.provisionId ? ` · Enveloppe ${provision.name}` : ''}
                  </Text>
                </View>
                <Text style={styles.paymentAmount}>{n(p.amount)?.toLocaleString('fr-FR')} DH</Text>
              </TouchableOpacity>
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

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="deadline-edit-form">
            <Text style={styles.modalTitle}>Modifier l'échéance</Text>
            <DateField label="Date" value={editDueDate} onChange={setEditDueDate} />
            <Select
              testID="deadline-edit-amount-status"
              label="Statut du montant"
              value={editAmountStatus}
              onChange={(v) => setEditAmountStatus(v as 'confirme' | 'estime' | 'inconnu')}
              options={AMOUNT_STATUS_OPTIONS}
            />
            {editAmountStatus !== 'inconnu' && (
              <FormField testID="deadline-edit-amount" label="Montant (DH)" keyboardType="decimal-pad" value={editAmount} onChangeText={setEditAmount} />
            )}
            {editError && <Text style={styles.error}>{editError}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setEditOpen(false)}>
                <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="deadline-edit-save" style={styles.modalButton} onPress={onSaveEdit} disabled={editSaving}>
                {editSaving ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.modalButtonText}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  scroll: { padding: spacing.xl },
  heroCard: { backgroundColor: colors.primary, borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.md },
  heroHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroEditLink: { fontSize: 12, fontWeight: '600', color: colors.textOnPrimary, textDecorationLine: 'underline' },
  heroChargePlanLink: { fontSize: 11, color: '#C9D2E0', marginTop: spacing.sm, textDecorationLine: 'underline' },
  heroLabel: { fontSize: 16, fontWeight: '700', color: colors.textOnPrimary },
  heroMeta: { fontSize: 12, color: '#C9D2E0', marginTop: 4 },
  heroStatus: { fontSize: 11, fontWeight: '700', color: '#C9D2E0', marginTop: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroStatusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroTemporalBadge: { fontSize: 11, fontWeight: '700', marginTop: spacing.sm },
  heroAmountLabel: { fontSize: 11, color: '#C9D2E0', marginTop: spacing.sm },
  heroAmount: { fontSize: 26, fontWeight: '800', color: colors.textOnPrimary, marginTop: 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  noAccountCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  noAccountText: { fontSize: 13, color: colors.textPrimary, marginBottom: spacing.md },
  overpaymentCard: { backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.xs, marginBottom: spacing.md },
  overpaymentText: { fontSize: 12, color: colors.danger, fontWeight: '600' },
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
  recapFullNote: { fontSize: 11, color: colors.success, fontWeight: '600', marginTop: spacing.sm, fontStyle: 'italic' },
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, width: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.md },
  modalButton: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 18, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  modalButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  modalButtonSecondary: { paddingHorizontal: 14, paddingVertical: 10, marginRight: 8 },
  modalButtonSecondaryText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
});
