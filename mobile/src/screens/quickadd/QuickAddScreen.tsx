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
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { Select } from '../../ui/Select';

type Mode = 'depense' | 'revenu' | 'paiement' | 'transfert';

interface Account {
  id: string;
  name: string;
  soldeCourant: number;
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
  provisionId: string | null;
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
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
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

  // §10 (recette téléphone réel) : un SEUL parcours de paiement partagé — DeadlineDetailScreen,
  // le même que Accueil/Plan financier/Calendrier. "Ajouter > Échéance" n'est plus qu'une liste
  // de sélection ; sélectionner une échéance ouvre directement l'écran de paiement dédié, jamais
  // une sélection inline silencieuse sans retour visuel (bug bloquant corrigé).
  function onSelectDeadline(d: OpenDeadline) {
    navigation.navigate('DeadlineDetail', { id: d.id });
  }

  async function onSubmit() {
    // §10 — le paiement se fait désormais exclusivement sur DeadlineDetailScreen
    // (parcours unique) : ce formulaire ne soumet jamais rien en mode 'paiement'.
    if (mode === 'paiement') return;
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
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
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
              <TextInput style={styles.input} placeholder="Libellé (ex. Salaire)" value={label} onChangeText={setLabel} onFocus={handleFocus} />
            )}

            {mode === 'paiement' ? (
              // §10 — cette liste ne fait QUE sélectionner l'échéance : le paiement
              // lui-même (montant, compte obligatoire, enveloppe facultative, partiel)
              // se fait sur DeadlineDetailScreen, le même écran que partout ailleurs.
              <>
                <Text style={styles.sectionLabel}>Échéance à payer</Text>
                {openDeadlines.length === 0 ? (
                  <Text style={styles.empty}>Aucune échéance ouverte pour l'instant.</Text>
                ) : (
                  <View style={styles.pickList}>
                    {openDeadlines.map((d) => (
                      <TouchableOpacity key={d.id} testID={`pick-deadline-${d.id}`} style={styles.pickRow} onPress={() => onSelectDeadline(d)}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pickRowLabel}>{d.chargePlan.label}</Text>
                          <Text style={styles.pickRowMeta}>
                            {d.resteAPayer !== null ? `${d.resteAPayer.toLocaleString('fr-FR')} DH restants` : 'Montant inconnu'}
                          </Text>
                        </View>
                        <Text style={styles.pickRowChevron}>›</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <TextInput style={styles.input} placeholder="Montant (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} onFocus={handleFocus} />
            )}

            {mode === 'depense' && (
              <>
                {/* §8 (recette téléphone réel) : sélecteur compact D-Penses+ (Select
                    partagé) au lieu d'une grande liste de chips permanente — plus de
                    2-4 choix courts, jamais un mur de chips sur mobile. */}
                <Select
                  testID="quickadd-category-select"
                  label="Catégorie"
                  placeholder="Choisir une catégorie (facultatif)"
                  value={categoryId}
                  onChange={(v) => setCategoryId(categoryId === v ? null : v)}
                  options={expenseCategories.map((c) => ({ value: c.id, label: c.name }))}
                />
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
                      onFocus={handleFocus}
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
                              onFocus={handleFocus}
                            />
                            <TouchableOpacity testID="add-subtype-submit" style={styles.inlineAddButton} onPress={onCreateSubtype} disabled={creatingSubtype}>
                              {creatingSubtype ? <ActivityIndicator color="#fff" /> : <Text style={styles.inlineAddButtonText}>Ajouter</Text>}
                            </TouchableOpacity>
                          </View>
                        )}
                      </>
                    );
                  })()}

                <TextInput style={styles.input} placeholder="Note (facultatif)" value={notes} onChangeText={setNotes} onFocus={handleFocus} />
              </>
            )}

            {mode !== 'paiement' && (
              // R5 clôture §6 — sélecteur compact (comptes potentiellement nombreux),
              // jamais un mur de chips permanent.
              <Select
                testID="quickadd-account-select"
                label={mode === 'transfert' ? 'Compte source' : 'Compte'}
                placeholder="Choisir un compte"
                value={accountId}
                onChange={setAccountId}
                options={accounts.map((a) => ({
                  value: a.id,
                  label: a.name,
                  sublabel: mode === 'transfert' ? `${a.soldeCourant.toLocaleString('fr-FR')} DH` : undefined,
                }))}
              />
            )}

            {mode === 'transfert' && (
              <>
                <Select
                  testID="quickadd-dest-account-select"
                  label="Compte destination"
                  placeholder="Choisir le compte destination"
                  value={toAccountId}
                  onChange={setToAccountId}
                  options={accounts
                    .filter((a) => a.id !== accountId)
                    .map((a) => ({ value: a.id, label: a.name, sublabel: `${a.soldeCourant.toLocaleString('fr-FR')} DH` }))}
                />

                {(() => {
                  const numericAmount = Number(amount.replace(',', '.'));
                  const from = accounts.find((a) => a.id === accountId);
                  const to = accounts.find((a) => a.id === toAccountId);
                  if (!from || !to || !numericAmount || numericAmount <= 0) return null;
                  // §11 — recalculé en direct à chaque changement de montant/source/destination,
                  // toujours affiché AVANT confirmation, jamais après coup.
                  return (
                    <View style={styles.transferPreview} testID="transfer-preview">
                      <Text style={styles.transferPreviewTitle}>APRÈS TRANSFERT</Text>
                      <View style={styles.transferPreviewRow}>
                        <Text style={styles.transferPreviewName}>{from.name}</Text>
                        <Text style={styles.transferPreviewValue}>
                          {from.soldeCourant.toLocaleString('fr-FR')} → {(from.soldeCourant - numericAmount).toLocaleString('fr-FR')} DH
                        </Text>
                      </View>
                      <View style={styles.transferPreviewRow}>
                        <Text style={styles.transferPreviewName}>{to.name}</Text>
                        <Text style={styles.transferPreviewValue}>
                          {to.soldeCourant.toLocaleString('fr-FR')} → {(to.soldeCourant + numericAmount).toLocaleString('fr-FR')} DH
                        </Text>
                      </View>
                    </View>
                  );
                })()}
              </>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {mode !== 'paiement' && (
              <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={submitting}>
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>{mode === 'transfert' ? 'Confirmer le transfert' : 'Enregistrer'}</Text>
                )}
              </TouchableOpacity>
            )}
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
  transferPreview: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#E3E1DC' },
  transferPreviewTitle: { fontSize: 10, fontWeight: '700', color: '#6B747C', letterSpacing: 0.5, marginBottom: 8 },
  transferPreviewRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  transferPreviewName: { fontSize: 13, color: '#172436', fontWeight: '600' },
  transferPreviewValue: { fontSize: 13, color: '#172436', fontWeight: '700' },
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
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  pickRowLabel: { fontSize: 14, fontWeight: '600', color: '#172436' },
  pickRowMeta: { fontSize: 12, color: '#6B747C', marginTop: 2 },
  pickRowChevron: { fontSize: 20, color: '#9AA0A6', marginLeft: 8 },
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
