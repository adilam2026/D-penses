import React, { useCallback, useState } from 'react';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as api from '../api/client';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, elevation, fontFamily, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatShortDate } from '../ui/formatMoney';
import { HelpButton } from '../ui/HelpButton';
import { ChoiceSheet } from '../ui/ChoiceSheet';
import { FormField } from '../ui/FormField';
import { DateField } from '../ui/DateField';
import { Select, SelectOption } from '../ui/Select';
import { useKeyboardAwareScroll } from '../ui/useKeyboardAwareScroll';

const FREQUENCY_LABELS: Record<api.RecurrenceFrequency, string> = {
  ONCE: 'Ponctuel',
  WEEKLY: 'Hebdomadaire',
  MONTHLY: 'Mensuel',
  BIMONTHLY: 'Bimestriel',
  QUARTERLY: 'Trimestriel',
  SEMIANNUAL: 'Semestriel',
  YEARLY: 'Annuel',
};

const FREQUENCY_OPTIONS: SelectOption[] = (Object.keys(FREQUENCY_LABELS) as api.RecurrenceFrequency[]).map((f) => ({
  value: f,
  label: FREQUENCY_LABELS[f],
}));

/**
 * Détail d'un plan financier (§10, §13-15) — Disponible actuel + prochaine
 * échéance + liste des échéances (navigation vers le détail) + postes.
 * La recommandation vient TOUJOURS du backend (calculée sur l'argent
 * réellement disponible), jamais recalculée côté écran.
 */
