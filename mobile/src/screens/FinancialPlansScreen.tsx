import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, elevation, fontFamily, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatShortDate } from '../ui/formatMoney';
import { HelpButton } from '../ui/HelpButton';
import { FormField } from '../ui/FormField';
import { Select, SelectOption } from '../ui/Select';
import { useKeyboardAwareScroll } from '../ui/useKeyboardAwareScroll';

/**
 * Liste des plans financiers (§13, §21 "Organisation > Plans financiers") —
 * point d'entrée depuis le menu, avec création d'un plan (libellé + compte
 * lié optionnel). Les postes/échéances se construisent ensuite dans le
 * détail du plan, jamais dans un assistant multi-étapes ici.
 */
export function FinancialPlansScreen() {
  const navigation = useNavigation<any>();
  const topInset = useTopInset();
  const bottomInset = useBottomInset();
  const [plans, setPlans] = useState<api.FinancialPlanApi[] | null>(null);
  const [accounts, setAccounts] = useState<api.AccountApi[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    const [planList, accountList] = await Promise.all([api.listFinancialPlans(), api.listAccounts()]);
    setPlans(planList);
    setAccounts(accountList);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!plans) {
    return (
      <View style={[styles.center, { paddingTop: topInset }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView style={[styles.container, { paddingTop: topInset }]} contentContainerStyle={{ paddingBottom: bottomInset + spacing.xxl }}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backRow} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
            <Text style={styles.backLabel}>Menu</Text>
          </TouchableOpacity>
          <HelpButton
            title="Plans financiers"
            text="Un plan financier regroupe les postes de dépense à préparer pour une échéance (scolarité, voyage…). La recommandation mensuelle se base sur l'argent réellement disponible."
          />
        </View>

        <Text style={styles.title}>Plans financiers</Text>

        {plans.length === 0 ? (
          <Text style={styles.emptyText}>Aucun plan financier pour l'instant.</Text>
        ) : (
          plans.map((plan) => {
            const totalPrevu = plan.nextDeadline?.totalPrevu ?? null;
            const disponible = plan.disponibleActuel ?? 0;
            const percent = totalPrevu && totalPrevu > 0 ? Math.min(100, Math.round((disponible / totalPrevu) * 100)) : null;
            return (
              <TouchableOpacity
                key={plan.id}
                style={styles.planCard}
                onPress={() => navigation.navigate('FinancialPlanDetail', { id: plan.id })}
                testID={`plans-list-plan-${plan.id}`}
              >
                <View style={styles.planTopRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planLabel}>{plan.label}</Text>
                    {plan.nextDeadline ? (
                      <Text style={styles.planMeta}>Prochaine échéance · {plan.nextDeadline.label}</Text>
                    ) : (
                      <Text style={styles.planMeta}>Aucune échéance planifiée.</Text>
                    )}
                  </View>
                  {totalPrevu !== null ? (
                    <View style={styles.planBadge}>
                      <Text style={styles.planBadgeText}>{formatDh(totalPrevu)}</Text>
                    </View>
                  ) : null}
                </View>
                {percent !== null ? (
                  <>
                    <View style={styles.planBarTrack}>
                      <View style={[styles.planBarFill, { width: `${percent}%` }]} />
                    </View>
                    <View style={styles.planBottomRow}>
                      <Text style={styles.planFooterText}>{formatDh(disponible)} épargnés</Text>
                      <Text style={styles.planFooterLink}>Voir le plan ›</Text>
                    </View>
                  </>
                ) : (
                  <View style={styles.planBottomRow}>
                    <Text style={styles.planFooterText} />
                    <Text style={styles.planFooterLink}>Voir le plan ›</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}

        <TouchableOpacity style={styles.createButton} onPress={() => setCreateOpen(true)} testID="plans-list-create">
          <Text style={styles.createButtonText}>+ Nouveau plan financier</Text>
        </TouchableOpacity>
      </ScrollView>

      <CreatePlanModal
        visible={createOpen}
        accounts={accounts}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          setCreateOpen(false);
          navigation.navigate('FinancialPlanDetail', { id });
        }}
      />
    </View>
  );
}

function CreatePlanModal({
  visible,
  accounts,
  onClose,
  onCreated,
}: {
  visible: boolean;
  accounts: api.AccountApi[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [label, setLabel] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [subaccountId, setSubaccountId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setLabel('');
      setAccountId(null);
      setSubaccountId(null);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [visible]);

  const accountOptions: SelectOption[] = accounts.map((a) => ({ value: a.id, label: a.name }));
  const selectedAccount = accounts.find((a) => a.id === accountId) ?? null;
  const subaccountOptions: SelectOption[] = (selectedAccount?.subaccounts ?? []).map((s) => ({ value: s.id, label: s.name }));

  async function submit() {
    if (!label.trim() || saving) return;
    setSaving(true);
    try {
      const plan = await api.createFinancialPlan({ label: label.trim(), accountId: accountId ?? undefined, subaccountId: subaccountId ?? undefined });
      onCreated(plan.id);
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
        <Text style={styles.sheetTitle}>Nouveau plan financier</Text>
        <FormField label="Libellé" value={label} onChangeText={setLabel} onFocus={handleFocus} placeholder="Ex. Scolarité" testID="create-plan-label" />
        <Select
          label="Compte lié (optionnel)"
          placeholder="Aucun"
          value={accountId}
          options={accountOptions}
          onChange={(v) => {
            setAccountId(v);
            setSubaccountId(null);
          }}
          testID="create-plan-account"
        />
        {selectedAccount && subaccountOptions.length > 0 ? (
          <Select label="Sous-compte (optionnel)" placeholder="Aucun" value={subaccountId} options={subaccountOptions} onChange={setSubaccountId} testID="create-plan-subaccount" />
        ) : null}
        <TouchableOpacity style={[styles.submitButton, (!label.trim() || saving) && styles.submitButtonDisabled]} onPress={submit} disabled={!label.trim() || saving} testID="create-plan-submit">
          <Text style={styles.submitButtonText}>{saving ? 'Création…' : 'Créer le plan'}</Text>
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
  backLabel: { fontSize: 14, fontFamily: fontFamily.sansSemiBold, color: colors.textPrimary, marginLeft: 2 },
  title: { ...typography.screenTitle, paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  createButton: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  createButtonText: { fontSize: 13.5, fontFamily: fontFamily.sansBold, color: colors.textPrimary },
  emptyText: { ...typography.bodySecondary, paddingHorizontal: spacing.lg },
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    ...elevation.card,
  },
  planTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  planLabel: { fontSize: 16, fontFamily: fontFamily.displayBold, color: colors.textPrimary },
  planMeta: { ...typography.caption, marginTop: 3 },
  planBadge: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  planBadgeText: { fontSize: 10.5, fontFamily: fontFamily.sansExtraBold, color: colors.textPrimary },
  planBarTrack: { height: 7, borderRadius: 4, backgroundColor: colors.surfaceSecondary, marginTop: spacing.md, overflow: 'hidden' },
  planBarFill: { height: 7, borderRadius: 4, backgroundColor: colors.secondary },
  planBottomRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  planFooterText: { fontSize: 11, fontFamily: fontFamily.sansMedium, color: colors.textSecondary },
  planFooterLink: { fontSize: 11, fontFamily: fontFamily.sansMedium, color: colors.textSecondary },
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, padding: spacing.xl, maxHeight: '85%' },
  sheetTitle: { ...typography.sectionTitle, marginBottom: spacing.lg },
  submitButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm, ...elevation.button },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
});
