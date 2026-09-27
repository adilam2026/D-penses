import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../api/client';
import { colors, radius, spacing, typography } from '../ui/theme';
import { HelpButton } from '../ui/HelpButton';
import { FormField } from '../ui/FormField';
import { Select, SelectOption } from '../ui/Select';
import { DateField } from '../ui/DateField';
import { useBottomInset } from '../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../ui/useKeyboardAwareScroll';

type QuickMode = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'SAVINGS_CONTRIBUTION';
type EntryTab = 'realisee' | 'a_venir';
type RecurrenceOption = 'WEEKLY' | 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'YEARLY';

const QUICK_TILES: { mode: QuickMode; label: string; icon: string }[] = [
  { mode: 'EXPENSE', label: 'Dépense', icon: '↓' },
  { mode: 'INCOME', label: 'Revenu', icon: '↑' },
  { mode: 'TRANSFER', label: 'Transfert', icon: '⇄' },
  { mode: 'SAVINGS_CONTRIBUTION', label: 'Versement', icon: '＋' },
];

const RECURRENCE_LABELS: Record<RecurrenceOption, string> = {
  WEEKLY: 'Hebdomadaire',
  MONTHLY: 'Mensuelle',
  BIMONTHLY: 'Tous les 2 mois',
  QUARTERLY: 'Trimestrielle',
  SEMIANNUAL: 'Semestrielle',
  YEARLY: 'Annuelle',
};

function accountOptions(accounts: api.AccountApi[], includeSubaccounts: boolean): SelectOption[] {
  const options: SelectOption[] = [];
  for (const a of accounts) {
    options.push({ value: `acc:${a.id}`, label: a.name });
    if (includeSubaccounts) {
      for (const s of a.subaccounts) options.push({ value: `sub:${s.id}`, label: `${a.name} — ${s.name}` });
    }
  }
  return options;
}

function decodeAccountOption(value: string, accounts: api.AccountApi[]): { accountId: string; subaccountId?: string } {
  if (value.startsWith('sub:')) {
    const subId = value.slice(4);
    const parent = accounts.find((a) => a.subaccounts.some((s) => s.id === subId));
    return { accountId: parent!.id, subaccountId: subId };
  }
  return { accountId: value.slice(4) };
}

