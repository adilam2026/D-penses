import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { colors, elevation, radius, spacing, typography } from './theme';
import { formatDh, formatShortDate } from './formatMoney';
import { OPERATION_KIND_LABELS } from './operationKindLabel';
import { FormField } from './FormField';
import { DateField } from './DateField';
import { useBottomInset } from './useBottomInset';
import { useKeyboardAwareScroll } from './useKeyboardAwareScroll';
import { TRANSACTION_ACTION_LABELS } from './transactionLabels';
import { accountLabelFor } from './accountLabel';

type Mode = 'view' | 'edit' | 'cancelConfirm';

/**
 * Détail d'une transaction pas encore réalisée (Prochaines transactions §3/§4) —
 * réutilisé par l'Accueil et par la liste chronologique complète, pour garantir
 * un seul et même comportement partout : Modifier/Annuler/Fermer, libellés
 * identiques à TransactionDetailScreen (jamais un "Annuler" ambigu).
 */
export function PlannedOperationActionsModal({
  target,
  accounts,
  onClose,
  onChanged,
}: {
  target: api.PlannedOperationApi | null;
  accounts: api.AccountApi[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [mode, setMode] = useState<Mode>('view');
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (target) {
      setMode('view');
      setLabel(target.label);
      setDate(target.expectedDate.slice(0, 10));
      setAmount(String(target.expectedAmount));
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [target?.id]);

  if (!target) return null;

  const isExpense = target.sourceAccountId && !target.destinationAccountId;
  const { accountId, subaccountId, preposition } = isExpense
    ? { accountId: target.sourceAccountId, subaccountId: target.sourceSubaccountId, preposition: 'débité' as const }
    : { accountId: target.destinationAccountId, subaccountId: target.destinationSubaccountId, preposition: 'crédité' as const };
  const accountLabel = accountLabelFor(accounts, accountId, subaccountId);

  async function realize() {
    if (saving || !target) return;
    setSaving(true);
    try {
      await api.realizePlannedOperation(target.id, { actualAmount: String(target.expectedAmount) });
      await onChanged();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (saving || !target || !label.trim() || !amount.trim()) return;
    setSaving(true);
    try {
      await api.updatePlannedOperation(target.id, { label: label.trim(), expectedDate: date, expectedAmount: amount.trim() });
      await onChanged();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function confirmCancel() {
    if (saving || !target) return;
    setSaving(true);
    try {
      await api.cancelPlannedOperation(target.id);
      await onChanged();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <ScrollView ref={scrollRef} style={styles.sheet} contentContainerStyle={{ paddingBottom: bottomInset }}>
        {/* Fermer/Retour en haut (§3/§4, écran allégé) — jamais un bouton pleine
            largeur en plus, en bas, qui empile les actions. */}
        <View style={styles.headerRow}>
          <Text style={styles.title}>{mode === 'view' ? target.label : mode === 'edit' ? TRANSACTION_ACTION_LABELS.modify : `${TRANSACTION_ACTION_LABELS.cancel} ?`}</Text>
          <TouchableOpacity
            onPress={mode === 'view' ? onClose : () => setMode('view')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            testID={mode === 'view' ? 'planned-op-close' : mode === 'edit' ? 'planned-op-edit-back' : 'planned-op-cancel-back'}
          >
            <Ionicons name={mode === 'view' ? 'close' : 'chevron-back'} size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {mode === 'view' && (
          <>
            <Text style={styles.kind}>{OPERATION_KIND_LABELS[target.kind]}</Text>
            <View style={styles.card}>
              <Row label="Montant prévu" value={formatDh(target.expectedAmount)} />
              <Row label="Date prévue" value={formatShortDate(target.expectedDate)} />
              <Row label="Compte" value={accountLabel ? `${accountLabel} (sera ${preposition})` : '—'} last />
            </View>
            {/* Action principale mise en avant ; actions secondaires plus
                discrètes côte à côte (§4) — jamais 4 gros boutons empilés. */}
            <TouchableOpacity style={styles.primaryButton} onPress={realize} disabled={saving} testID="planned-op-realize">
              <Text style={styles.primaryButtonText}>{saving ? '…' : 'Marquer réalisée'}</Text>
            </TouchableOpacity>
            <View style={styles.secondaryRow}>
              <TouchableOpacity style={styles.modifyButton} onPress={() => setMode('edit')} testID="planned-op-modify">
                <Text style={styles.modifyButtonText}>{TRANSACTION_ACTION_LABELS.modify}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setMode('cancelConfirm')} testID="planned-op-cancel">
                <Text style={styles.cancelButtonText}>{TRANSACTION_ACTION_LABELS.cancel}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {mode === 'edit' && (
          <>
            <FormField label="Libellé" value={label} onChangeText={setLabel} onFocus={handleFocus} testID="planned-op-edit-label" />
            <DateField label="Date prévue" value={date} onChange={setDate} />
            <FormField label="Montant prévu" value={amount} onChangeText={setAmount} onFocus={handleFocus} keyboardType="decimal-pad" testID="planned-op-edit-amount" />
            <TouchableOpacity
              style={[styles.primaryButton, (!label.trim() || !amount.trim() || saving) && styles.buttonDisabled]}
              onPress={saveEdit}
              disabled={!label.trim() || !amount.trim() || saving}
              testID="planned-op-edit-submit"
            >
              <Text style={styles.primaryButtonText}>{saving ? '…' : 'Enregistrer'}</Text>
            </TouchableOpacity>
          </>
        )}

        {mode === 'cancelConfirm' && (
          <>
            <Text style={styles.confirmText}>« {target.label} » ne sera plus prévue. Cette transaction n'a pas encore eu lieu — elle est simplement retirée.</Text>
            <TouchableOpacity style={styles.dangerButton} onPress={confirmCancel} disabled={saving} testID="planned-op-cancel-confirm">
              <Text style={styles.dangerButtonText}>{saving ? '…' : "Confirmer l'annulation"}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </Modal>
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, padding: spacing.xl, maxHeight: '85%' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.xs },
  title: { ...typography.sectionTitle, flex: 1, marginRight: spacing.md },
  kind: { ...typography.bodySecondary, marginBottom: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, marginBottom: spacing.lg, ...elevation.card },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { ...typography.bodySecondary },
  rowValue: { ...typography.body, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  confirmText: { ...typography.bodySecondary, marginBottom: spacing.lg },
  // Action principale (§4) : seule pleine largeur, avec relief.
  primaryButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', ...elevation.button },
  primaryButtonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  buttonDisabled: { opacity: 0.5 },
  // Actions secondaires (§4) : côte à côte, plus petites, sans relief — se
  // distinguent clairement de l'action principale au lieu de s'empiler.
  secondaryRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  modifyButton: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' },
  modifyButtonText: { ...typography.caption, fontWeight: '700', color: colors.textSecondary },
  cancelButton: { flex: 1, backgroundColor: colors.dangerLight, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' },
  cancelButtonText: { ...typography.caption, fontWeight: '700', color: colors.danger },
  dangerButton: { backgroundColor: colors.danger, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', ...elevation.button },
  dangerButtonText: { ...typography.body, fontWeight: '700', color: colors.textOnPrimary },
});
