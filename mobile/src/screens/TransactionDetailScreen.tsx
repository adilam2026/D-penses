import React, { useCallback, useState } from 'react';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, elevation, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatShortDate } from '../ui/formatMoney';
import { OPERATION_KIND_LABELS, localAmount } from '../ui/operationKindLabel';
import { FormField } from '../ui/FormField';
import { DateField } from '../ui/DateField';
import { Select, SelectOption } from '../ui/Select';
import { HelpButton } from '../ui/HelpButton';
import { useKeyboardAwareScroll } from '../ui/useKeyboardAwareScroll';
import { TRANSACTION_ACTION_LABELS } from '../ui/transactionLabels';
import { accountLabelFor } from '../ui/accountLabel';

/**
 * Détail d'une transaction (§4) — jamais de suppression physique d'une
 * opération réalisée : "Annuler" crée un renversement (reversalOfOperationId),
 * "Modifier" renverse l'originale ET crée une nouvelle opération corrigée liée
 * par correctionOfOperationId (historique intégralement traçable).
 */
export function TransactionDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ TransactionDetail: { id: string; accountId?: string; subaccountId?: string } }, 'TransactionDetail'>>();
  const { id, accountId, subaccountId } = route.params;
  const topInset = useTopInset();
  const bottomInset = useBottomInset();

  const [operation, setOperation] = useState<api.FinancialOperationDetailApi | null>(null);
  const [accounts, setAccounts] = useState<api.AccountApi[]>([]);
  const [categories, setCategories] = useState<api.CategoryApi[]>([]);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    const [op, accs, cats] = await Promise.all([api.getFinancialOperation(id), api.listAccounts(), api.listCategories()]);
    setOperation(op);
    setAccounts(accs);
    setCategories(cats);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!operation) {
    return (
      <View style={[styles.center, { paddingTop: topInset }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const category = categories.find((c) => c.id === operation.categoryId);
  const sourceLabel = accountLabelFor(accounts, operation.sourceAccountId, operation.sourceSubaccountId);
  const destinationLabel = accountLabelFor(accounts, operation.destinationAccountId, operation.destinationSubaccountId);
  const compteLabel = sourceLabel && destinationLabel ? `${sourceLabel} → ${destinationLabel}` : sourceLabel ?? destinationLabel ?? '—';

  const displayAmount = accountId
    ? localAmount(operation.ledgerEntries, { accountId })
    : subaccountId
      ? localAmount(operation.ledgerEntries, { subaccountId })
      : operation.reversalOfOperationId
        ? -operation.amount
        : operation.amount;

  const isReversal = !!operation.reversalOfOperationId;
  const isAlreadyReversed = operation.reversals.length > 0;
  const canModify = !isReversal && !isAlreadyReversed;
  const canCancel = !isReversal && !isAlreadyReversed;

  let statut = 'Réalisée';
  if (isReversal) statut = `Annulation${operation.reversalReason ? ` — ${operation.reversalReason}` : ''}`;
  else if (operation.correctionOfOperationId) statut = 'Correction';
  else if (isAlreadyReversed) statut = 'Annulée';

  async function doCancel() {
    if (cancelling) return;
    setCancelling(true);
    try {
      await api.cancelFinancialOperation(id);
      setCancelConfirmOpen(false);
      await load();
    } finally {
      setCancelling(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView style={[styles.container, { paddingTop: topInset }]} contentContainerStyle={{ paddingBottom: bottomInset + spacing.xxl }}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backRow}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            testID="transaction-detail-close"
          >
            <Ionicons name="close" size={20} color={colors.textPrimary} />
            <Text style={styles.backLabel}>{TRANSACTION_ACTION_LABELS.close}</Text>
          </TouchableOpacity>
          <HelpButton
            title="Détail de la transaction"
            text="Une opération réalisée n'est jamais supprimée : Annuler crée un renversement, Modifier renverse l'originale et crée une nouvelle opération corrigée, toutes deux restent visibles dans l'historique."
          />
        </View>

        <Text style={styles.title}>{operation.label}</Text>

        <View style={styles.amountCard}>
          <Text style={styles.amountLabel}>Montant</Text>
          <Text style={[styles.amountValue, displayAmount > 0 ? styles.amountPlus : displayAmount < 0 ? styles.amountMinus : null]}>
            {displayAmount > 0 ? '+' : ''}
            {formatDh(displayAmount)}
          </Text>
        </View>

        <View style={styles.card}>
          <Row label="Type" value={OPERATION_KIND_LABELS[operation.kind]} />
          <Row label="Date" value={formatShortDate(operation.date)} />
          <Row label="Libellé" value={operation.label} />
          <Row label="Catégorie" value={category?.name ?? '—'} />
          <Row label="Compte" value={compteLabel} />
          <Row label="Statut" value={statut} last />
        </View>

        {(canModify || canCancel) && (
          <View style={styles.actions}>
            {canModify && (
              <TouchableOpacity style={styles.modifyButton} onPress={() => setCorrectOpen(true)} testID="transaction-detail-modify">
                <Text style={styles.modifyButtonText}>{TRANSACTION_ACTION_LABELS.modify}</Text>
              </TouchableOpacity>
            )}
            {canCancel && (
              <TouchableOpacity style={styles.cancelButton} onPress={() => setCancelConfirmOpen(true)} testID="transaction-detail-cancel">
                <Text style={styles.cancelButtonText}>{TRANSACTION_ACTION_LABELS.cancel}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {isReversal && operation.reversalOfOperation && (
          <Text style={styles.linkNote}>Renversement de « {operation.reversalOfOperation.label} » du {formatShortDate(operation.reversalOfOperation.date)}.</Text>
        )}
        {operation.correctionOfOperationId && operation.correctionOfOperation && (
          <Text style={styles.linkNote}>Corrige « {operation.correctionOfOperation.label} » du {formatShortDate(operation.correctionOfOperation.date)}.</Text>
        )}
        {isAlreadyReversed && (
          <Text style={styles.linkNote}>Cette opération a été annulée{operation.correctedByOperations.length > 0 ? ' et remplacée par une opération corrigée' : ''}.</Text>
        )}
      </ScrollView>

      <CancelConfirmModal
        visible={cancelConfirmOpen}
        label={operation.label}
        cancelling={cancelling}
        onClose={() => setCancelConfirmOpen(false)}
        onConfirm={doCancel}
      />

      <CorrectModal visible={correctOpen} operation={operation} categories={categories} onClose={() => setCorrectOpen(false)} onSaved={load} />
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function CancelConfirmModal({
  visible,
  label,
  cancelling,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  label: string;
  cancelling: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const bottomInset = useBottomInset(spacing.lg);
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <View style={[styles.confirmBox, { marginBottom: bottomInset }]}>
        <Text style={styles.confirmTitle}>Annuler cette transaction ?</Text>
        <Text style={styles.confirmText}>« {label} » restera visible dans l'historique, marquée comme annulée. Cette action ne peut pas être annulée une seconde fois.</Text>
        <View style={styles.confirmActions}>
          <TouchableOpacity style={styles.confirmCancel} onPress={onClose} testID="transaction-cancel-confirm-no">
            <Text style={styles.confirmCancelText}>Retour</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmDanger} onPress={onConfirm} disabled={cancelling} testID="transaction-cancel-confirm-yes">
            <Text style={styles.confirmDangerText}>{cancelling ? '…' : "Confirmer l'annulation"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function CorrectModal({
  visible,
  operation,
  categories,
  onClose,
  onSaved,
}: {
  visible: boolean;
  operation: api.FinancialOperationDetailApi;
  categories: api.CategoryApi[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [label, setLabel] = useState(operation.label);
  const [date, setDate] = useState(operation.date.slice(0, 10));
  const [amount, setAmount] = useState(String(operation.amount));
  const [categoryId, setCategoryId] = useState<string | null>(operation.categoryId);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setLabel(operation.label);
      setDate(operation.date.slice(0, 10));
      setAmount(String(operation.amount));
      setCategoryId(operation.categoryId);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [visible, operation]);

  const canSubmit = !!label.trim() && !!date && !!amount.trim() && !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await api.correctFinancialOperation(operation.id, { label: label.trim(), date, amount: amount.trim(), categoryId: categoryId ?? undefined });
      await onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const categoryOptions: SelectOption[] = categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <ScrollView ref={scrollRef} style={styles.sheet} contentContainerStyle={{ paddingBottom: bottomInset }}>
        <Text style={styles.sheetTitle}>Modifier la transaction</Text>
        <Text style={styles.sheetHelper}>
          L'opération d'origine sera renversée et remplacée par une nouvelle opération corrigée — l'historique garde une trace complète des deux.
        </Text>
        <FormField label="Libellé" value={label} onChangeText={setLabel} onFocus={handleFocus} testID="transaction-correct-label" />
        <DateField label="Date" value={date} onChange={setDate} />
        <FormField label="Montant" value={amount} onChangeText={setAmount} onFocus={handleFocus} keyboardType="decimal-pad" testID="transaction-correct-amount" />
        {categoryOptions.length > 0 && (
          <Select label="Catégorie" placeholder="Aucune" value={categoryId} options={categoryOptions} onChange={setCategoryId} testID="transaction-correct-category" />
        )}
        <TouchableOpacity style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]} onPress={submit} disabled={!canSubmit} testID="transaction-correct-submit">
          <Text style={styles.submitButtonText}>{saving ? 'Enregistrement…' : 'Enregistrer la correction'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  backRow: { flexDirection: 'row', alignItems: 'center' },
  backLabel: { ...typography.body, fontWeight: '600', marginLeft: 2 },
  title: { ...typography.screenTitle, paddingHorizontal: spacing.lg },
  amountCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    ...elevation.raised,
  },
  amountLabel: { ...typography.bodySecondary, marginBottom: spacing.xs },
  amountValue: { ...typography.amountPrimary },
  amountPlus: { color: colors.success },
  amountMinus: { color: colors.danger },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, marginHorizontal: spacing.lg, marginBottom: spacing.lg, ...elevation.card },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { ...typography.bodySecondary },
  rowValue: { ...typography.body, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  modifyButton: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceSecondary },
  modifyButtonText: { ...typography.body, fontWeight: '700', color: colors.textSecondary },
  cancelButton: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.danger, ...elevation.button },
  cancelButtonText: { ...typography.body, fontWeight: '700', color: colors.textOnPrimary },
  linkNote: { ...typography.caption, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  confirmBox: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, marginHorizontal: spacing.lg, position: 'absolute', bottom: 0, left: 0, right: 0 },
  confirmTitle: { ...typography.sectionTitle, marginBottom: spacing.sm },
  confirmText: { ...typography.bodySecondary, marginBottom: spacing.lg },
  confirmActions: { flexDirection: 'row', gap: spacing.md },
  confirmCancel: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceSecondary },
  confirmCancelText: { ...typography.body, fontWeight: '700', color: colors.textSecondary },
  confirmDanger: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.danger, ...elevation.button },
  confirmDangerText: { ...typography.body, fontWeight: '700', color: colors.textOnPrimary },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, padding: spacing.xl, maxHeight: '85%' },
  sheetTitle: { ...typography.sectionTitle, marginBottom: spacing.sm },
  sheetHelper: { ...typography.caption, marginBottom: spacing.lg },
  submitButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm, ...elevation.button },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
});
