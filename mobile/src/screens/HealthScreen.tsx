import React, { useCallback, useMemo, useState } from 'react';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatShortDate } from '../ui/formatMoney';
import { ChoiceSheet } from '../ui/ChoiceSheet';
import { RenameModal } from '../ui/RenameModal';
import { HelpButton } from '../ui/HelpButton';
import { FormField } from '../ui/FormField';
import { Select } from '../ui/Select';
import { DateField } from '../ui/DateField';
import { useKeyboardAwareScroll } from '../ui/useKeyboardAwareScroll';

type Tab = 'depenses' | 'remboursements';

/**
 * Santé / Mutuelle — exception au Détail sous-compte classique (§10) : deux
 * onglets Dépenses/Remboursements, dossiers en attente avec Engagé/Remboursé/
 * Reste/Statut, "J'ai reçu un remboursement" + historique des dossiers clos.
 */
export function HealthScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ Health: { id: string } }, 'Health'>>();
  const { id } = route.params;
  const topInset = useTopInset();
  const bottomInset = useBottomInset();

  const [account, setAccount] = useState<api.AccountApi | null>(null);
  const [subaccount, setSubaccount] = useState<api.SubaccountApi | null>(null);
  const [expenses, setExpenses] = useState<api.FinancialOperationApi[] | null>(null);
  const [claims, setClaims] = useState<api.MedicalClaimApi[] | null>(null);
  const [tab, setTab] = useState<Tab>('depenses');
  const [showHistory, setShowHistory] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [reimburseClaim, setReimburseClaim] = useState<api.MedicalClaimApi | null>(null);
  const [closeConfirmClaim, setCloseConfirmClaim] = useState<api.MedicalClaimApi | null>(null);

  const load = useCallback(async () => {
    const [accounts, ops, claimList] = await Promise.all([
      api.listAccounts(),
      api.listFinancialOperations({ subaccountId: id }),
      api.listMedicalClaims(id),
    ]);
    const parent = accounts.find((a) => a.subaccounts.some((s) => s.id === id));
    setAccount(parent ?? null);
    setSubaccount(parent?.subaccounts.find((s) => s.id === id) ?? null);
    setExpenses(ops.filter((o) => o.kind === 'EXPENSE'));
    setClaims(claimList);
  }, [id]);

  // Une dépense est "remboursable" ssi un dossier lui est rattaché (§3) — jamais un simple champ déclaratif.
  const claimByOperationId = useMemo(() => {
    const map = new Map<string, api.MedicalClaimApi>();
    for (const claim of claims ?? []) map.set(claim.sourceOperationId, claim);
    return map;
  }, [claims]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const pendingClaims = useMemo(() => (claims ?? []).filter((c) => c.status === 'PENDING'), [claims]);
  const closedClaims = useMemo(() => (claims ?? []).filter((c) => c.status === 'CLOSED'), [claims]);

  async function closeClaim(claimId: string) {
    await api.closeMedicalClaimManually(claimId);
    setCloseConfirmClaim(null);
    await load();
  }

  if (!account || !subaccount) {
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
            <Text style={styles.backLabel}>Accueil</Text>
          </TouchableOpacity>
          <View style={styles.headerActions}>
            <HelpButton
              title={subaccount.name}
              text="Dépenses liste les frais de santé réglés. Remboursements suit les dossiers en attente auprès de la mutuelle : Engagé (payé), Remboursé (reçu), Reste (encore attendu)."
            />
            <TouchableOpacity testID="health-menu" onPress={() => setMenuOpen(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.title}>{subaccount.name}</Text>
        <Text style={styles.subtitle}>Rattaché à {account.name}</Text>

        <View style={styles.tabs}>
          <TouchableOpacity style={[styles.tab, tab === 'depenses' && styles.tabActive]} onPress={() => setTab('depenses')} testID="health-tab-depenses">
            <Text style={[styles.tabText, tab === 'depenses' && styles.tabTextActive]}>Dépenses</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'remboursements' && styles.tabActive]}
            onPress={() => setTab('remboursements')}
            testID="health-tab-remboursements"
          >
            <Text style={[styles.tabText, tab === 'remboursements' && styles.tabTextActive]}>Remboursements</Text>
          </TouchableOpacity>
        </View>

        {tab === 'depenses' ? (
          <View style={{ marginTop: spacing.lg }}>
            {(expenses ?? []).length === 0 ? (
              <Text style={styles.emptyText}>Aucune dépense santé pour l'instant.</Text>
            ) : (
              (expenses ?? []).map((op) => {
                const claim = claimByOperationId.get(op.id);
                return (
                  <View key={op.id} style={styles.opRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.opLabel}>{op.label}</Text>
                      <Text style={styles.opMeta}>
                        {formatShortDate(op.date)} · {claim ? 'Remboursable' : 'Non remboursable'}
                        {claim ? ` · ${claim.status === 'CLOSED' ? 'Clôturé' : claim.amountReimbursed > 0 ? 'Partiel' : 'En attente'}` : ''}
                      </Text>
                    </View>
                    <Text style={[styles.opAmount, styles.opAmountMinus]}>-{formatDh(op.amount)}</Text>
                  </View>
                );
              })
            )}
          </View>
        ) : (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={styles.sectionLabel}>DOSSIERS EN ATTENTE</Text>
            {pendingClaims.length === 0 ? (
              <Text style={styles.emptyText}>Aucun dossier en attente.</Text>
            ) : (
              pendingClaims.map((claim) => (
                <ClaimCard key={claim.id} claim={claim} onReimburse={() => setReimburseClaim(claim)} onClose={() => setCloseConfirmClaim(claim)} />
              ))
            )}

            {closedClaims.length > 0 && (
              <TouchableOpacity style={styles.historyButton} onPress={() => setShowHistory((v) => !v)} testID="health-toggle-history">
                <Text style={styles.historyButtonText}>
                  {showHistory ? 'Masquer' : 'Afficher'} l'historique des dossiers ({closedClaims.length})
                </Text>
              </TouchableOpacity>
            )}
            {showHistory && closedClaims.map((claim) => <ClaimCard key={claim.id} claim={claim} closed />)}
          </View>
        )}
      </ScrollView>

      <ChoiceSheet
        visible={menuOpen}
        title={subaccount.name}
        onClose={() => setMenuOpen(false)}
        testID="health-choice-sheet"
        options={[
          { key: 'edit', label: 'Modifier', icon: 'create-outline', onPress: () => setRenameOpen(true) },
          {
            key: 'add-transaction',
            label: 'Ajouter une transaction',
            icon: 'add-circle-outline',
            onPress: () =>
              navigation.navigate('Tabs', {
                screen: 'Ajouter',
                params: { prefill: { kind: 'EXPENSE', sourceAccountId: account.id, sourceSubaccountId: subaccount.id } },
              }),
          },
        ]}
      />

      <RenameModal
        visible={renameOpen}
        title="Modifier le nom"
        initialValue={subaccount.name}
        onClose={() => setRenameOpen(false)}
        onSubmit={async (name) => {
          await api.renameSubaccount(subaccount.id, name);
          await load();
        }}
      />

      <ReimbursementModal
        claim={reimburseClaim}
        subaccountId={id}
        onClose={() => setReimburseClaim(null)}
        onSubmitted={load}
      />

      {closeConfirmClaim && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setCloseConfirmClaim(null)}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setCloseConfirmClaim(null)} />
          <View style={styles.confirmBox}>
            <Text style={styles.claimLabel}>{closeConfirmClaim.label}</Text>
            <Text style={styles.confirmText}>
              Clôturer ce dossier malgré un reste de {formatDh(closeConfirmClaim.reste)} à charge ? Les montants engagé et remboursé ne seront jamais modifiés.
            </Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setCloseConfirmClaim(null)} testID="health-close-cancel">
                <Text style={styles.confirmCancelText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmConfirm} onPress={() => closeClaim(closeConfirmClaim.id)} testID="health-close-confirm">
                <Text style={styles.confirmConfirmText}>Clôturer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