/** Ajouter (Checkpoint 2 §11/§12) — 4 tuiles rapides, Réalisée/À venir, catégorie, Ponctuelle/Récurrente, mutuelle si Santé. */
export function AjouterScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const prefill = route.params?.prefill as
    | { kind?: QuickMode; sourceAccountId?: string; sourceSubaccountId?: string; destinationAccountId?: string; destinationSubaccountId?: string }
    | undefined;

  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [accounts, setAccounts] = useState<api.AccountApi[]>([]);
  const [categories, setCategories] = useState<api.CategoryApi[]>([]);
  const [mode, setMode] = useState<QuickMode>(prefill?.kind ?? 'EXPENSE');
  const [tab, setTab] = useState<EntryTab>('realisee');

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [label, setLabel] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(
    prefill?.sourceSubaccountId ? `sub:${prefill.sourceSubaccountId}` : prefill?.sourceAccountId ? `acc:${prefill.sourceAccountId}` : null,
  );
  const [destination, setDestination] = useState<string | null>(
    prefill?.destinationSubaccountId ? `sub:${prefill.destinationSubaccountId}` : prefill?.destinationAccountId ? `acc:${prefill.destinationAccountId}` : null,
  );
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurrenceOption>('MONTHLY');
  const [medicalClaim, setMedicalClaim] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [createAccountOpen, setCreateAccountOpen] = useState(false);
  const [createSubaccountOpen, setCreateSubaccountOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      Promise.all([api.listAccounts(), api.listCategories()]).then(([a, c]) => {
        setAccounts(a);
        setCategories(c);
      });
    }, []),
  );

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const isSante = selectedCategory?.name.toLowerCase() === 'santé';

  const canBePlanned = mode !== 'TRANSFER';
  useEffect(() => {
    if (!canBePlanned && tab === 'a_venir') setTab('realisee');
  }, [canBePlanned, tab]);

  function selectMode(next: QuickMode) {
    setMode(next);
    setSource(null);
    setDestination(null);
    setMedicalClaim(false);
  }

  const canSubmit = amount.trim() !== '' && date.trim() !== '' && label.trim() !== '' && (mode === 'TRANSFER' ? !!source && !!destination : mode === 'EXPENSE' ? !!source : mode === 'INCOME' ? !!destination : !!source && !!destination);

  async function submit() {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    try {
      const src = source ? decodeAccountOption(source, accounts) : undefined;
      const dst = destination ? decodeAccountOption(destination, accounts) : undefined;

      if (tab === 'realisee') {
        await api.createFinancialOperation({
          kind: mode,
          label: label.trim(),
          date,
          amount,
          categoryId: categoryId ?? undefined,
          sourceAccountId: src?.accountId,
          sourceSubaccountId: src?.subaccountId,
          destinationAccountId: dst?.accountId,
          destinationSubaccountId: dst?.subaccountId,
          createMedicalClaim: isSante && medicalClaim,
        });
      } else if (recurring) {
        // La règle génère IMMÉDIATEMENT ses occurrences sur la fenêtre glissante
        // (dont celle-ci, à anchorDate) — jamais de planned_operation manuelle en
        // plus, qui entrerait en conflit avec l'occurrence auto-générée (§18).
        await api.createRecurrenceRule({
          frequency,
          anchorDate: date,
          label: label.trim(),
          kind: mode as 'EXPENSE' | 'INCOME' | 'SAVINGS_CONTRIBUTION',
          expectedAmount: amount,
          categoryId: categoryId ?? undefined,
          sourceAccountId: src?.accountId,
          sourceSubaccountId: src?.subaccountId,
          destinationAccountId: dst?.accountId,
          destinationSubaccountId: dst?.subaccountId,
        });
      } else {
        await api.createPlannedOperation({
          kind: mode as 'EXPENSE' | 'INCOME' | 'SAVINGS_CONTRIBUTION',
          label: label.trim(),
          expectedDate: date,
          expectedAmount: amount,
          categoryId: categoryId ?? undefined,
          sourceAccountId: src?.accountId,
          sourceSubaccountId: src?.subaccountId,
          destinationAccountId: dst?.accountId,
          destinationSubaccountId: dst?.subaccountId,
        });
      }
      setAmount('');
      setLabel('');
      navigation.navigate('Accueil');
    } catch (e) {
      setError(e instanceof api.ApiError ? e.message : "Erreur lors de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  const includeSubaccounts = mode !== 'TRANSFER';
  const options = accountOptions(accounts, includeSubaccounts);

  return (
    <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Ajouter</Text>
          <Text style={styles.subtitle}>Enregistrez une opération réelle ou prévue.</Text>
        </View>
        <HelpButton
          title="Ajouter"
          text="Choisissez le type d'opération, puis Réalisée si elle a déjà eu lieu ou À venir si vous la planifiez pour plus tard."
        />
      </View>

      <View style={styles.tiles}>
        {QUICK_TILES.map((tile) => (
          <View key={tile.mode} style={styles.tile}>
            <TouchableOpacity
              style={[styles.tileCard, mode === tile.mode && styles.tileCardActive]}
              onPress={() => selectMode(tile.mode)}
              testID={`ajouter-tile-${tile.mode}`}
            >
              <Text style={[styles.tileIcon, mode === tile.mode && styles.tileTextActive]}>{tile.icon}</Text>
              <Text style={[styles.tileLabel, mode === tile.mode && styles.tileTextActive]}>{tile.label}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <View style={styles.tabs}>
          <TouchableOpacity style={[styles.tab, tab === 'realisee' && styles.tabActive]} onPress={() => setTab('realisee')} testID="ajouter-tab-realisee">
            <Text style={[styles.tabText, tab === 'realisee' && styles.tabTextActive]}>Réalisée</Text>
          </TouchableOpacity>
          {canBePlanned && (
            <TouchableOpacity style={[styles.tab, tab === 'a_venir' && styles.tabActive]} onPress={() => setTab('a_venir')} testID="ajouter-tab-a-venir">
              <Text style={[styles.tabText, tab === 'a_venir' && styles.tabTextActive]}>À venir</Text>
            </TouchableOpacity>
          )}
        </View>

        <FormField label="Montant" value={amount} onChangeText={setAmount} onFocus={handleFocus} keyboardType="decimal-pad" testID="ajouter-amount" />
        <DateField label="Date" value={date} onChange={setDate} />
        <FormField label="Libellé" value={label} onChangeText={setLabel} onFocus={handleFocus} testID="ajouter-label" />

        {mode === 'EXPENSE' && (
          <Select label="Compte" value={source} options={options} onChange={setSource} testID="ajouter-source" />
        )}
        {mode === 'INCOME' && (
          <Select label="Compte" value={destination} options={options} onChange={setDestination} testID="ajouter-destination" />
        )}
        {(mode === 'TRANSFER' || mode === 'SAVINGS_CONTRIBUTION') && (
          <>
            <Select label="Depuis" value={source} options={options} onChange={setSource} testID="ajouter-source" />
            <Select label="Vers" value={destination} options={options} onChange={setDestination} testID="ajouter-destination" />
          </>
        )}

        <Select label="Catégorie" value={categoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} onChange={setCategoryId} testID="ajouter-category" />
        <TouchableOpacity onPress={() => setNewCategoryOpen(true)} testID="ajouter-new-category">
          <Text style={styles.linkText}>+ Nouvelle catégorie</Text>
        </TouchableOpacity>

        {tab === 'a_venir' && (
          <View style={{ marginTop: spacing.md }}>
            <View style={styles.typeRow}>
              <TouchableOpacity style={[styles.typeChip, !recurring && styles.typeChipActive]} onPress={() => setRecurring(false)} testID="ajouter-type-ponctuelle">
                <Text style={[styles.typeChipText, !recurring && styles.typeChipTextActive]}>Ponctuelle</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.typeChip, recurring && styles.typeChipActive]} onPress={() => setRecurring(true)} testID="ajouter-type-recurrente">
                <Text style={[styles.typeChipText, recurring && styles.typeChipTextActive]}>Récurrente</Text>
              </TouchableOpacity>
            </View>
            {recurring && (
              <Select
                label="Périodicité"
                value={frequency}
                options={(Object.keys(RECURRENCE_LABELS) as RecurrenceOption[]).map((k) => ({ value: k, label: RECURRENCE_LABELS[k] }))}
                onChange={(v) => setFrequency(v as RecurrenceOption)}
                testID="ajouter-frequency"
              />
            )}
          </View>
        )}

        {isSante && mode === 'EXPENSE' && tab === 'realisee' && (
          <TouchableOpacity style={styles.switchRow} onPress={() => setMedicalClaim((v) => !v)} testID="ajouter-medical-claim-toggle">
            <View style={[styles.checkbox, medicalClaim && styles.checkboxChecked]}>{medicalClaim ? <Text style={styles.checkmark}>✓</Text> : null}</View>
            <Text style={styles.switchLabel}>Remboursable par mutuelle ?</Text>
          </TouchableOpacity>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity style={[styles.submitButton, (!canSubmit || saving) && styles.buttonDisabled]} disabled={!canSubmit || saving} onPress={submit} testID="ajouter-submit">
          <Text style={styles.submitButtonText}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={() => setCreateAccountOpen(true)} testID="ajouter-create-account">
        <Text style={styles.linkText}>+ Créer un compte</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setCreateSubaccountOpen(true)} testID="ajouter-create-subaccount">
        <Text style={styles.linkText}>+ Créer un sous-compte</Text>
      </TouchableOpacity>

      {newCategoryOpen && (
        <NewCategoryModal
          onClose={() => setNewCategoryOpen(false)}
          onCreated={(cat) => {
            setCategories((prev) => [...prev, cat]);
            setCategoryId(cat.id);
          }}
        />
      )}
      {createAccountOpen && (
        <NewAccountModal onClose={() => setCreateAccountOpen(false)} onCreated={(acc) => setAccounts((prev) => [...prev, acc])} />
      )}
      {createSubaccountOpen && (
        <NewSubaccountModal
          accounts={accounts}
          onClose={() => setCreateSubaccountOpen(false)}
          onCreated={(updatedAccounts) => setAccounts(updatedAccounts)}
        />
      )}
    </ScrollView>
  );
}

/** Montée conditionnellement par le parent (jamais toujours montée avec visible=false) — cf. AjouterScreen. */
function NewCategoryModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: api.CategoryApi) => void }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const bottomInset = useBottomInset(spacing.lg);

  async function submit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const cat = await api.createCategory(name.trim());
      onCreated(cat);
      setName('');
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: bottomInset }]}>
        <Text style={styles.sheetTitle}>Nouvelle catégorie</Text>
        <FormField label="Nom" value={name} onChangeText={setName} testID="new-category-name" />
        <TouchableOpacity style={[styles.submitButton, !name.trim() && styles.buttonDisabled]} disabled={!name.trim() || saving} onPress={submit} testID="new-category-submit">
          <Text style={styles.submitButtonText}>{saving ? 'Enregistrement…' : 'Créer'}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function NewAccountModal({ onClose, onCreated }: { onClose: () => void; onCreated: (a: api.AccountApi) => void }) {
  const [name, setName] = useState('');
  const [bank, setBank] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [saving, setSaving] = useState(false);
  const bottomInset = useBottomInset(spacing.lg);

  async function submit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const acc = await api.createAccount({ name: name.trim(), bank: bank.trim() || undefined, openingBalance: openingBalance.trim() || undefined });
      onCreated(acc);
      setName('');
      setBank('');
      setOpeningBalance('');
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: bottomInset }]}>
        <Text style={styles.sheetTitle}>Créer un compte</Text>
        <FormField label="Nom" value={name} onChangeText={setName} testID="new-account-name" />
        <FormField label="Banque (optionnel)" value={bank} onChangeText={setBank} />
        <FormField label="Solde d'ouverture (optionnel)" value={openingBalance} onChangeText={setOpeningBalance} keyboardType="decimal-pad" />
        <TouchableOpacity style={[styles.submitButton, !name.trim() && styles.buttonDisabled]} disabled={!name.trim() || saving} onPress={submit} testID="new-account-submit">
          <Text style={styles.submitButtonText}>{saving ? 'Enregistrement…' : 'Créer'}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function NewSubaccountModal({
  accounts,
  onClose,
  onCreated,
}: {
  accounts: api.AccountApi[];
  onClose: () => void;
  onCreated: (accounts: api.AccountApi[]) => void;
}) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [initialAllocation, setInitialAllocation] = useState('');
  const [saving, setSaving] = useState(false);
  const bottomInset = useBottomInset(spacing.lg);

  async function submit() {
    if (!accountId || !name.trim() || saving) return;
    setSaving(true);
    try {
      await api.createSubaccount({ accountId, name: name.trim(), initialAllocation: initialAllocation.trim() || undefined });
      onCreated(await api.listAccounts());
      setName('');
      setInitialAllocation('');
      setAccountId(null);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: bottomInset }]}>
        <Text style={styles.sheetTitle}>Créer un sous-compte</Text>
        <Select label="Compte parent" value={accountId} options={accounts.map((a) => ({ value: a.id, label: a.name }))} onChange={setAccountId} testID="new-subaccount-account" />
        <FormField label="Nom" value={name} onChangeText={setName} testID="new-subaccount-name" />
        <FormField label="Allocation initiale (optionnel)" value={initialAllocation} onChangeText={setInitialAllocation} keyboardType="decimal-pad" />
        <TouchableOpacity
          style={[styles.submitButton, (!accountId || !name.trim()) && styles.buttonDisabled]}
          disabled={!accountId || !name.trim() || saving}
          onPress={submit}
          testID="new-subaccount-submit"
        >
          <Text style={styles.submitButtonText}>{saving ? 'Enregistrement…' : 'Créer'}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.lg },
  title: { ...typography.screenTitle },
  subtitle: { ...typography.bodySecondary, marginTop: spacing.xs, maxWidth: 260 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs, marginBottom: spacing.lg },
  tile: {
    width: '50%',
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  tileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  tileCardActive: { borderColor: colors.primary, backgroundColor: colors.surfaceActive },
  tileIcon: { fontSize: 20, fontWeight: '700', color: colors.textSecondary },
  tileLabel: { ...typography.body, fontWeight: '600', color: colors.textSecondary, marginTop: 2 },
  tileTextActive: { color: colors.primary },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  tabs: { flexDirection: 'row', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, marginBottom: spacing.md },
  tab: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: 'center' },
  tabActive: { backgroundColor: colors.surface },
  tabText: { ...typography.body, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: colors.textPrimary },
  typeRow: { flexDirection: 'row', marginBottom: spacing.sm, gap: spacing.sm },
  typeChip: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceSecondary },
  typeChipActive: { backgroundColor: colors.primary },
  typeChipText: { ...typography.body, fontWeight: '600', color: colors.textSecondary },
  typeChipTextActive: { color: colors.textOnPrimary },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1, borderColor: colors.border, marginRight: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: colors.success, borderColor: colors.success },
  checkmark: { color: colors.textOnPrimary, fontSize: 12, fontWeight: '700' },
  switchLabel: { ...typography.body },
  errorText: { ...typography.body, color: colors.danger, marginTop: spacing.sm },
  submitButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.lg },
  buttonDisabled: { opacity: 0.5 },
  submitButtonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  linkText: { ...typography.body, color: colors.primary, fontWeight: '600', marginBottom: spacing.md },
  backdrop: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, padding: spacing.xl },
  sheetTitle: { ...typography.sectionTitle, marginBottom: spacing.lg },
});
