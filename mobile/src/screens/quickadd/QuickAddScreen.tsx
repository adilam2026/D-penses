import React, { useCallback, useEffect, useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { accountCreatedBus } from '../../state/events';

type Mode = 'depense' | 'revenu' | 'paiement' | 'transfert';

interface Account {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
}

interface CategorySubtype {
  id: string;
  name: string;
  active: boolean;
}

interface CategoryType {
  id: string;
  name: string;
  active: boolean;
  subtypes: CategorySubtype[];
}

interface OpenDeadline {
  id: string;
  dueDate: string;
  resteAPayer: number | null;
  chargePlan: { label: string };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const MODE_LABEL: Record<Mode, string> = {
  depense: '+ Dépense',
  revenu: '+ Revenu',
  paiement: '+ Échéance',
  transfert: '+ Transfert',
};

/**
 * Saisie rapide « + » (Lot 3 §2/§16). Quatre actions bien distinctes :
 * - Dépense : dépense réelle ponctuelle (courses, essence...) — jamais de
 *   ChargePlan/Deadline créés, seulement une BudgetExpense ou AdHocExpense.
 * - Paiement d'une échéance : Payment rattaché à une Deadline EXISTANTE,
 *   jamais une Deadline créée artificiellement pour l'occasion (correction §2).
 */
export function QuickAddScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const bottomInset = useBottomInset();
  // Vague 3 §3 — la bottom sheet "+" peut présélectionner l'action (Dépense/Revenu/
  // Payer une échéance/Transfert) ; sans paramètre, comportement inchangé (Dépense).
  const initialMode = (route.params?.mode as Mode | undefined) ?? 'depense';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [budgetHint, setBudgetHint] = useState<string | null>(null);

  // Vague 2 §1/§4 — Type filtré par Catégorie, Sous-type filtré par Type, tous deux facultatifs.
  const [categoryTypes, setCategoryTypes] = useState<CategoryType[]>([]);
  const [categoryTypeId, setCategoryTypeId] = useState<string | null>(null);
  const [categorySubtypeId, setCategorySubtypeId] = useState<string | null>(null);
  const [addingType, setAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [creatingType, setCreatingType] = useState(false);
  const [addingSubtype, setAddingSubtype] = useState(false);
  const [newSubtypeName, setNewSubtypeName] = useState('');
  const [creatingSubtype, setCreatingSubtype] = useState(false);

  const [openDeadlines, setOpenDeadlines] = useState<OpenDeadline[]>([]);
  const [deadlineId, setDeadlineId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accountList, quickDefault, categoryList, deadlines] = await Promise.all([
        api.listAccounts(),
        api.getQuickAddDefaultAccount(),
        api.listCategories(),
        api.listOpenDeadlines(),
      ]);
      setAccounts(accountList);
      setAccountId(quickDefault.accountId ?? (accountList[0]?.id ?? null));
      setCategories(categoryList);
      setOpenDeadlines(deadlines);
      return accountList;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().then((accountList) => {
      if (accountList && accountList.length === 0) promptCreateAccount();
    });
  }, [load]);

  useEffect(() => {
    return accountCreatedBus.on((created) => {
      load().then(() => setAccountId(created.id));
    });
  }, [load]);

  function promptCreateAccount() {
    Alert.alert(
      'Aucun compte configuré',
      "Créez d'abord un compte pour pouvoir enregistrer une dépense, un revenu ou un transfert.",
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Créer un compte', onPress: () => navigation.navigate('QuickCreateAccount') },
      ],
    );
  }

  useEffect(() => {
    setBudgetHint(null);
    if (mode !== 'depense' || !categoryId) return;
    let cancelled = false;
    api
      .findActiveBudgetsForCategory(categoryId)
      .then((budgets: Array<{ status: { budgetContractuelRestant: number } }>) => {
        if (cancelled || budgets.length !== 1) return;
        const category = categories.find((c) => c.id === categoryId);
        setBudgetHint(`Budget ${category?.name ?? ''} : ${budgets[0].status.budgetContractuelRestant.toLocaleString('fr-FR')} DH restants cette période`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mode, categoryId, categories]);

  useEffect(() => {
    setCategoryTypes([]);
    setCategoryTypeId(null);
    setCategorySubtypeId(null);
    setAddingType(false);
    setAddingSubtype(false);
    if (mode !== 'depense' || !categoryId) return;
    let cancelled = false;
    api.listCategoryTypes(categoryId).then((types: CategoryType[]) => {
      if (!cancelled) setCategoryTypes(types);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, categoryId]);

  function onSelectCategoryType(typeId: string) {
    setCategoryTypeId((current) => (current === typeId ? null : typeId));
    setCategorySubtypeId(null);
  }

  async function onCreateType() {
    if (!categoryId || !newTypeName.trim() || creatingType) return;
    setCreatingType(true);
    try {
      const created = await api.createCategoryType(categoryId, { name: newTypeName.trim() });
      const types: CategoryType[] = await api.listCategoryTypes(categoryId);
      setCategoryTypes(types);
      setCategoryTypeId(created.id);
      setCategorySubtypeId(null);
      setNewTypeName('');
      setAddingType(false);
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création du type impossible');
    } finally {
      setCreatingType(false);
    }
  }

  async function onCreateSubtype() {
    if (!categoryTypeId || !newSubtypeName.trim() || creatingSubtype) return;
    setCreatingSubtype(true);
    try {
      const created = await api.createCategorySubtype(categoryTypeId, { name: newSubtypeName.trim() });
      const types: CategoryType[] = await api.listCategoryTypes(categoryId!);
      setCategoryTypes(types);
      setCategorySubtypeId(created.id);
      setNewSubtypeName('');
      setAddingSubtype(false);
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création du sous-type impossible');
    } finally {
      setCreatingSubtype(false);
    }
  }

  function onSelectDeadline(d: OpenDeadline) {
    setDeadlineId(d.id);
    if (d.resteAPayer !== null) setAmount(String(d.resteAPayer));
  }

  async function onSubmit() {
    setError(null);
    const numericAmount = Number(amount.replace(',', '.'));
    if (!numericAmount || numericAmount <= 0) {
      setError('Montant invalide');
      return;
    }
    if (mode !== 'transfert' && !accountId) {
      promptCreateAccount();
      return;
    }

    setSubmitting(true);
    try {
      const today = todayIso();
      if (mode === 'depense') {
        await api.createExpense({
          amount: numericAmount,
          accountId: accountId!,
          categoryId: categoryId ?? undefined,
          categoryTypeId: categoryTypeId ?? undefined,
          categorySubtypeId: categorySubtypeId ?? undefined,
          notes: notes || undefined,
        });
      } else if (mode === 'revenu') {
        if (!label.trim()) {
          setError('Un libellé est requis');
          setSubmitting(false);
          return;
        }
        const source = await api.createIncomeSource({
          label: label.trim(),
          usualAmount: numericAmount,
          defaultAccountId: accountId!,
          isRecurring: false,
          recurrenceRule: 'ponctuel',
        });
        const occurrence = await api.createIncomeOccurrence(source.id, { usualDate: today, plannedAmount: numericAmount });
        await api.confirmIncomeOccurrence(occurrence.id, { actualAmount: numericAmount, actualDate: today, accountId: accountId! });
      } else if (mode === 'paiement') {
        if (!deadlineId) {
          setError('Choisissez une échéance à payer');
          setSubmitting(false);
          return;
        }
        await api.createPayment(deadlineId, { amount: numericAmount, accountId: accountId!, paidDate: today });
      } else {
        if (!toAccountId || toAccountId === accountId) {
          setError('Choisissez un compte de destination différent');
          setSubmitting(false);
          return;
        }
        await api.createTransfer({ fromAccountId: accountId!, toAccountId, amount: numericAmount, plannedDate: today });
      }
      navigation.goBack();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Enregistrement impossible');
    } finally {
      setSubmitting(false);
    }
  }

  const expenseCategories = categories.filter((c) => c.kind === 'expense' || c.kind === 'both');

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Ajouter</Text>

        <View style={styles.modeRow}>
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <TouchableOpacity key={m} style={[styles.modeChip, mode === m && styles.modeChipActive]} onPress={() => setMode(m)}>
              <Text style={[styles.modeChipText, mode === m && styles.modeChipTextActive]}>{MODE_LABEL[m]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : (
          <>
            {mode === 'revenu' && (
              <TextInput style={styles.input} placeholder="Libellé (ex. Salaire)" value={label} onChangeText={setLabel} />
            )}

            {mode === 'paiement' && (
              <>
                <Text style={styles.sectionLabel}>Échéance à payer</Text>
                {openDeadlines.length === 0 ? (
                  <Text style={styles.empty}>Aucune échéance ouverte pour l'instant.</Text>
                ) : (
                  <View style={styles.pickList}>
                    {openDeadlines.map((d) => (
                      <TouchableOpacity
                        key={d.id}
                        style={[styles.pickRow, deadlineId === d.id && styles.pickRowActive]}
                        onPress={() => onSelectDeadline(d)}
                      >
                        <Text style={styles.pickRowLabel}>{d.chargePlan.label}</Text>
                        <Text style={styles.pickRowMeta}>
                          {d.resteAPayer !== null ? `${d.resteAPayer.toLocaleString('fr-FR')} DH restants` : 'Montant inconnu'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}

            <TextInput style={styles.input} placeholder="Montant (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />

            {mode === 'depense' && (
              <>
                <Text style={styles.sectionLabel}>Catégorie</Text>
                <View style={styles.chipRow}>
                  {expenseCategories.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.chip, categoryId === c.id && styles.chipActive]}
                      onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
                    >
                      <Text style={[styles.chipText, categoryId === c.id && styles.chipTextActive]}>{c.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {budgetHint ? <Text style={styles.hint}>{budgetHint}</Text> : null}

                {categoryId && categoryTypes.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>Type</Text>
                    <View style={styles.chipRow}>
                      {categoryTypes
                        .filter((t) => t.active)
                        .map((t) => (
                          <TouchableOpacity
                            key={t.id}
                            testID={`type-chip-${t.name}`}
                            style={[styles.chip, categoryTypeId === t.id && styles.chipActive]}
                            onPress={() => onSelectCategoryType(t.id)}
                          >
                            <Text style={[styles.chipText, categoryTypeId === t.id && styles.chipTextActive]}>{t.name}</Text>
                          </TouchableOpacity>
                        ))}
                      <TouchableOpacity testID="add-type-toggle" style={styles.chipAdd} onPress={() => setAddingType((v) => !v)}>
                        <Text style={styles.chipAddText}>+ Nouveau type</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
                {categoryId && categoryTypes.length === 0 && (
                  <TouchableOpacity testID="add-type-toggle" onPress={() => setAddingType((v) => !v)}>
                    <Text style={styles.addLink}>+ Ajouter un type pour cette catégorie</Text>
                  </TouchableOpacity>
                )}
                {addingType && (
                  <View style={styles.inlineAddRow}>
                    <TextInput
                      testID="add-type-input"
                      style={[styles.input, styles.inlineAddInput]}
                      placeholder="Nom du type (ex. Jardinier)"
                      value={newTypeName}
                      onChangeText={setNewTypeName}
                    />
                    <TouchableOpacity testID="add-type-submit" style={styles.inlineAddButton} onPress={onCreateType} disabled={creatingType}>
                      {creatingType ? <ActivityIndicator color="#fff" /> : <Text style={styles.inlineAddButtonText}>Ajouter</Text>}
                    </TouchableOpacity>
                  </View>
                )}

                {categoryTypeId &&
                  (() => {
                    const selectedType = categoryTypes.find((t) => t.id === categoryTypeId);
                    const subtypes = selectedType?.subtypes.filter((s) => s.active) ?? [];
                    // §4 — si aucun sous-type n'existe, ne pas afficher un champ vide inutile
                    // (sauf l'action pour en créer un, toujours disponible).
                    return (
                      <>
                        {subtypes.length > 0 && (
                          <>
                            <Text style={styles.sectionLabel}>Sous-type (facultatif)</Text>
                            <View style={styles.chipRow}>
                              {subtypes.map((s) => (
                                <TouchableOpacity
                                  key={s.id}
                                  testID={`subtype-chip-${s.name}`}
                                  style={[styles.chip, categorySubtypeId === s.id && styles.chipActive]}
                                  onPress={() => setCategorySubtypeId(categorySubtypeId === s.id ? null : s.id)}
                                >
                                  <Text style={[styles.chipText, categorySubtypeId === s.id && styles.chipTextActive]}>{s.name}</Text>
                                </TouchableOpacity>
                              ))}
                              <TouchableOpacity testID="add-subtype-toggle" style={styles.chipAdd} onPress={() => setAddingSubtype((v) => !v)}>
                                <Text style={styles.chipAddText}>+ Nouveau sous-type</Text>
                              </TouchableOpacity>
                            </View>
                          </>
                        )}
                        {subtypes.length === 0 && (
                          <TouchableOpacity testID="add-subtype-toggle" onPress={() => setAddingSubtype((v) => !v)}>
                            <Text style={styles.addLink}>+ Ajouter un sous-type pour ce type</Text>
                          </TouchableOpacity>
                        )}
                        {addingSubtype && (
                          <View style={styles.inlineAddRow}>
                            <TextInput
                              testID="add-subtype-input"
                              style={[styles.input, styles.inlineAddInput]}
                              placeholder="Nom du sous-type (ex. Viande)"
                              value={newSubtypeName}
                              onChangeText={setNewSubtypeName}
                            />
                            <TouchableOpacity testID="add-subtype-submit" style={styles.inlineAddButton} onPress={onCreateSubtype} disabled={creatingSubtype}>
                              {creatingSubtype ? <ActivityIndicator color="#fff" /> : <Text style={styles.inlineAddButtonText}>Ajouter</Text>}
                            </TouchableOpacity>
                          </View>
                        )}
                      </>
                    );
                  })()}

                <TextInput style={styles.input} placeholder="Note (facultatif)" value={notes} onChangeText={setNotes} />
              </>
            )}

            <Text style={styles.sectionLabel}>{mode === 'transfert' ? 'Compte source' : 'Compte'}</Text>
            <View style={styles.chipRow}>
              {accounts.map((a) => (
                <TouchableOpacity key={a.id} style={[styles.chip, accountId === a.id && styles.chipActive]} onPress={() => setAccountId(a.id)}>
                  <Text style={[styles.chipText, accountId === a.id && styles.chipTextActive]}>{a.name}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {mode === 'transfert' && (
              <>
                <Text style={styles.sectionLabel}>Compte destination</Text>
                <View style={styles.chipRow}>
                  {accounts
                    .filter((a) => a.id !== accountId)
                    .map((a) => (
                      <TouchableOpacity
                        key={a.id}
                        style={[styles.chip, toAccountId === a.id && styles.chipActive]}
                        onPress={() => setToAccountId(a.id)}
                      >
                        <Text style={[styles.chipText, toAccountId === a.id && styles.chipTextActive]}>{a.name}</Text>
                      </TouchableOpacity>
                    ))}
                </View>
              </>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Enregistrer</Text>}
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.cancel}>Annuler</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  scroll: { padding: 24, paddingTop: 40 },
  title: { fontSize: 22, fontWeight: '700', color: '#172436', marginBottom: 16, textAlign: 'center' },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginBottom: 16 },
  modeChip: {
    backgroundColor: '#EDEBE6',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 4,
    marginBottom: 8,
  },
  modeChipActive: { backgroundColor: '#172436' },
  modeChipText: { fontSize: 12, color: '#6B747C', fontWeight: '600' },
  modeChipTextActive: { color: '#fff' },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#172436', marginBottom: 8, marginTop: 4 },
  empty: { color: '#6B747C', fontSize: 13, marginBottom: 12 },
  pickList: { marginBottom: 12 },
  pickRow: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#E3E1DC' },
  pickRowActive: { borderColor: '#172436', backgroundColor: '#EEF0F3' },
  pickRowLabel: { fontSize: 14, fontWeight: '600', color: '#172436' },
  pickRowMeta: { fontSize: 12, color: '#6B747C', marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
  chip: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  chipActive: { backgroundColor: '#172436', borderColor: '#172436' },
  chipText: { fontSize: 13, color: '#172436' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  chipAdd: {
    backgroundColor: '#EEF0F3',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E3E1DC',
    borderStyle: 'dashed',
  },
  chipAddText: { fontSize: 12, color: '#2E7D5B', fontWeight: '600' },
  addLink: { color: '#2E7D5B', fontSize: 13, fontWeight: '600', marginBottom: 12 },
  inlineAddRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  inlineAddInput: { flex: 1, marginRight: 8, marginBottom: 0 },
  inlineAddButton: { backgroundColor: '#172436', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center' },
  inlineAddButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  hint: { fontSize: 12, color: '#6B747C', marginBottom: 12, fontStyle: 'italic' },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  cancel: { color: '#6B747C', textAlign: 'center', marginTop: 16, fontSize: 13 },
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8 },
});
