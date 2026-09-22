import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { FormField } from '../../ui/FormField';
import { ConfirmDialog } from '../../web/ui/ConfirmDialog.web';
import { PageHeader } from '../../web/ui/PageHeader.web';
import { TwoColumnLayout } from '../../web/ui/TwoColumnLayout.web';
import { MAX_CONTENT_WIDTH, webColors, webRadius, webSpacing } from '../../web/webTheme';
import { KIND_LABEL, Provision, TransactionDetail, formatDate } from './transactionDetailLogic';

type PendingAction = { title: string; message: string; run: () => Promise<unknown> } | null;

/**
 * Portail Web v4 (WEB-V4.4A révisé) — TransactionDetail desktop : synthèse
 * (résumé/montant/date/compte/catégorie/rattachements) à gauche, panneau
 * "Actions sur la transaction" à droite — actions normales et sensibles dans
 * deux cartes distinctes, jamais mélangées. `Alert.alert` (RN) étant un no-op
 * sur Web, les confirmations destructives passent par ConfirmDialog.web
 * (partagé).
 */
export function TransactionDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const kind = route.params?.kind as string;
  const id = route.params?.id as string;

  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [provision, setProvision] = useState<Provision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [correctOpen, setCorrectOpen] = useState(false);
  const [correctAmount, setCorrectAmount] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);

  const [metadataOpen, setMetadataOpen] = useState(false);
  const [metadataNotes, setMetadataNotes] = useState('');
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d: TransactionDetail = await api.getTransactionDetail(kind, id);
      setDetail(d);
      setProvision(d.provisionId ? await api.getProvision(d.provisionId) : null);
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Transaction introuvable');
    } finally {
      setLoading(false);
    }
  }, [kind, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function openCorrect() {
    if (!detail) return;
    setCorrectAmount(String(Math.abs(detail.amount)));
    setCorrectError(null);
    setCorrectOpen(true);
  }

  async function onConfirmCorrect() {
    if (!detail) return;
    const value = Number(correctAmount.replace(',', '.'));
    if (!value || value <= 0) {
      setCorrectError('Montant invalide');
      return;
    }
    setCorrecting(true);
    setCorrectError(null);
    try {
      if (kind === 'payment' && detail.deadline) {
        await api.correctPayment(detail.deadline.id, detail.id, { correctedAmount: value });
      } else if (kind === 'adhoc_expense') {
        await api.correctAdhocExpense(detail.id, { correctedAmount: value });
      }
      setCorrectOpen(false);
      navigation.goBack();
    } catch (err) {
      setCorrectError(err instanceof api.ApiError ? err.message : 'Correction impossible');
    } finally {
      setCorrecting(false);
    }
  }

  function openMetadata() {
    if (!detail) return;
    setMetadataNotes(detail.note ?? '');
    setMetadataError(null);
    setMetadataOpen(true);
  }

  async function onSaveMetadata() {
    if (!detail) return;
    setSavingMetadata(true);
    setMetadataError(null);
    try {
      await api.updateExpenseMetadata(kind as 'adhoc_expense' | 'budget_expense', detail.id, { notes: metadataNotes });
      setMetadataOpen(false);
      await load();
    } catch (err) {
      setMetadataError(err instanceof api.ApiError ? err.message : 'Modification impossible');
    } finally {
      setSavingMetadata(false);
    }
  }

  async function onConfirmPendingAction() {
    if (!pendingAction) return;
    setActionError(null);
    setActing(true);
    try {
      await pendingAction.run();
      setPendingAction(null);
      navigation.goBack();
    } catch (err) {
      setActionError(err instanceof api.ApiError ? err.message : 'Action impossible');
    } finally {
      setActing(false);
    }
  }

  function onReversePayment() {
    if (!detail?.deadline) return;
    setPendingAction({
      title: 'Annuler ce paiement ?',
      message: 'Un remboursement du même montant sera enregistré — le paiement original reste visible en historique.',
      run: () => api.reversePayment(detail.deadline!.id, detail.id),
    });
  }
  function onUnconfirmIncome() {
    if (!detail) return;
    setPendingAction({
      title: 'Annuler ce revenu ?',
      message: 'Cette occurrence redevient "prévue" — vous pourrez la reconfirmer avec les bonnes valeurs.',
      run: () => api.unconfirmIncomeOccurrence(detail.id),
    });
  }
  function onReverseAdhocExpense() {
    if (!detail) return;
    setPendingAction({
      title: 'Annuler cette dépense ?',
      message: 'Une écriture de correction créditera le compte du montant intégral — la dépense reste visible en historique.',
      run: () => api.reverseAdhocExpense(detail.id),
    });
  }
  function onReverseTransfer() {
    if (!detail) return;
    setPendingAction({
      title: 'Annuler ce transfert ?',
      message: "Un transfert miroir (comptes inversés, même montant) sera créé — les deux comptes sont corrigés ensemble, jamais un seul.",
      run: () => api.reverseTransfer(detail.id),
    });
  }

  if (loading && !detail) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (error || !detail) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Transaction introuvable'}</Text>
      </View>
    );
  }

  const positive = detail.amount >= 0;

  const hasNormalActions = kind === 'payment' || kind === 'adhoc_expense' || kind === 'budget_expense' || kind === 'adjustment';
  const hasDangerAction = kind === 'payment' || kind === 'income' || kind === 'adhoc_expense' || kind === 'transfer_in' || kind === 'transfer_out';

  const mainContent = (
    <>
      <View style={styles.heroCard}>
        <Text style={styles.heroKind}>{KIND_LABEL[detail.displayKind] ?? detail.displayKind}</Text>
        <Text style={styles.heroLabel}>{detail.label}</Text>
        <Text style={[styles.heroAmount, positive ? styles.amountPositive : styles.amountNegative]}>
          {positive ? '+' : ''}
          {detail.amount.toLocaleString('fr-FR')} DH
        </Text>
        <Text style={styles.heroDate}>{formatDate(detail.date)}</Text>
      </View>

      <View style={styles.fieldsGrid}>
        <Field label="Compte" value={detail.accountName} />
        {detail.transferCounterpart && <Field label="Compte contrepartie" value={detail.transferCounterpart.accountName} />}
        {provision && <Field label="Enveloppe" value={provision.name} />}
        {detail.note && <Field label="Note" value={detail.note} />}
        <Field label="Origine" value={detail.origin} />
      </View>

      <View style={styles.linksRow}>
        {detail.deadline && (
          <TouchableOpacity testID="web-transaction-deadline-link" style={styles.linkCard} onPress={() => navigation.navigate('DeadlineDetail', { id: detail.deadline!.id })}>
            <Text style={styles.linkTitle}>Échéance liée</Text>
            <Text style={styles.linkValue}>
              {detail.deadline.chargePlanLabel} — {formatDate(detail.deadline.dueDate)}
            </Text>
          </TouchableOpacity>
        )}
        {detail.financialPlan && (
          <TouchableOpacity testID="web-transaction-plan-link" style={styles.linkCard} onPress={() => navigation.navigate('FinancialPlanDetail', { id: detail.financialPlan!.id })}>
            <Text style={styles.linkTitle}>Plan financier lié</Text>
            <Text style={styles.linkValue}>{detail.financialPlan.label}</Text>
          </TouchableOpacity>
        )}
      </View>
    </>
  );

  const panel = (
    <View style={{ gap: webSpacing.md }}>
      {actionError && <Text style={styles.error}>{actionError}</Text>}

      {hasNormalActions && (
        <View style={styles.panelCard}>
          <Text style={styles.panelTitle}>Actions sur la transaction</Text>
          {kind === 'payment' && <ActionButton testID="web-action-correct" label="Corriger le montant" onPress={openCorrect} disabled={acting} />}
          {kind === 'adhoc_expense' && (
            <>
              <ActionButton testID="web-action-metadata" label="Modifier la description" onPress={openMetadata} disabled={acting} />
              <ActionButton testID="web-action-correct" label="Corriger le montant" onPress={openCorrect} disabled={acting} />
            </>
          )}
          {kind === 'budget_expense' && (
            <>
              <ActionButton testID="web-action-metadata" label="Modifier la description" onPress={openMetadata} disabled={acting} />
              <Text style={styles.help}>Une dépense sur budget est suivie par le budget variable — sa correction/annulation de montant n'est pas proposée ici.</Text>
            </>
          )}
          {kind === 'adjustment' && <Text style={styles.help}>Un ajustement est déjà lui-même une écriture de correction — non modifiable directement.</Text>}
        </View>
      )}

      {hasDangerAction && (
        <View style={styles.dangerCard}>
          <Text style={styles.dangerTitle}>Action sensible</Text>
          {kind === 'payment' && <ActionButton testID="web-action-reverse" label="Annuler ce paiement" danger onPress={onReversePayment} disabled={acting} />}
          {kind === 'income' && <ActionButton testID="web-action-unconfirm" label="Annuler ce revenu" danger onPress={onUnconfirmIncome} disabled={acting} />}
          {kind === 'adhoc_expense' && <ActionButton testID="web-action-reverse" label="Annuler cette dépense" danger onPress={onReverseAdhocExpense} disabled={acting} />}
          {(kind === 'transfer_in' || kind === 'transfer_out') && (
            <ActionButton testID="web-action-reverse" label="Annuler ce transfert" danger onPress={onReverseTransfer} disabled={acting} />
          )}
        </View>
      )}
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <PageHeader title="Transaction" />
      <TwoColumnLayout main={mainContent} panel={panel} />

      <Modal visible={correctOpen} transparent animationType="fade" onRequestClose={() => setCorrectOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="web-correct-form">
            <Text style={styles.modalTitle}>Corriger le montant</Text>
            <FormField testID="web-correct-amount-input" placeholder="Montant réellement payé/dépensé (DH)" keyboardType="decimal-pad" value={correctAmount} onChangeText={setCorrectAmount} />
            {correctError && <Text style={styles.error}>{correctError}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setCorrectOpen(false)}>
                <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="web-correct-confirm" style={styles.modalButton} onPress={onConfirmCorrect} disabled={correcting}>
                {correcting ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.modalButtonText}>Confirmer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={metadataOpen} transparent animationType="fade" onRequestClose={() => setMetadataOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="web-metadata-form">
            <Text style={styles.modalTitle}>Modifier la description</Text>
            <FormField testID="web-metadata-notes-input" placeholder="Note" value={metadataNotes} onChangeText={setMetadataNotes} />
            {metadataError && <Text style={styles.error}>{metadataError}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setMetadataOpen(false)}>
                <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="web-metadata-save" style={styles.modalButton} onPress={onSaveMetadata} disabled={savingMetadata}>
                {savingMetadata ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.modalButtonText}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        testID="web-transaction-confirm-action"
        visible={!!pendingAction}
        title={pendingAction?.title ?? ''}
        message={pendingAction?.message ?? ''}
        confirmLabel="Confirmer"
        destructive
        loading={acting}
        onConfirm={onConfirmPendingAction}
        onCancel={() => setPendingAction(null)}
      />
    </ScrollView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

function ActionButton({ testID, label, onPress, disabled, danger }: { testID: string; label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <TouchableOpacity testID={testID} style={[styles.actionButton, danger && styles.actionButtonDanger]} onPress={onPress} disabled={disabled}>
      <Text style={[styles.actionButtonText, danger && styles.actionButtonTextDanger]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center' },
  error: { color: webColors.danger, fontSize: 13, marginBottom: webSpacing.sm },

  heroCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.lg, borderWidth: 1, borderColor: webColors.borderStrong, marginBottom: webSpacing.md },
  heroKind: { fontSize: 11, fontWeight: '700', color: webColors.textSecondary, textTransform: 'uppercase' },
  heroLabel: { fontSize: 19, fontWeight: '700', color: webColors.textPrimary, marginTop: 4 },
  heroAmount: { fontSize: 28, fontWeight: '800', marginTop: webSpacing.sm },
  amountPositive: { color: webColors.success },
  amountNegative: { color: webColors.danger },
  heroDate: { fontSize: 12, color: webColors.textSecondary, marginTop: 6 },

  fieldsGrid: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, borderWidth: 1, borderColor: webColors.border, marginBottom: webSpacing.md, overflow: 'hidden' },
  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: webSpacing.lg, paddingVertical: 12, borderTopWidth: 1, borderTopColor: webColors.tableRowBorder },
  fieldLabel: { fontSize: 12, color: webColors.textSecondary },
  fieldValue: { fontSize: 13, color: webColors.textPrimary, fontWeight: '600', flexShrink: 1, textAlign: 'right', marginLeft: webSpacing.md },

  linksRow: { flexDirection: 'row', flexWrap: 'wrap', gap: webSpacing.sm, marginBottom: webSpacing.md },
  linkCard: { flex: 1, minWidth: 240, backgroundColor: webColors.surface, borderRadius: webRadius.lg, padding: webSpacing.md, borderWidth: 1, borderColor: webColors.border },
  linkTitle: { fontSize: 11, color: webColors.textSecondary, textTransform: 'uppercase', fontWeight: '700' },
  linkValue: { fontSize: 14, color: webColors.textPrimary, fontWeight: '600', marginTop: 4 },

  panelCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.lg, borderWidth: 1, borderColor: webColors.borderStrong, gap: webSpacing.sm },
  panelTitle: { fontSize: 14, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.xs },
  dangerCard: { backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.xl, padding: webSpacing.lg, borderWidth: 1, borderColor: webColors.border, gap: webSpacing.sm },
  dangerTitle: { fontSize: 11, fontWeight: '700', color: webColors.textSecondary, textTransform: 'uppercase', marginBottom: webSpacing.xs },
  actionButton: { backgroundColor: webColors.surface, borderWidth: 1, borderColor: webColors.border, borderRadius: webRadius.sm, paddingVertical: 12, alignItems: 'center' },
  actionButtonDanger: { borderColor: webColors.dangerLight, backgroundColor: webColors.dangerLight },
  actionButtonText: { fontSize: 13, fontWeight: '600', color: webColors.textPrimary },
  actionButtonTextDanger: { color: webColors.danger },
  help: { fontSize: 11, color: webColors.textSecondary, fontStyle: 'italic' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,26,41,0.45)', alignItems: 'center', justifyContent: 'center', padding: webSpacing.xl },
  modalCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.xl, width: 420, maxWidth: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.md },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: webSpacing.md, gap: webSpacing.sm },
  modalButton: { backgroundColor: webColors.primary, borderRadius: webRadius.sm, paddingHorizontal: 18, paddingVertical: 10 },
  modalButtonText: { color: webColors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  modalButtonSecondary: { paddingHorizontal: 14, paddingVertical: 10 },
  modalButtonSecondaryText: { color: webColors.textSecondary, fontWeight: '600', fontSize: 13 },
});
