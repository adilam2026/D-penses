import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { colors, radius, spacing } from '../../ui/theme';

interface TransactionDetail {
  kind: string;
  displayKind: string;
  id: string;
  origin: string;
  label: string;
  amount: number;
  date: string;
  accountId: string;
  accountName: string;
  note: string | null;
  deadline: { id: string; dueDate: string; chargePlanLabel: string } | null;
  financialPlan: { id: string; label: string } | null;
  provisionId: string | null;
  transferCounterpart?: { accountId: string; accountName: string } | null;
}

interface Provision {
  id: string;
  name: string;
}

const KIND_LABEL: Record<string, string> = {
  revenu: 'Revenu',
  paiement: 'Paiement',
  depense: 'Dépense',
  transfert: 'Transfert',
  ajustement: 'Ajustement',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/**
 * R5 clôture §1 — actions comptablement sûres par type de transaction, jamais
 * un DELETE brutal du ledger :
 * - payment : Corriger (contre-écriture RG-015) / Annuler (remboursement).
 * - income (reçu) : Annuler (revient à "prevu", puis reconfirmable).
 * - adhoc_expense : Modifier (description) / Corriger / Annuler (Adjustment).
 * - budget_expense : Modifier (description) uniquement — corriger/annuler son
 *   montant nécessiterait de toucher l'agrégation "consommé" du budget
 *   variable (variable-budgets.service), hors périmètre sûr de cette clôture.
 * - adjustment : lecture seule (déjà lui-même le mécanisme de correction).
 * - transfer_in/transfer_out : Annuler (transfert miroir atomique) — un
 *   transfert affiché ici est toujours confirmé (cf. transactions.service).
 */
export function TransactionDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
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

  function onRequestCancel(title: string, message: string, run: () => Promise<unknown>) {
    setActionError(null);
    Alert.alert(title, message, [
      { text: 'Retour', style: 'cancel' },
      {
        text: 'Confirmer',
        style: 'destructive',
        onPress: async () => {
          setActing(true);
          try {
            await run();
            navigation.goBack();
          } catch (err) {
            setActionError(err instanceof api.ApiError ? err.message : 'Action impossible');
          } finally {
            setActing(false);
          }
        },
      },
    ]);
  }

  function onReversePayment() {
    if (!detail?.deadline) return;
    onRequestCancel(
      'Annuler ce paiement ?',
      'Un remboursement du même montant sera enregistré — le paiement original reste visible en historique.',
      () => api.reversePayment(detail.deadline!.id, detail.id),
    );
  }

  function onUnconfirmIncome() {
    if (!detail) return;
    onRequestCancel(
      'Annuler ce revenu ?',
      'Cette occurrence redevient "prévue" — vous pourrez la reconfirmer avec les bonnes valeurs.',
      () => api.unconfirmIncomeOccurrence(detail.id),
    );
  }

  function onReverseAdhocExpense() {
    if (!detail) return;
    onRequestCancel(
      'Annuler cette dépense ?',
      'Une écriture de correction créditera le compte du montant intégral — la dépense reste visible en historique.',
      () => api.reverseAdhocExpense(detail.id),
    );
  }

  function onReverseTransfer() {
    if (!detail) return;
    onRequestCancel(
      'Annuler ce transfert ?',
      "Un transfert miroir (comptes inversés, même montant) sera créé — les deux comptes sont corrigés ensemble, jamais un seul.",
      () => api.reverseTransfer(detail.id),
    );
  }

  if (loading && !detail) {
    return (
      <View style={styles.center} testID="transaction-detail-loading">
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

  return (
    <ScrollView testID="transaction-detail-scroll" contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}>
      <View style={styles.heroCard}>
        <Text style={styles.heroKind}>{KIND_LABEL[detail.displayKind] ?? detail.displayKind}</Text>
        <Text style={styles.heroLabel}>{detail.label}</Text>
        <Text style={[styles.heroAmount, positive ? styles.amountPositive : styles.amountNegative]}>
          {positive ? '+' : ''}
          {detail.amount.toLocaleString('fr-FR')} DH
        </Text>
        <Text style={styles.heroDate}>{formatDate(detail.date)}</Text>
      </View>

      <View style={styles.fieldsCard}>
        <Row label="Compte" value={detail.accountName} />
        {detail.transferCounterpart && <Row label="Compte contrepartie" value={detail.transferCounterpart.accountName} />}
        {provision && <Row label="Enveloppe" value={provision.name} />}
        {detail.note && <Row label="Note" value={detail.note} />}
        <Row label="Origine" value={detail.origin} />
      </View>

      {detail.deadline && (
        <TouchableOpacity
          testID="transaction-detail-deadline-link"
          style={styles.linkCard}
          onPress={() => navigation.navigate('DeadlineDetail', { id: detail.deadline!.id })}
        >
          <Text style={styles.linkTitle}>Échéance liée</Text>
          <Text style={styles.linkValue}>
            {detail.deadline.chargePlanLabel} — {formatDate(detail.deadline.dueDate)}
          </Text>
        </TouchableOpacity>
      )}

      {detail.financialPlan && (
        <TouchableOpacity
          testID="transaction-detail-plan-link"
          style={styles.linkCard}
          onPress={() => navigation.navigate('FinancialPlanDetail', { id: detail.financialPlan!.id })}
        >
          <Text style={styles.linkTitle}>Plan financier lié</Text>
          <Text style={styles.linkValue}>{detail.financialPlan.label}</Text>
        </TouchableOpacity>
      )}

      {actionError && <Text style={styles.error}>{actionError}</Text>}

      <View style={styles.actionsCard}>
        {kind === 'payment' && (
          <>
            <ActionButton testID="action-correct" label="Corriger le montant" onPress={openCorrect} disabled={acting} />
            <ActionButton testID="action-reverse" label="Annuler ce paiement" danger onPress={onReversePayment} disabled={acting} />
          </>
        )}
        {kind === 'income' && <ActionButton testID="action-unconfirm" label="Annuler ce revenu" danger onPress={onUnconfirmIncome} disabled={acting} />}
        {kind === 'adhoc_expense' && (
          <>
            <ActionButton testID="action-metadata" label="Modifier la description" onPress={openMetadata} disabled={acting} />
            <ActionButton testID="action-correct" label="Corriger le montant" onPress={openCorrect} disabled={acting} />
            <ActionButton testID="action-reverse" label="Annuler cette dépense" danger onPress={onReverseAdhocExpense} disabled={acting} />
          </>
        )}
        {kind === 'budget_expense' && (
          <>
            <ActionButton testID="action-metadata" label="Modifier la description" onPress={openMetadata} disabled={acting} />
            <Text style={styles.help}>
              Une dépense sur budget est suivie par le budget variable — sa correction/annulation de montant n'est pas proposée ici (limite documentée).
            </Text>
          </>
        )}
        {kind === 'adjustment' && <Text style={styles.help}>Un ajustement est déjà lui-même une écriture de correction — non modifiable directement.</Text>}
        {(kind === 'transfer_in' || kind === 'transfer_out') && (
          <ActionButton testID="action-reverse" label="Annuler ce transfert" danger onPress={onReverseTransfer} disabled={acting} />
        )}
      </View>

      <Modal visible={correctOpen} transparent animationType="fade" onRequestClose={() => setCorrectOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="correct-form">
            <Text style={styles.modalTitle}>Corriger le montant</Text>
            <TextInput
              style={styles.modalInput}
              value={correctAmount}
              onChangeText={setCorrectAmount}
              keyboardType="decimal-pad"
              placeholder="Montant réellement payé/dépensé (DH)"
              testID="correct-amount-input"
            />
            {correctError && <Text style={styles.error}>{correctError}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setCorrectOpen(false)}>
                <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="correct-confirm" style={styles.modalButton} onPress={onConfirmCorrect} disabled={correcting}>
                {correcting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.modalButtonText}>Confirmer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={metadataOpen} transparent animationType="fade" onRequestClose={() => setMetadataOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="metadata-form">
            <Text style={styles.modalTitle}>Modifier la description</Text>
            <TextInput
              style={styles.modalInput}
              value={metadataNotes}
              onChangeText={setMetadataNotes}
              placeholder="Note"
              testID="metadata-notes-input"
            />
            {metadataError && <Text style={styles.error}>{metadataError}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setMetadataOpen(false)}>
                <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="metadata-save" style={styles.modalButton} onPress={onSaveMetadata} disabled={savingMetadata}>
                {savingMetadata ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.modalButtonText}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function ActionButton({
  testID,
  label,
  onPress,
  disabled,
  danger,
}: {
  testID: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity testID={testID} style={[styles.actionButton, danger && styles.actionButtonDanger]} onPress={onPress} disabled={disabled}>
      <Text style={[styles.actionButtonText, danger && styles.actionButtonTextDanger]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center', paddingHorizontal: 24, marginBottom: 8 },
  scroll: { padding: 20, backgroundColor: colors.background, flexGrow: 1 },
  heroCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 18, marginBottom: 16 },
  heroKind: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase' },
  heroLabel: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginTop: 4 },
  heroAmount: { fontSize: 26, fontWeight: '800', marginTop: 10 },
  amountPositive: { color: colors.success },
  amountNegative: { color: colors.danger },
  heroDate: { fontSize: 12, color: colors.textSecondary, marginTop: 6 },
  fieldsCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 4, marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowLabel: { fontSize: 13, color: colors.textSecondary },
  rowValue: { fontSize: 13, color: colors.textPrimary, fontWeight: '600', flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  linkCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  linkTitle: { fontSize: 11, color: colors.textSecondary, textTransform: 'uppercase', fontWeight: '700' },
  linkValue: { fontSize: 14, color: colors.textPrimary, fontWeight: '600', marginTop: 4 },
  actionsCard: { marginTop: 8 },
  actionButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: 12, alignItems: 'center', marginBottom: 8 },
  actionButtonDanger: { borderColor: colors.dangerLight, backgroundColor: colors.dangerLight },
  actionButtonText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  actionButtonTextDanger: { color: colors.danger },
  help: { fontSize: 11, color: colors.textSecondary, fontStyle: 'italic', marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, width: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  modalInput: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.md },
  modalButton: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 18, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  modalButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  modalButtonSecondary: { paddingHorizontal: 14, paddingVertical: 10, marginRight: 8 },
  modalButtonSecondaryText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
});
