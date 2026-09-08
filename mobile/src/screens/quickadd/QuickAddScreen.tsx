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
  TouchableOpacity,
  View,
} from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { accountCreatedBus } from '../../state/events';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { Select } from '../../ui/Select';
import { FormField } from '../../ui/FormField';
import { DateField } from '../../ui/DateField';
import { frequencyOptions } from '../../ui/frequency';
import { colors, elevation, radius, spacing } from '../../ui/theme';

type Mode = 'depense' | 'revenu' | 'paiement' | 'transfert';

// R6.2 (§10-12) : un transfert récurrent reste un objet séparé (RecurringTransfer),
// jamais une ChargePlan — 'ponctuel' n'existe pas côté récurrent (POST /accounts/transfers
// reste le seul chemin pour un transfert sans répétition).
const RECURRING_TRANSFER_RULES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel'] as const;

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

  // R6.2 (§10-12) : Ponctuel (comportement historique, POST /accounts/transfers)
  // vs Récurrent (nouvel objet séparé RecurringTransfer, POST /recurring-transfers).
  const [transferKind, setTransferKind] = useState<'ponctuel' | 'recurrent'>('ponctuel');
  const [transferLabel, setTransferLabel] = useState('');
  const [transferRecurrenceRule, setTransferRecurrenceRule] = useState<string>('mensuel');
  const [transferAnchorDate, setTransferAnchorDate] = useState('');
  const [transferNote, setTransferNote] = useState('');

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
    if (mode === 'transfert' && transferKind === 'recurrent') {
      if (!transferLabel.trim()) {
        setError('Un libellé est requis pour un transfert récurrent');
        return;
      }
      if (!transferAnchorDate) {
        setError('Le prochain transfert est requis');
        return;
      }
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
        if (transferKind === 'recurrent') {
          await api.createRecurringTransfer({
            label: transferLabel.trim(),
            fromAccountId: accountId!,
            toAccountId,
            amount: numericAmount,
            recurrenceRule: transferRecurrenceRule as (typeof RECURRING_TRANSFER_RULES)[number],
            recurrenceAnchorDate: transferAnchorDate,
            note: transferNote.trim() || undefined,
          });
        } else {
          await api.createTransfer({ fromAccountId: accountId!, toAccountId, amount: numericAmount, plannedDate: today });
        }
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
              <FormField testID="quickadd-label-input" placeholder="Libellé (ex. Salaire)" value={label} onChangeText={setLabel} onFocus={handleFocus} />
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
              <FormField
                testID="quickadd-amount-input"
                placeholder="Montant (DH)"
                keyboardType="decimal-pad"
                value={amount}
                onChangeText={setAmount}
                onFocus={handleFocus}
              />
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

                {categoryId &&
                  categoryTypes.length > 0 &&
                  (() => {
                    const activeTypes = categoryTypes.filter((t) => t.active);
                    // R6 finition UX/UI §2 — au-delà de 4 choix, sélecteur compact plutôt
                    // qu'un mur de chips (règle : 2-4 choix courts = chips, sinon Select).
                    return activeTypes.length > 4 ? (
                      <>
                        <Select
                          testID="quickadd-type-select"
                          label="Type"
                          placeholder="Choisir un type"
                          value={categoryTypeId}
                          onChange={onSelectCategoryType}
                          options={activeTypes.map((t) => ({ value: t.id, label: t.name }))}
                        />
                        <TouchableOpacity testID="add-type-toggle" onPress={() => setAddingType((v) => !v)}>
                          <Text style={styles.addLink}>+ Nouveau type</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <Text style={styles.sectionLabel}>Type</Text>
                        <View style={styles.chipRow}>
                          {activeTypes.map((t) => (
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
                    );
                  })()}
                {categoryId && categoryTypes.length === 0 && (
                  <TouchableOpacity testID="add-type-toggle" onPress={() => setAddingType((v) => !v)}>
                    <Text style={styles.addLink}>+ Ajouter un type pour cette catégorie</Text>
                  </TouchableOpacity>
                )}
                {addingType && (
                  <View style={styles.inlineAddRow}>
                    <FormField
                      testID="add-type-input"
                      containerStyle={styles.inlineAddInput}
                      placeholder="Nom du type (ex. Jardinier)"
                      value={newTypeName}
                      onChangeText={setNewTypeName}
                      onFocus={handleFocus}
                    />
                    <TouchableOpacity testID="add-type-submit" style={styles.inlineAddButton} onPress={onCreateType} disabled={creatingType}>
                      {creatingType ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.inlineAddButtonText}>Ajouter</Text>}
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
                        {subtypes.length > 4 && (
                          <>
                            <Select
                              testID="quickadd-subtype-select"
                              label="Sous-type (facultatif)"
                              placeholder="Choisir un sous-type"
                              value={categorySubtypeId}
                              onChange={(v) => setCategorySubtypeId(categorySubtypeId === v ? null : v)}
                              options={subtypes.map((s) => ({ value: s.id, label: s.name }))}
                            />
                            <TouchableOpacity testID="add-subtype-toggle" onPress={() => setAddingSubtype((v) => !v)}>
                              <Text style={styles.addLink}>+ Nouveau sous-type</Text>
                            </TouchableOpacity>
                          </>
                        )}
                        {subtypes.length > 0 && subtypes.length <= 4 && (
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
                            <FormField
                              testID="add-subtype-input"
                              containerStyle={styles.inlineAddInput}
                              placeholder="Nom du sous-type (ex. Viande)"
                              value={newSubtypeName}
                              onChangeText={setNewSubtypeName}
                              onFocus={handleFocus}
                            />
                            <TouchableOpacity testID="add-subtype-submit" style={styles.inlineAddButton} onPress={onCreateSubtype} disabled={creatingSubtype}>
                              {creatingSubtype ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.inlineAddButtonText}>Ajouter</Text>}
                            </TouchableOpacity>
                          </View>
                        )}
                      </>
                    );
                  })()}

                <FormField testID="quickadd-notes-input" placeholder="Note (facultatif)" value={notes} onChangeText={setNotes} onFocus={handleFocus} />
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
                <View style={styles.segment}>
                  {(['ponctuel', 'recurrent'] as const).map((k) => (
                    <TouchableOpacity
                      key={k}
                      testID={`quickadd-transfer-kind-${k}`}
                      style={[styles.segmentItem, transferKind === k && styles.segmentActive]}
                      onPress={() => setTransferKind(k)}
                    >
                      <Text style={[styles.segmentText, transferKind === k && styles.segmentTextActive]}>
                        {k === 'ponctuel' ? 'Ponctuel' : 'Récurrent'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {transferKind === 'recurrent' && (
                  <FormField
                    testID="quickadd-transfer-label-input"
                    placeholder="Libellé (ex. Épargne Lamiaa)"
                    value={transferLabel}
                    onChangeText={setTransferLabel}
                    onFocus={handleFocus}
                  />
                )}

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

                {transferKind === 'recurrent' && (
                  <>
                    <Select
                      testID="quickadd-transfer-frequency-select"
                      label="Fréquence"
                      value={transferRecurrenceRule}
                      options={frequencyOptions(RECURRING_TRANSFER_RULES)}
                      onChange={setTransferRecurrenceRule}
                    />
                    <DateField label="Prochain transfert" value={transferAnchorDate} onChange={setTransferAnchorDate} />
                    <FormField
                      testID="quickadd-transfer-note-input"
                      placeholder="Note (facultatif)"
                      value={transferNote}
                      onChangeText={setTransferNote}
                      onFocus={handleFocus}
                    />
                  </>
                )}

                {transferKind === 'ponctuel' && (() => {
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
                  <ActivityIndicator color={colors.textOnPrimary} />
                ) : (
                  <Text style={styles.buttonText}>
                    {mode === 'transfert' ? (transferKind === 'recurrent' ? 'CRÉER LE TRANSFERT RÉCURRENT' : 'CONFIRMER LE TRANSFERT') : 'Enregistrer'}
                  </Text>
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
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xxl, paddingTop: 40 },
  segment: { flexDirection: 'row', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, marginBottom: spacing.sm },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: colors.textPrimary },
  transferPreview: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  transferPreviewTitle: { fontSize: 10, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5, marginBottom: spacing.sm },
  transferPreviewRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  transferPreviewName: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
  transferPreviewValue: { fontSize: 13, color: colors.textPrimary, fontWeight: '700' },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.lg, textAlign: 'center' },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginBottom: spacing.lg },
  modeChip: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: spacing.sm,
    marginHorizontal: 4,
    marginBottom: spacing.sm,
  },
  modeChipActive: { backgroundColor: colors.primary },
  modeChipText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  modeChipTextActive: { color: colors.textOnPrimary },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm, marginTop: 4 },
  empty: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.md },
  pickList: { marginBottom: spacing.md },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  pickRowLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  pickRowMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  pickRowChevron: { fontSize: 20, color: colors.textPlaceholder, marginLeft: spacing.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.textPrimary },
  chipTextActive: { color: colors.textOnPrimary, fontWeight: '600' },
  chipAdd: {
    backgroundColor: colors.surfaceActive,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  chipAddText: { fontSize: 12, color: colors.success, fontWeight: '600' },
  addLink: { color: colors.success, fontSize: 13, fontWeight: '600', marginBottom: spacing.md },
  inlineAddRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  inlineAddInput: { flex: 1, marginRight: spacing.sm, marginBottom: 0 },
  inlineAddButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center' },
  inlineAddButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  hint: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.md, fontStyle: 'italic' },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 15 },
  cancel: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg, fontSize: 13 },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
});
