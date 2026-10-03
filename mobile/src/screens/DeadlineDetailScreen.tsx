import React, { useCallback, useState } from 'react';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, elevation, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatShortDate } from '../ui/formatMoney';
import { HelpButton } from '../ui/HelpButton';
import { FormField } from '../ui/FormField';
import { Select, SelectOption } from '../ui/Select';
import { useKeyboardAwareScroll } from '../ui/useKeyboardAwareScroll';

/**
 * Détail d'une échéance (§12) — breakdown par poste + TOTAL, "Modifier"
 * (ajuste/ajoute un poste pour CETTE échéance précisément) et "Marquer comme
 * payée" (réalise en bloc toutes les lignes encore prévues, §12).
 */
export function DeadlineDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ DeadlineDetail: { planId: string; deadlineId: string } }, 'DeadlineDetail'>>();
  const { planId, deadlineId } = route.params;
  const topInset = useTopInset();
  const bottomInset = useBottomInset();

  const [plan, setPlan] = useState<api.FinancialPlanApi | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    setPlan(await api.getFinancialPlan(planId));
  }, [planId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!plan) {
    return (
      <View style={[styles.center, { paddingTop: topInset }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const deadline = plan.deadlines.find((d) => d.deadlineId === deadlineId) ?? null;
  if (!deadline) {
    return (
      <View style={[styles.center, { paddingTop: topInset }]}>
        <Text style={styles.emptyText}>Échéance introuvable.</Text>
      </View>
    );
  }

  async function markPaid() {
    if (marking) return;
    setMarking(true);
    try {
      await api.markDeadlinePaid(deadlineId);
      await load();
    } finally {
      setMarking(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView style={[styles.container, { paddingTop: topInset }]} contentContainerStyle={{ paddingBottom: bottomInset + spacing.xxl }}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backRow} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
            <Text style={styles.backLabel}>{plan.label}</Text>
          </TouchableOpacity>
          <HelpButton
            title={deadline.label}
            text="Le détail d'une échéance montre chaque poste attendu pour cette date précise. Marquer comme payée règle en une fois toutes les lignes encore prévues."
          />
        </View>

        <Text style={styles.title}>{deadline.label}</Text>
        <Text style={styles.subtitle}>{formatShortDate(deadline.dueDate)}</Text>

        {deadline.items.length === 0 ? (
          <Text style={styles.emptyText}>Aucun poste pour cette échéance.</Text>
        ) : (
          deadline.items.map((item) => (
            <View key={item.plannedOperationId} style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemLabel}>{item.label}</Text>
                <Text style={styles.itemStatus}>{item.status === 'REALIZED' ? 'Payé' : 'Prévu'}</Text>
              </View>
              <Text style={styles.itemAmount}>{formatDh(item.amount)}</Text>
            </View>
          ))
        )}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Text style={styles.totalAmount}>{formatDh(deadline.totalPrevu)}</Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.editButton} onPress={() => setEditOpen(true)} testID="deadline-detail-edit">
            <Text style={styles.editButtonText}>Modifier</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.payButton, deadline.paid && styles.payButtonDisabled]}
            onPress={markPaid}
            disabled={deadline.paid || marking}
            testID="deadline-detail-mark-paid"
          >
            <Text style={styles.payButtonText}>{deadline.paid ? 'Payée ✓' : marking ? '…' : 'Marquer comme payée'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <EditDeadlineModal visible={editOpen} plan={plan} deadlineId={deadlineId} onClose={() => setEditOpen(false)} onSaved={load} />
    </View>
  );
}

function EditDeadlineModal({
  visible,
  plan,
  deadlineId,
  onClose,
  onSaved,
}: {
  visible: boolean;
  plan: api.FinancialPlanApi;
  deadlineId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [itemId, setItemId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setItemId(null);
      setAmount('');
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [visible]);

  const itemOptions: SelectOption[] = plan.items.map((i) => ({ value: i.id, label: i.label }));

  async function submit() {
    if (!itemId || !amount.trim() || saving) return;
    setSaving(true);
    try {
      await api.addItemToDeadline(deadlineId, { itemId, amount: amount.trim() });
      await onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <ScrollView ref={scrollRef} style={styles.sheet} contentContainerStyle={{ paddingBottom: bottomInset }}>
        <Text style={styles.sheetTitle}>Ajuster un poste</Text>
        {plan.items.length === 0 ? (
          <Text style={styles.emptyText}>Ajoutez d'abord un poste au plan.</Text>
        ) : (
          <>
            <Select label="Poste" value={itemId} options={itemOptions} onChange={setItemId} testID="deadline-edit-item" />
            <FormField label="Montant pour cette échéance" value={amount} onChangeText={setAmount} onFocus={handleFocus} keyboardType="decimal-pad" testID="deadline-edit-amount" />
            <TouchableOpacity
              style={[styles.submitButton, (!itemId || !amount.trim() || saving) && styles.submitButtonDisabled]}
              onPress={submit}
              disabled={!itemId || !amount.trim() || saving}
              testID="deadline-edit-submit"
            >
              <Text style={styles.submitButtonText}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  backRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  backLabel: { ...typography.body, fontWeight: '600', marginLeft: 2 },
  title: { ...typography.screenTitle, paddingHorizontal: spacing.lg },
  subtitle: { ...typography.bodySecondary, paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  emptyText: { ...typography.bodySecondary, paddingHorizontal: spacing.lg },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  itemLabel: { ...typography.body, fontWeight: '600' },
  itemStatus: { ...typography.caption, marginTop: 2 },
  itemAmount: { ...typography.body, fontWeight: '700' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
  },
  totalLabel: { ...typography.body, fontWeight: '800' },
  totalAmount: { ...typography.body, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  editButton: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceSecondary },
  editButtonText: { ...typography.body, fontWeight: '700', color: colors.textSecondary },
  payButton: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary },
  payButtonDisabled: { opacity: 0.5 },
  payButtonText: { ...typography.body, fontWeight: '700', color: colors.textOnPrimary },
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, padding: spacing.xl, maxHeight: '85%' },
  sheetTitle: { ...typography.sectionTitle, marginBottom: spacing.lg },
  submitButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm, ...elevation.button },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
});