function ClaimCard({ claim, closed, onReimburse, onClose }: { claim: api.MedicalClaimApi; closed?: boolean; onReimburse?: () => void; onClose?: () => void }) {
  return (
    <View style={styles.claimCard}>
      <View style={styles.claimHeader}>
        <Text style={styles.claimLabel}>{claim.label}</Text>
        <View style={[styles.badge, closed ? styles.badgeClosed : styles.badgePending]}>
          <Text style={[styles.badgeText, closed ? styles.badgeTextClosed : styles.badgeTextPending]}>{closed ? 'Remboursé' : 'En attente'}</Text>
        </View>
      </View>
      <View style={styles.claimMetrics}>
        <View style={styles.claimMetric}>
          <Text style={styles.claimMetricLabel}>Engagé</Text>
          <Text style={styles.claimMetricValue}>{formatDh(claim.amountEngaged)}</Text>
        </View>
        <View style={styles.claimMetric}>
          <Text style={styles.claimMetricLabel}>Remboursé</Text>
          <Text style={styles.claimMetricValue}>{formatDh(claim.amountReimbursed)}</Text>
        </View>
        <View style={styles.claimMetric}>
          <Text style={styles.claimMetricLabel}>{closed ? 'Reste charge' : 'Reste'}</Text>
          <Text style={styles.claimMetricValue}>{formatDh(claim.reste)}</Text>
        </View>
      </View>
      {!closed && (
        <>
          <TouchableOpacity style={styles.reimburseButton} onPress={onReimburse} testID={`health-claim-reimburse-${claim.id}`}>
            <Text style={styles.reimburseButtonText}>J'ai reçu un remboursement</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeClaimButton} onPress={onClose} testID={`health-claim-close-${claim.id}`}>
            <Text style={styles.closeClaimButtonText}>Clôturer le dossier</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

function ReimbursementModal({
  claim,
  subaccountId,
  onClose,
  onSubmitted,
}: {
  claim: api.MedicalClaimApi | null;
  subaccountId: string;
  onClose: () => void;
  onSubmitted: () => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [destinationAccountId, setDestinationAccountId] = useState<string | null>(null);
  const [destinationChoice, setDestinationChoice] = useState<'DISPONIBLE' | 'SANTE' | 'AUTRE'>('DISPONIBLE');
  const [otherSubaccountId, setOtherSubaccountId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<api.AccountApi[]>([]);
  const [saving, setSaving] = useState(false);
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();

  useFocusEffect(
    useCallback(() => {
      api.listAccounts().then(setAccounts);
    }, []),
  );

  if (!claim) return null;

  const destinationAccount = accounts.find((a) => a.id === destinationAccountId);
  const otherSubaccountOptions = (destinationAccount?.subaccounts ?? []).filter((s) => s.id !== subaccountId).map((s) => ({ value: s.id, label: s.name }));

  async function submit() {
    if (!amount.trim() || !date.trim() || !destinationAccountId || saving) return;
    if (destinationChoice === 'AUTRE' && !otherSubaccountId) return;
    setSaving(true);
    try {
      const allocationSubaccountId = destinationChoice === 'SANTE' ? subaccountId : destinationChoice === 'AUTRE' ? otherSubaccountId! : undefined;
      await api.addMedicalReimbursement(claim!.id, { amount, date, destinationAccountId: destinationAccountId!, allocationSubaccountId });
      await onSubmitted();
      setAmount('');
      setDate('');
      setDestinationAccountId(null);
      setDestinationChoice('DISPONIBLE');
      setOtherSubaccountId(null);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = !!amount.trim() && !!date.trim() && !!destinationAccountId && (destinationChoice !== 'AUTRE' || !!otherSubaccountId) && !saving;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <ScrollView ref={scrollRef} style={[styles.reimburseSheet]} contentContainerStyle={{ paddingBottom: bottomInset }}>
        <Text style={styles.title}>Remboursement reçu</Text>
        <FormField label="Montant reçu" value={amount} onChangeText={setAmount} onFocus={handleFocus} keyboardType="decimal-pad" testID="reimburse-amount" />
        <DateField label="Date" value={date} onChange={setDate} />
        <Select
          label="Compte bénéficiaire"
          placeholder="Choisir un compte"
          value={destinationAccountId}
          options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          onChange={(v) => {
            setDestinationAccountId(v);
            setOtherSubaccountId(null);
          }}
          testID="reimburse-account"
        />
        <Select
          label="Que faire de cet argent ?"
          value={destinationChoice}
          options={[
            { value: 'DISPONIBLE', label: 'Laisser disponible sur le compte' },
            { value: 'SANTE', label: "Affecter à l'enveloppe Santé" },
            { value: 'AUTRE', label: 'Affecter à un autre sous-compte' },
          ]}
          onChange={(v) => setDestinationChoice(v as typeof destinationChoice)}
          testID="reimburse-destination-choice"
        />
        {destinationChoice === 'AUTRE' && (
          <Select
            label="Sous-compte"
            placeholder="Choisir un sous-compte"
            value={otherSubaccountId}
            options={otherSubaccountOptions}
            onChange={setOtherSubaccountId}
            testID="reimburse-other-subaccount"
          />
        )}
        <TouchableOpacity style={[styles.reimburseButton, !canSubmit && styles.buttonDisabled]} disabled={!canSubmit} onPress={submit} testID="reimburse-submit">
          <Text style={styles.reimburseButtonText}>{saving ? 'Enregistrement…' : 'Confirmer'}</Text>
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
  subtitle: { ...typography.bodySecondary, paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  tabs: { flexDirection: 'row', marginHorizontal: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4 },
  tab: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: 'center' },
  tabActive: { backgroundColor: colors.surface },
  tabText: { ...typography.body, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: colors.textPrimary },
  emptyText: { ...typography.bodySecondary, paddingHorizontal: spacing.lg },
  sectionLabel: { ...typography.sectionLabel, color: colors.textSecondary, paddingHorizontal: spacing.lg, marginBottom: spacing.sm, letterSpacing: 0.5 },
  opRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  opLabel: { ...typography.body, fontWeight: '600' },
  opMeta: { ...typography.caption, marginTop: 2 },
  opAmount: { ...typography.body, fontWeight: '700' },
  opAmountMinus: { color: colors.danger },
  claimCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginHorizontal: spacing.lg, marginBottom: spacing.md },
  claimHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  claimLabel: { ...typography.sectionTitle },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  badgePending: { backgroundColor: colors.warningLight },
  badgeClosed: { backgroundColor: colors.successLight },
  badgeText: { ...typography.badge },
  badgeTextPending: { color: colors.warning },
  badgeTextClosed: { color: colors.success },
  claimMetrics: { flexDirection: 'row', justifyContent: 'space-between' },
  claimMetric: { alignItems: 'flex-start' },
  claimMetricLabel: { ...typography.caption },
  claimMetricValue: { ...typography.body, fontWeight: '700', marginTop: 2 },
  reimburseButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md },
  buttonDisabled: { opacity: 0.5 },
  reimburseButtonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  closeClaimButton: { borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  closeClaimButtonText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  confirmBox: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    top: '35%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
  },
  confirmText: { ...typography.body, marginVertical: spacing.md },
  confirmActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  confirmCancel: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceSecondary },
  confirmCancelText: { ...typography.body, fontWeight: '700', color: colors.textSecondary },
  confirmConfirm: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary },
  confirmConfirmText: { ...typography.body, fontWeight: '700', color: colors.textOnPrimary },
  historyButton: { marginHorizontal: spacing.lg, alignItems: 'center', paddingVertical: spacing.md },
  historyButtonText: { ...typography.body, color: colors.primary, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  reimburseSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl + 6,
    borderTopRightRadius: radius.xl + 6,
    padding: spacing.xl,
    maxHeight: '85%',
  },
  allocateToggle: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1, borderColor: colors.border, marginRight: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.success, borderColor: colors.success },
  checkmark: { color: colors.textOnPrimary, fontSize: 12, fontWeight: '700' },
  allocateLabel: { ...typography.bodySecondary, flex: 1 },
});