export function FinancialPlanDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ FinancialPlanDetail: { id: string } }, 'FinancialPlanDetail'>>();
  const { id } = route.params;
  const topInset = useTopInset();
  const bottomInset = useBottomInset();

  const [plan, setPlan] = useState<api.FinancialPlanApi | null>(null);
  const [accounts, setAccounts] = useState<api.AccountApi[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addDeadlineOpen, setAddDeadlineOpen] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);

  const load = useCallback(async () => {
    const [p, accs] = await Promise.all([api.getFinancialPlan(id), api.listAccounts()]);
    setPlan(p);
    setAccounts(accs);
  }, [id]);

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

  const next = plan.nextDeadline;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView style={[styles.container, { paddingTop: topInset }]} contentContainerStyle={{ paddingBottom: bottomInset + spacing.xxl }}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backRow} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
            <Text style={styles.backLabel}>Retour</Text>
          </TouchableOpacity>
          <View style={styles.headerActions}>
            <HelpButton
              title={plan.label}
              text="Ce plan regroupe les postes de dépense à préparer et vos échéances. La recommandation mensuelle se base uniquement sur l'argent réellement disponible, jamais sur un versement seulement prévu."
            />
            <TouchableOpacity testID="plan-detail-menu" onPress={() => setMenuOpen(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.title}>{plan.label}</Text>

        {next ? (
          <LinearGradient colors={['#4C5FA6', '#36488A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroCard} testID="plan-detail-next-deadline">
            <Text style={styles.heroKicker}>TOTAL PRÉVU — {next.label.toUpperCase()}</Text>
            <Text style={styles.heroAmount}>{formatDh(next.totalPrevu)}</Text>
            <View style={styles.heroBarTrack}>
              <View style={[styles.heroBarFill, { width: `${Math.min(100, next.totalPrevu > 0 ? (next.disponible / next.totalPrevu) * 100 : 0)}%` }]} />
            </View>
            <Text style={styles.heroDeadlineMeta}>
              {formatDh(next.disponible)} déjà épargnés · reste {formatDh(next.reste)} · échéance le {formatShortDate(next.dueDate)}
            </Text>
            <View style={styles.heroStatsRow}>
              <View style={styles.heroStat}>
                <Text style={styles.heroRowLabel}>Disponible</Text>
                <Text style={styles.heroRowValue}>{formatDh(next.disponible)}</Text>
              </View>
              <View style={styles.heroStat}>
                <Text style={styles.heroRowLabel}>Reste</Text>
                <Text style={styles.heroRowValue}>{formatDh(next.reste)}</Text>
              </View>
              <View style={styles.heroStat}>
                <Text style={styles.heroRowLabel}>Recommandation</Text>
                <Text style={styles.heroRowValue}>{formatDh(next.recommendedMonthly)}/mois</Text>
              </View>
            </View>
          </LinearGradient>
        ) : (
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Disponible actuel</Text>
            <Text style={styles.balanceAmount}>{formatDh(plan.disponibleActuel ?? 0)}</Text>
          </View>
        )}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>POSTES DU PLAN</Text>
          <TouchableOpacity onPress={() => setAddItemOpen(true)} testID="plan-detail-add-item">
            <Text style={styles.addLink}>+ Ajouter un poste</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.card}>
          {plan.items.length === 0 ? (
            <Text style={styles.emptyText}>Aucun poste pour l'instant.</Text>
          ) : (
            plan.items.map((item, idx) => (
              <View key={item.id} style={[styles.itemRow, idx < plan.items.length - 1 && styles.rowBorder]}>
                <Text style={styles.itemLabel}>{item.label}</Text>
                <Text style={styles.itemMeta}>
                  {item.expectedAmount != null ? formatDh(item.expectedAmount) : '—'} · {FREQUENCY_LABELS[item.frequency]}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>ÉCHÉANCES</Text>
          <TouchableOpacity onPress={() => setAddDeadlineOpen(true)} testID="plan-detail-add-deadline">
            <Text style={styles.addLink}>+ Ajouter</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.card}>
          {plan.deadlines.length === 0 ? (
            <Text style={styles.emptyText}>Aucune échéance pour l'instant.</Text>
          ) : (
            plan.deadlines.map((d, idx) => (
              <TouchableOpacity
                key={d.deadlineId}
                style={[styles.deadlineRow, idx < plan.deadlines.length - 1 && styles.rowBorder]}
                onPress={() => navigation.navigate('DeadlineDetail', { planId: plan.id, deadlineId: d.deadlineId })}
                testID={`plan-detail-deadline-${d.deadlineId}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.deadlineLabel}>{d.label}</Text>
                  <Text style={styles.deadlineMeta}>
                    {formatShortDate(d.dueDate)} · {formatDh(d.totalPrevu)}
                  </Text>
                </View>
                {d.paid ? (
                  <Text style={styles.paidBadge}>Payée ✓</Text>
                ) : (
                  <Text style={styles.pendingBadge}>À venir</Text>
                )}
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>

      <ChoiceSheet
        visible={menuOpen}
        title={plan.label}
        onClose={() => setMenuOpen(false)}
        testID="plan-detail-choice-sheet"
        options={[{ key: 'edit', label: 'Modifier', icon: 'create-outline', onPress: () => setEditOpen(true) }]}
      />

      <EditPlanModal visible={editOpen} plan={plan} accounts={accounts} onClose={() => setEditOpen(false)} onSaved={load} />
      <AddDeadlineModal visible={addDeadlineOpen} planId={plan.id} onClose={() => setAddDeadlineOpen(false)} onSaved={load} />
      <AddItemModal visible={addItemOpen} planId={plan.id} onClose={() => setAddItemOpen(false)} onSaved={load} />
    </View>
  );
}

function EditPlanModal({
  visible,
  plan,
  accounts,
  onClose,
  onSaved,
}: {
  visible: boolean;
  plan: api.FinancialPlanApi;
  accounts: api.AccountApi[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [label, setLabel] = useState(plan.label);
  const [accountId, setAccountId] = useState<string | null>(plan.accountId);
  const [subaccountId, setSubaccountId] = useState<string | null>(plan.subaccountId);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setLabel(plan.label);
      setAccountId(plan.accountId);
      setSubaccountId(plan.subaccountId);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [visible, plan]);

  const accountOptions: SelectOption[] = accounts.map((a) => ({ value: a.id, label: a.name }));
  const selectedAccount = accounts.find((a) => a.id === accountId) ?? null;
  const subaccountOptions: SelectOption[] = (selectedAccount?.subaccounts ?? []).map((s) => ({ value: s.id, label: s.name }));

  async function submit() {
    if (!label.trim() || saving) return;
    setSaving(true);
    try {
      await api.updateFinancialPlan(plan.id, { label: label.trim(), accountId: accountId ?? undefined, subaccountId: subaccountId ?? undefined });
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
        <Text style={styles.sheetTitle}>Modifier le plan</Text>
        <FormField label="Libellé" value={label} onChangeText={setLabel} onFocus={handleFocus} testID="plan-edit-label" />
        <Select
          label="Compte lié"
          placeholder="Aucun"
          value={accountId}
          options={accountOptions}
          onChange={(v) => {
            setAccountId(v);
            setSubaccountId(null);
          }}
          testID="plan-edit-account"
        />
        {selectedAccount && subaccountOptions.length > 0 ? (
          <Select label="Sous-compte" placeholder="Aucun" value={subaccountId} options={subaccountOptions} onChange={setSubaccountId} testID="plan-edit-subaccount" />
        ) : null}
        <TouchableOpacity style={[styles.submitButton, (!label.trim() || saving) && styles.submitButtonDisabled]} onPress={submit} disabled={!label.trim() || saving} testID="plan-edit-submit">
          <Text style={styles.submitButtonText}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </Modal>
  );
}

function AddDeadlineModal({ visible, planId, onClose, onSaved }: { visible: boolean; planId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [label, setLabel] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setLabel('');
      setDueDate('');
      setAmount('');
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [visible]);

  const canSubmit = !!label.trim() && !!dueDate && !!amount.trim() && !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await api.addFinancialPlanDeadline(planId, { label: label.trim(), dueDate, amount: amount.trim() });
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
        <Text style={styles.sheetTitle}>Ajouter une échéance</Text>
        <FormField label="Libellé" value={label} onChangeText={setLabel} onFocus={handleFocus} placeholder="Ex. Janvier" testID="add-deadline-label" />
        <DateField label="Date" value={dueDate} onChange={setDueDate} />
        <FormField label="Montant" value={amount} onChangeText={setAmount} onFocus={handleFocus} placeholder="Ex. 3000" keyboardType="decimal-pad" testID="add-deadline-amount" />
        <TouchableOpacity style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]} onPress={submit} disabled={!canSubmit} testID="add-deadline-submit">
          <Text style={styles.submitButtonText}>{saving ? 'Enregistrement…' : 'Ajouter'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </Modal>
  );
}

function AddItemModal({ visible, planId, onClose, onSaved }: { visible: boolean; planId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<api.RecurrenceFrequency>('ONCE');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setLabel('');
      setAmount('');
      setFrequency('ONCE');
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [visible]);

  async function submit() {
    if (!label.trim() || saving) return;
    setSaving(true);
    try {
      await api.addFinancialPlanItem(planId, { label: label.trim(), expectedAmount: amount.trim() || undefined, frequency });
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
        <Text style={styles.sheetTitle}>Ajouter un poste</Text>
        <FormField label="Libellé" value={label} onChangeText={setLabel} onFocus={handleFocus} placeholder="Ex. Frais école" testID="add-item-label" />
        <FormField label="Montant estimé" value={amount} onChangeText={setAmount} onFocus={handleFocus} keyboardType="decimal-pad" testID="add-item-amount" />
        <Select label="Fréquence" value={frequency} options={FREQUENCY_OPTIONS} onChange={(v) => setFrequency(v as api.RecurrenceFrequency)} testID="add-item-frequency" />
        <Text style={styles.helperText}>
          Un poste récurrent s'applique automatiquement à chaque échéance existante du plan.
        </Text>
        <TouchableOpacity style={[styles.submitButton, (!label.trim() || saving) && styles.submitButtonDisabled]} onPress={submit} disabled={!label.trim() || saving} testID="add-item-submit">
          <Text style={styles.submitButtonText}>{saving ? 'Enregistrement…' : 'Ajouter'}</Text>
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { ...typography.screenTitle, paddingHorizontal: spacing.lg },
  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  balanceLabel: { ...typography.bodySecondary, marginBottom: spacing.xs },
  balanceAmount: { ...typography.amountPrimary },
  // Carte récapitulative « TOTAL PRÉVU » (maquette « Foyer » validée) :
  // montant mis en avant, barre de progression déjà épargné/besoin, puis une
  // rangée de statistiques compactes — jamais une simple liste de lignes
  // à plat sur fond neutre.
  heroCard: {
    backgroundColor: colors.surfaceActive,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    ...elevation.card,
  },
  heroKicker: { fontSize: 11, fontFamily: fontFamily.sansBold, color: 'rgba(255,255,255,0.85)', letterSpacing: 0.5 },
  heroAmount: { fontSize: 30, fontFamily: fontFamily.displayBold, color: colors.textOnPrimary, marginTop: 4 },
  heroBarTrack: { height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden', marginTop: spacing.md },
  heroBarFill: { height: 7, borderRadius: 4, backgroundColor: '#FFFFFF' },
  heroDeadlineMeta: { fontSize: 11.5, fontFamily: fontFamily.sansMedium, color: 'rgba(255,255,255,0.85)', marginTop: spacing.sm },
  heroStatsRow: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.md },
  heroStat: { flex: 1 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  sectionLabel: { ...typography.sectionLabel, color: colors.textSecondary, letterSpacing: 0.5 },
  addLink: { ...typography.body, fontWeight: '700', color: colors.primary },
  emptyText: { ...typography.bodySecondary, padding: spacing.md },
  // Blocs POSTES/ÉCHÉANCES (maquette validée) : une carte blanche unique par
  // bloc, lignes internes séparées par un filet (rowBorder), jamais une carte
  // par ligne.
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    ...elevation.card,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  deadlineRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  deadlineLabel: { ...typography.body, fontWeight: '700' },
  deadlineMeta: { ...typography.caption, marginTop: 2 },
  paidBadge: { ...typography.caption, fontWeight: '800', color: colors.success, backgroundColor: colors.successLight, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  pendingBadge: { ...typography.caption, fontWeight: '800', color: colors.warning, backgroundColor: colors.warningLight, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
  },
  itemLabel: { ...typography.body, fontWeight: '600' },
  itemMeta: { ...typography.caption },
  heroRowLabel: { fontSize: 10.5, fontFamily: fontFamily.sansMedium, color: 'rgba(255,255,255,0.75)' },
  heroRowValue: { fontSize: 13, fontFamily: fontFamily.sansBold, color: colors.textOnPrimary, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, padding: spacing.xl, maxHeight: '85%' },
  sheetTitle: { ...typography.sectionTitle, marginBottom: spacing.lg },
  helperText: { ...typography.caption, marginBottom: spacing.md },
  submitButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm, ...elevation.button },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
});
