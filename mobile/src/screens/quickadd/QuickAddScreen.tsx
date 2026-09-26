import React, { useCallback, useEffect, useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { useTopInset } from '../../ui/useTopInset';
import { accountCreatedBus } from '../../state/events';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { Select } from '../../ui/Select';
import { FormField } from '../../ui/FormField';
import { DateField } from '../../ui/DateField';
import { frequencyOptions } from '../../ui/frequency';
import { colors, elevation, radius, spacing } from '../../ui/theme';
import { useResponsiveLayout } from '../../ui/useResponsiveLayout';

type Mode = 'depense' | 'revenu' | 'paiement' | 'transfert';

// NOUVELLE ÉVOLUTION — Réalisé vs à venir : une dépense/un revenu ponctuel(le)
// est soit un fait immédiat (Réalisée/Reçu), soit un engagement futur (À venir).
// 'reel' réutilise le moteur existant (AdHocExpense/BudgetExpense ou
// IncomeOccurrence confirmée) ; 'a_venir' réutilise EXACTEMENT le moteur des
// charges prévisionnelles (ChargePlan+Deadline ponctuel) côté dépense, et
// l'IncomeOccurrence non confirmée (statut 'prevu') côté revenu — jamais un
// second moteur de prévision.
type OperationStatus = 'reel' | 'a_venir';

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

/** Refonte §9 — 4 modes immédiatement identifiables : tuiles icône+couleur au
 * lieu de pastilles texte, jamais un simple recolorage de l'ancien sélecteur. */
const MODE_META: Record<Mode, { icon: keyof typeof Ionicons.glyphMap; color: string; soft: string }> = {
  depense: { icon: 'arrow-down-circle', color: colors.v6Red, soft: colors.v6RedSoft },
  revenu: { icon: 'arrow-up-circle', color: colors.v6Teal, soft: colors.v6TealSoft },
  paiement: { icon: 'calendar', color: colors.v6Amber, soft: colors.v6AmberSoft },
  transfert: { icon: 'swap-horizontal', color: colors.v6Blue, soft: colors.v6BlueSoft },
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
  const topInset = useTopInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const { deviceClass } = useResponsiveLayout();
  const wide = deviceClass !== 'mobile';
  // Vague 3 §3 — la bottom sheet "+" présélectionne toujours l'action (Dépense/
  // Revenu/Transfert) ; sans paramètre explicite (ex. accès direct pour "Payer
  // une échéance"), comportement inchangé (Dépense, sélecteur de mode visible).
  // Convergence V6 §4 — quand la bottom sheet "+" a fourni un mode explicite,
  // ce mode est VERROUILLÉ : plus de sélecteur "ancien style" permettant de
  // dériver vers un autre mode, chaque action ouvre un formulaire à usage
  // unique cohérent avec le langage validé, sans dupliquer la logique
  // métier (même formulaire, présentation resserrée à une seule action).
  const presetMode = route.params?.mode as Mode | undefined;
  const initialMode = presetMode ?? 'depense';
  const [mode, setMode] = useState<Mode>(initialMode);
  const modeLocked = presetMode != null;
  // M3 §5 — arrivée depuis Budget > Fiche > "+ Ajouter une dépense" : réutilise
  // ce même formulaire (jamais un second écran/objet financier), le rattachement
  // au budget est explicite (variableBudgetId) — la catégorie/le type ne sont
  // donc plus à choisir ici (déjà déterminés par le budget lui-même).
  const presetBudget = route.params?.variableBudgetId
    ? {
        variableBudgetId: route.params.variableBudgetId as string,
        budgetLabel: route.params.budgetLabel as string,
        categoryId: route.params.categoryId as string,
        categoryTypeId: (route.params.categoryTypeId as string | undefined) ?? undefined,
      }
    : null;
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  // Correction UX (date réelle éditable) : pré-remplie avec aujourd'hui, mais
  // modifiable — une dépense saisie après coup doit pouvoir porter sa vraie date.
  const [spentDate, setSpentDate] = useState(todayIso());
  // NOUVELLE ÉVOLUTION — même principe pour le revenu (aucune date n'existait
  // auparavant, today était utilisé en dur).
  const [incomeDate, setIncomeDate] = useState(todayIso());
  const [operationStatus, setOperationStatus] = useState<OperationStatus>('reel');

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
  const [categoryId, setCategoryId] = useState<string | null>(presetBudget?.categoryId ?? null);
  const [budgetHint, setBudgetHint] = useState<string | null>(null);
  // Refonte maquette V6B §9 — visible uniquement pour une dépense réelle de
  // catégorie Santé : coche "Remboursable par mutuelle" → crée automatiquement
  // un dossier MedicalClaim côté backend (jamais un revenu tant que non clôturé).
  const [remboursableMutuelle, setRemboursableMutuelle] = useState(false);
  const [expenseLabel, setExpenseLabel] = useState('');

  // Vague 2 §1/§4 — Type filtré par Catégorie, Sous-type filtré par Type, tous deux facultatifs.
  const [categoryTypes, setCategoryTypes] = useState<CategoryType[]>([]);
  const [categoryTypeId, setCategoryTypeId] = useState<string | null>(presetBudget?.categoryTypeId ?? null);
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

  // NOUVELLE ÉVOLUTION — le segment Réalisé/À venir n'a de sens que pour Dépense
  // (hors budget préréglé, toujours réalisé) et Revenu ; jamais pour Transfert
  // ni la sélection d'échéance existante (mode 'paiement').
  const showStatusToggle = (mode === 'depense' && !presetBudget) || mode === 'revenu';
  const isAVenir = showStatusToggle && operationStatus === 'a_venir';
  // Une dépense/un revenu "à venir" a besoin d'un libellé identifiant
  // l'échéance/l'occurrence future — exactement comme "Charge prévisionnelle".
  const needsLabel = mode === 'revenu' || (mode === 'depense' && isAVenir);

  useEffect(() => {
    setOperationStatus('reel');
  }, [mode]);

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
      // Corrections consolidées §7 — arrivée depuis "AJOUTER UNE TRANSACTION" sur la
      // fiche compte : préremplit ce compte (jamais imposé, le Select reste modifiable).
      const presetAccountId = route.params?.accountId as string | undefined;
      setAccountId(presetAccountId ?? quickDefault.accountId ?? (accountList[0]?.id ?? null));
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
    // NOUVELLE ÉVOLUTION — une dépense "à venir" ne crée jamais de BudgetExpense
    // (c'est un ChargePlan+Deadline) : l'astuce budget n'a pas de sens ici.
    if (mode !== 'depense' || !categoryId || isAVenir) return;
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
  }, [mode, categoryId, categories, isAVenir]);

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
    if (needsLabel && !label.trim()) {
      setError('Un libellé est requis');
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
        if (isAVenir) {
          // Cas C — Dépense à venir : réutilise EXACTEMENT le moteur de "Charge
          // prévisionnelle" (ChargePlan + Deadline ponctuel), jamais un second
          // moteur de prévision. Aucune transaction réelle créée ici.
          const plan = await api.createChargePlan({
            label: label.trim(),
            startDate: spentDate,
            categoryId: categoryId ?? undefined,
            defaultAccountId: accountId ?? undefined,
          });
          await api.createDeadline(plan.id, {
            dueDate: spentDate,
            amountStatus: 'confirme',
            amountCurrent: numericAmount,
          });
        } else {
          await api.createExpense({
            amount: numericAmount,
            accountId: accountId!,
            label: expenseLabel.trim() || undefined,
            categoryId: presetBudget ? presetBudget.categoryId : categoryId ?? undefined,
            categoryTypeId: presetBudget ? presetBudget.categoryTypeId : categoryTypeId ?? undefined,
            categorySubtypeId: presetBudget ? undefined : categorySubtypeId ?? undefined,
            variableBudgetId: presetBudget?.variableBudgetId,
            spentDate: spentDate || today,
            notes: notes || undefined,
            remboursableMutuelle: isSanteCategory ? remboursableMutuelle : undefined,
          });
        }
      } else if (mode === 'revenu') {
        // Cas B/D — Reçu vs À venir : les deux premiers appels sont IDENTIQUES
        // (source + occurrence prévue) ; seule la confirmation immédiate
        // distingue "Reçu" — jamais un second moteur de revenu prévu.
        const source = await api.createIncomeSource({
          label: label.trim(),
          usualAmount: numericAmount,
          defaultAccountId: accountId!,
          isRecurring: false,
          recurrenceRule: 'ponctuel',
        });
        const occurrence = await api.createIncomeOccurrence(source.id, { usualDate: incomeDate, plannedAmount: numericAmount });
        if (!isAVenir) {
          await api.confirmIncomeOccurrence(occurrence.id, { actualAmount: numericAmount, actualDate: incomeDate, accountId: accountId! });
        }
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
  const isSanteCategory = categories.find((c) => c.id === categoryId)?.name === 'Santé';
  const accent = MODE_META[mode];

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scroll, wide && styles.scrollWide, { paddingTop: topInset, paddingBottom: bottomInset }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>
          {presetBudget ? 'Ajouter une dépense' : modeLocked ? MODE_LABEL[mode].replace(/^\+ /, '') : 'Ajouter'}
        </Text>

        {/* M3 §5 — rattaché à un budget précis : un seul type d'objet possible
            (une dépense), jamais de choix Revenu/Échéance/Transfert ici.
            Convergence V6 §4 — idem quand le mode arrive verrouillé depuis la
            bottom sheet "+" : aucun sélecteur de mode, formulaire à usage unique.
            Refonte §9 — tuiles icône+couleur, jamais un mur de pastilles texte
            indifférenciées : chaque mode a sa propre identité visuelle. */}
        {!presetBudget && !modeLocked && (
          <View style={styles.modeGrid}>
            {(Object.keys(MODE_LABEL) as Mode[]).map((m) => {
              const meta = MODE_META[m];
              const active = mode === m;
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.modeTile, active && { borderColor: meta.color, backgroundColor: meta.soft }]}
                  onPress={() => setMode(m)}
                >
                  <View style={[styles.modeTileIcon, { backgroundColor: active ? meta.color : meta.soft }]}>
                    <Ionicons name={meta.icon} size={17} color={active ? '#fff' : meta.color} />
                  </View>
                  <Text style={[styles.modeTileText, active && { color: meta.color }]}>
                    {MODE_LABEL[m].replace(/^\+ /, '')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : (
          <View style={styles.formCard}>
            {showStatusToggle && (
              // NOUVELLE ÉVOLUTION — segmented control Réalisée/Reçu vs À venir,
              // même style visuel que le toggle Ponctuel/Récurrent du transfert.
              <View style={styles.segment} testID="quickadd-status-toggle">
                {(['reel', 'a_venir'] as const).map((s) => (
                  <TouchableOpacity
                    key={s}
                    testID={`quickadd-status-${s}`}
                    style={[styles.segmentItem, operationStatus === s && styles.segmentActive]}
                    onPress={() => setOperationStatus(s)}
                  >
                    <Text style={[styles.segmentText, operationStatus === s && styles.segmentTextActive]}>
                      {s === 'reel' ? (mode === 'revenu' ? 'Reçu' : 'Réalisée') : 'À venir'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {needsLabel && (
              <FormField
                testID="quickadd-label-input"
                placeholder={mode === 'revenu' ? 'Libellé (ex. Salaire)' : 'Libellé (ex. Loyer, Facture)'}
                value={label}
                onChangeText={setLabel}
                onFocus={handleFocus}
              />
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
              // Refonte §9 — le montant est l'élément central d'une saisie rapide :
              // carte teintée à la couleur du mode, jamais un champ texte anonyme
              // perdu au milieu des autres champs.
              <View style={[styles.amountCard, { backgroundColor: accent.soft, borderColor: accent.color }]} testID="quickadd-amount-card">
                <Text style={[styles.amountCardLabel, { color: accent.color }]}>MONTANT</Text>
                <FormField
                  testID="quickadd-amount-input"
                  placeholder="Montant (DH)"
                  keyboardType="decimal-pad"
                  value={amount}
                  onChangeText={setAmount}
                  onFocus={handleFocus}
                  containerStyle={styles.amountFieldContainer}
                />
              </View>
            )}

            {mode === 'depense' && presetBudget && (
              // M3 §5 — catégorie/type déjà déterminés par le budget d'origine,
              // jamais un second choix qui pourrait décorréler la dépense de la
              // fiche depuis laquelle elle a été lancée.
              <View style={styles.presetBudgetBanner} testID="quickadd-preset-budget-banner">
                <Text style={styles.presetBudgetLabel}>Budget</Text>
                <Text style={styles.presetBudgetValue}>{presetBudget.budgetLabel}</Text>
              </View>
            )}

            {mode === 'depense' && !presetBudget && (
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

                <FormField
                  testID="quickadd-expense-label-input"
                  label="Libellé (facultatif)"
                  placeholder="Ex. Consultation pédiatre"
                  value={expenseLabel}
                  onChangeText={setExpenseLabel}
                  onFocus={handleFocus}
                />

                {isSanteCategory && (
                  <View style={styles.mutuelleRow} testID="quickadd-mutuelle-row">
                    <View style={{ flex: 1, marginRight: spacing.sm }}>
                      <Text style={styles.pilotageLabel}>Remboursable par mutuelle</Text>
                      <Text style={styles.pilotageHelp}>
                        Crée automatiquement un dossier de suivi (Santé/Mutuelle) — le remboursement ne compte jamais comme un revenu tant qu'il n'est pas clôturé.
                      </Text>
                    </View>
                    <Switch testID="quickadd-mutuelle-switch" value={remboursableMutuelle} onValueChange={setRemboursableMutuelle} />
                  </View>
                )}

                {/* NOUVELLE ÉVOLUTION — une dépense "à venir" crée un ChargePlan
                    (categoryId uniquement) : Type/Sous-type n'existent pas sur ce
                    modèle, donc masqués plutôt que silencieusement ignorés. */}
                {!isAVenir && (
                <>
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
                </>
                )}
              </>
            )}

            {mode === 'depense' && !isAVenir && (
              // NOUVELLE ÉVOLUTION — une dépense "à venir" crée un ChargePlan
              // (pas de champ notes sur ce modèle) : masqué plutôt qu'ignoré.
              <FormField testID="quickadd-notes-input" placeholder="Note (facultatif)" value={notes} onChangeText={setNotes} onFocus={handleFocus} />
            )}

            {/* Refonte §9 — "2 colonnes intelligentes sur desktop" : date et
                compte forment une paire logique (quand + sur quel compte),
                juxtaposées sur desktop, jamais deux champs isolés l'un sous
                l'autre. Un seul écran (mobile) : empilement classique. */}
            <View style={wide ? styles.fieldRow : undefined}>
              {mode === 'depense' && (
                <View style={wide ? styles.fieldRowItem : undefined}>
                  <DateField label={isAVenir ? 'Date prévue' : 'Date de la dépense'} value={spentDate} onChange={setSpentDate} />
                </View>
              )}

              {mode === 'revenu' && (
                <View style={wide ? styles.fieldRowItem : undefined}>
                  <DateField label={isAVenir ? 'Date prévue' : 'Date de réception'} value={incomeDate} onChange={setIncomeDate} />
                </View>
              )}

              {mode !== 'paiement' && (
                // R5 clôture §6 — sélecteur compact (comptes potentiellement nombreux),
                // jamais un mur de chips permanent.
                <View style={wide ? styles.fieldRowItem : undefined}>
                  <Select
                    testID="quickadd-account-select"
                    label={mode === 'transfert' ? 'Compte source' : mode === 'revenu' && isAVenir ? 'Compte à créditer' : 'Compte'}
                    placeholder="Choisir un compte"
                    value={accountId}
                    onChange={setAccountId}
                    options={accounts.map((a) => ({
                      value: a.id,
                      label: a.name,
                      sublabel: mode === 'transfert' ? `${a.soldeCourant.toLocaleString('fr-FR')} DH` : undefined,
                    }))}
                  />
                </View>
              )}
            </View>

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
              <TouchableOpacity
                style={[styles.button, { backgroundColor: accent.color }]}
                onPress={onSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color={colors.textOnPrimary} />
                ) : (
                  <Text style={styles.buttonText}>
                    {mode === 'transfert'
                      ? transferKind === 'recurrent'
                        ? 'CRÉER LE TRANSFERT RÉCURRENT'
                        : 'CONFIRMER LE TRANSFERT'
                      : isAVenir
                        ? 'Planifier'
                        : 'Enregistrer'}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        )}

        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.cancel}>Annuler</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.v6Bg },
  scroll: { padding: spacing.xxl },
  // §15 — desktop : formulaire centré à largeur raisonnable au lieu de
  // s'étirer sur toute la page (plus de "grande page vide avec un petit
  // formulaire en haut à gauche"), jamais des champs de 1200px de large.
  // Refonte §9 — légèrement élargi (560→680) pour accueillir 2 colonnes
  // intelligentes (ex. date + compte) sans se sentir à l'étroit.
  scrollWide: { maxWidth: 680, width: '100%', alignSelf: 'center', paddingTop: spacing.xxl + spacing.md },
  formCard: {
    backgroundColor: colors.v6Surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.v6Line,
    ...elevation.card,
  },
  modeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  modeTile: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.v6Surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.v6Line,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  modeTileIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  modeTileText: { fontSize: 13, fontWeight: '700', color: colors.v6Text },
  amountCard: {
    borderRadius: radius.lg,
    borderWidth: 1.5,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  amountCardLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, marginBottom: 6 },
  amountFieldContainer: { marginBottom: 0 },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  fieldRowItem: { flexBasis: '47%', flexGrow: 1, minWidth: 220 },
  mutuelleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  pilotageLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  pilotageHelp: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
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
  modeChipActive: { backgroundColor: colors.v6Navy },
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
  chipActive: { backgroundColor: colors.v6Navy, borderColor: colors.v6Navy },
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
  inlineAddButton: { backgroundColor: colors.v6Navy, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center' },
  inlineAddButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  hint: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.md, fontStyle: 'italic' },
  presetBudgetBanner: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  presetBudgetLabel: { fontSize: 11, color: colors.textSecondary },
  presetBudgetValue: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },
  button: { backgroundColor: colors.v6Navy, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 15 },
  cancel: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg, fontSize: 13 },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
});
