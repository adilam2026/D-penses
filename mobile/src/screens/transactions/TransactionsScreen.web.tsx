import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../../api/client';
import { DateField } from '../../ui/DateField';
import { FormField } from '../../ui/FormField';
import { MultiSelect } from '../../ui/MultiSelect';
import { Select } from '../../ui/Select';
import { frequencyOptions } from '../../ui/frequency';
import { FORM_MAX_WIDTH_STANDARD, FormActions, FormContainer, FormGrid, FormGridItem } from '../../ui/FormLayout';
import { useResponsiveLayout } from '../../ui/useResponsiveLayout';
import { MAX_CONTENT_WIDTH, webColors, webRadius, webSpacing } from '../../web/webTheme';
// Portail Web v4 §1 — même source que TransactionsScreen.tsx (mobile) pour les
// filtres/regroupement : jamais une seconde règle parallèle.
import {
  DEFAULT_LIST_LIMIT,
  EMPTY_FILTERS,
  Filters,
  KIND_GROUPS,
  KIND_LABEL,
  LedgerEntry,
  STATUS_LABEL,
  formatShortDate,
  groupByDay,
  hasActiveFilters,
  toApiFilters,
} from './transactionsLogic';

// Refonte liste Transactions Web — largeur propre à la LISTE (jamais la zone
// de saisie "Nouvelle transaction" ni le tiroir de filtres, toujours sur
// MAX_CONTENT_WIDTH=1600 comme les 14 autres écrans web) : un tableau étiré
// sur 1600px laisse un vide énorme entre une date sur 2 caractères et un
// montant aligné à droite. 1120px reste dans la fourchette 1000-1200 demandée.
const LIST_MAX_WIDTH = 1120;

// Portail Web v4 §1 (règle "ne rien inventer") — EXACTEMENT les 4 actions déjà
// réellement supportées par QuickAddScreen (mobile), mêmes endpoints, mêmes
// champs. "Payer une échéance" ne soumet RIEN ici : comme sur mobile (§10 de
// QuickAddScreen), elle liste les échéances ouvertes et renvoie vers
// DeadlineDetail — le seul parcours de paiement qui existe réellement.
type Mode = 'depense' | 'revenu' | 'transfert' | 'paiement';
const MODE_LABEL: Record<Mode, string> = { depense: 'Dépense', revenu: 'Revenu', transfert: 'Transfert', paiement: 'Payer une échéance' };
const RECURRING_TRANSFER_RULES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel'] as const;

interface FormAccount {
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
  chargePlan: { label: string };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Portail Web v4 §4/§6 — vraie page de saisie desktop : zone "Nouvelle
 * transaction" toujours visible en haut (mêmes 4 actions, mêmes endpoints,
 * mêmes champs que QuickAddScreen mobile — seule la présentation change,
 * horizontale au lieu d'une bottom sheet), tableau des opérations dessous
 * avec filtres en tiroir latéral (mêmes 7 filtres que mobile). Jamais un
 * second calcul métier : chaque action appelle exactement les mêmes
 * endpoints api.* que le parcours mobile existant.
 */
export function TransactionsScreen() {
  const navigation = useNavigation<any>();

  // ---- liste des opérations ----
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // ---- référentiels partagés (filtres + formulaire) ----
  const [filterAccounts, setFilterAccounts] = useState<{ id: string; name: string }[]>([]);
  const [formAccounts, setFormAccounts] = useState<FormAccount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<{ id: string; category: { name: string } }[]>([]);
  const [plans, setPlans] = useState<{ id: string; label: string }[]>([]);
  const [members, setMembers] = useState<{ userId: string; name: string }[]>([]);
  const [openDeadlines, setOpenDeadlines] = useState<OpenDeadline[]>([]);

  // ---- formulaire "Nouvelle transaction" (mêmes champs que QuickAddScreen) ----
  const [mode, setMode] = useState<Mode>('depense');
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryTypes, setCategoryTypes] = useState<CategoryType[]>([]);
  const [categoryTypeId, setCategoryTypeId] = useState<string | null>(null);
  const [categorySubtypeId, setCategorySubtypeId] = useState<string | null>(null);
  const [transferKind, setTransferKind] = useState<'ponctuel' | 'recurrent'>('ponctuel');
  const [transferLabel, setTransferLabel] = useState('');
  const [transferRecurrenceRule, setTransferRecurrenceRule] = useState<string>('mensuel');
  const [transferAnchorDate, setTransferAnchorDate] = useState('');
  const [transferNote, setTransferNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadList = useCallback(async (filters: Filters) => {
    setListLoading(true);
    try {
      setEntries(await api.listTransactions(toApiFilters(filters)));
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadReferentials = useCallback(async () => {
    const [filterAccs, formAccs, cats, buds, pls, household, quickDefault, deadlines] = await Promise.all([
      api.listAccounts(true),
      api.listAccounts(),
      api.listCategories(),
      api.listVariableBudgets(),
      api.listFinancialPlans(),
      api.getMyHousehold(),
      api.getQuickAddDefaultAccount(),
      api.listOpenDeadlines(),
    ]);
    setFilterAccounts(filterAccs);
    setFormAccounts(formAccs);
    setCategories(cats);
    setBudgets(buds);
    setPlans(pls);
    setMembers((household.memberships ?? []).map((m: any) => ({ userId: m.user.id, name: `${m.user.firstName} ${m.user.lastName}` })));
    setOpenDeadlines(deadlines);
    setAccountId((current) => current ?? quickDefault.accountId ?? formAccs[0]?.id ?? null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadList(appliedFilters);
      loadReferentials();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appliedFilters]),
  );

  useEffect(() => {
    setCategoryTypes([]);
    setCategoryTypeId(null);
    setCategorySubtypeId(null);
    if (mode !== 'depense' || !categoryId) return;
    let cancelled = false;
    api.listCategoryTypes(categoryId).then((types: CategoryType[]) => {
      if (!cancelled) setCategoryTypes(types);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, categoryId]);

  const budgetLabelById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of budgets) map[b.id] = b.category.name;
    return map;
  }, [budgets]);
  const planLabelById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of plans) map[p.id] = p.label;
    return map;
  }, [plans]);
  const sections = useMemo(() => groupByDay(entries), [entries]);
  const { deviceClass } = useResponsiveLayout();
  const compactRows = deviceClass === 'mobile';
  const expenseCategories = categories.filter((c) => c.kind === 'expense' || c.kind === 'both');
  const filtersActive = hasActiveFilters(appliedFilters);

  function resetFormFields() {
    setAmount('');
    setLabel('');
    setNotes('');
    setCategoryId(null);
    setCategoryTypeId(null);
    setCategorySubtypeId(null);
    setToAccountId(null);
    setTransferLabel('');
    setTransferAnchorDate('');
    setTransferNote('');
  }

  async function onSubmit() {
    if (mode === 'paiement') return;
    setFormError(null);
    const numericAmount = Number(amount.replace(',', '.'));
    if (!numericAmount || numericAmount <= 0) {
      setFormError('Montant invalide');
      return;
    }
    if (!accountId) {
      setFormError('Créez un compte avant de saisir une transaction.');
      return;
    }
    if (mode === 'transfert' && transferKind === 'recurrent') {
      if (!transferLabel.trim()) {
        setFormError('Un libellé est requis pour un transfert récurrent');
        return;
      }
      if (!transferAnchorDate) {
        setFormError('Le prochain transfert est requis');
        return;
      }
    }

    setSubmitting(true);
    try {
      const today = todayIso();
      if (mode === 'depense') {
        await api.createExpense({
          amount: numericAmount,
          accountId,
          categoryId: categoryId ?? undefined,
          categoryTypeId: categoryTypeId ?? undefined,
          categorySubtypeId: categorySubtypeId ?? undefined,
          notes: notes || undefined,
        });
      } else if (mode === 'revenu') {
        if (!label.trim()) {
          setFormError('Un libellé est requis');
          setSubmitting(false);
          return;
        }
        const source = await api.createIncomeSource({
          label: label.trim(),
          usualAmount: numericAmount,
          defaultAccountId: accountId,
          isRecurring: false,
          recurrenceRule: 'ponctuel',
        });
        const occurrence = await api.createIncomeOccurrence(source.id, { usualDate: today, plannedAmount: numericAmount });
        await api.confirmIncomeOccurrence(occurrence.id, { actualAmount: numericAmount, actualDate: today, accountId });
      } else {
        if (!toAccountId || toAccountId === accountId) {
          setFormError('Choisissez un compte de destination différent');
          setSubmitting(false);
          return;
        }
        if (transferKind === 'recurrent') {
          await api.createRecurringTransfer({
            label: transferLabel.trim(),
            fromAccountId: accountId,
            toAccountId,
            amount: numericAmount,
            recurrenceRule: transferRecurrenceRule as (typeof RECURRING_TRANSFER_RULES)[number],
            recurrenceAnchorDate: transferAnchorDate,
            note: transferNote.trim() || undefined,
          });
        } else {
          await api.createTransfer({ fromAccountId: accountId, toAccountId, amount: numericAmount, plannedDate: today });
        }
      }
      resetFormFields();
      await Promise.all([loadList(appliedFilters), loadReferentials()]);
    } catch (err) {
      setFormError(err instanceof api.ApiError ? err.message : 'Enregistrement impossible');
    } finally {
      setSubmitting(false);
    }
  }

  function openFilters() {
    setDraftFilters(appliedFilters);
    setFiltersOpen(true);
  }
  function applyFilters() {
    setAppliedFilters(draftFilters);
    setFiltersOpen(false);
    loadList(draftFilters);
  }
  function resetFilters() {
    setDraftFilters(EMPTY_FILTERS);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      {/* Zone de saisie — toujours visible, utile dès l'ouverture (§6). Largeur
          plafonnée (FormContainer, §"correction structurelle formulaires") :
          jamais étirée sur toute la largeur de page comme la liste en dessous
          (largeurs indépendantes, cf. FORM_MAX_WIDTH_STANDARD vs LIST_MAX_WIDTH). */}
      <FormContainer maxWidth={FORM_MAX_WIDTH_STANDARD} style={styles.formCard}>
        <Text style={styles.formTitle}>Nouvelle transaction</Text>
        <View style={styles.modeRow}>
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <TouchableOpacity key={m} testID={`web-tx-mode-${m}`} style={[styles.modeChip, mode === m && styles.modeChipActive]} onPress={() => setMode(m)}>
              <Text style={[styles.modeChipText, mode === m && styles.modeChipTextActive]}>{MODE_LABEL[m]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {formAccounts.length === 0 ? (
          <View style={styles.noAccountBanner}>
            <Text style={styles.noAccountText}>Aucun compte configuré.</Text>
            <TouchableOpacity onPress={() => navigation.navigate('QuickCreateAccount')}>
              <Text style={styles.noAccountLink}>Créer un compte →</Text>
            </TouchableOpacity>
          </View>
        ) : mode === 'paiement' ? (
          openDeadlines.length === 0 ? (
            <Text style={styles.empty}>Aucune échéance ouverte pour l'instant.</Text>
          ) : (
            <View style={styles.deadlineGrid}>
              {openDeadlines.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  testID={`web-pick-deadline-${d.id}`}
                  style={styles.deadlineCard}
                  onPress={() => navigation.navigate('DeadlineDetail', { id: d.id })}
                >
                  <Text style={styles.deadlineLabel} numberOfLines={1}>
                    {d.chargePlan.label}
                  </Text>
                  <Text style={styles.deadlineAmount}>{d.resteAPayer !== null ? `${d.resteAPayer.toLocaleString('fr-FR')} DH` : 'Montant inconnu'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )
        ) : (
          <>
            {/* Grille compacte (mobile 1 colonne / tablette 2 / desktop 3) — le
                champ Note prend 2 colonnes ; le bouton d'action suit dans la
                même grille et se replace naturellement sur la place restante
                (flexWrap), jamais isolé loin à droite d'une page large. */}
            <FormGrid columns={{ mobile: 1, tablet: 2, desktop: 3 }}>
              {mode === 'revenu' && (
                <FormGridItem>
                  <FormField testID="web-tx-label" label="Libellé" placeholder="ex. Salaire" value={label} onChangeText={setLabel} />
                </FormGridItem>
              )}
              <FormGridItem>
                <FormField testID="web-tx-amount" label="Montant (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
              </FormGridItem>
              <FormGridItem>
                <Select
                  testID="web-tx-account"
                  label={mode === 'transfert' ? 'Compte source' : 'Compte'}
                  placeholder="Choisir un compte"
                  value={accountId}
                  onChange={setAccountId}
                  options={formAccounts.map((a) => ({ value: a.id, label: a.name, sublabel: mode === 'transfert' ? `${a.soldeCourant.toLocaleString('fr-FR')} DH` : undefined }))}
                />
              </FormGridItem>

              {mode === 'depense' && (
                <>
                  <FormGridItem>
                    <Select
                      testID="web-tx-category"
                      label="Catégorie"
                      placeholder="Facultatif"
                      value={categoryId}
                      onChange={(v) => setCategoryId(categoryId === v ? null : v)}
                      options={expenseCategories.map((c) => ({ value: c.id, label: c.name }))}
                    />
                  </FormGridItem>
                  {categoryTypes.length > 0 && (
                    <FormGridItem>
                      <Select
                        testID="web-tx-type"
                        label="Type"
                        placeholder="Facultatif"
                        value={categoryTypeId}
                        onChange={(v) => {
                          setCategoryTypeId(categoryTypeId === v ? null : v);
                          setCategorySubtypeId(null);
                        }}
                        options={categoryTypes.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))}
                      />
                    </FormGridItem>
                  )}
                  {categoryTypeId && (() => {
                    const subtypes = categoryTypes.find((t) => t.id === categoryTypeId)?.subtypes.filter((s) => s.active) ?? [];
                    if (subtypes.length === 0) return null;
                    return (
                      <FormGridItem>
                        <Select
                          testID="web-tx-subtype"
                          label="Sous-type"
                          placeholder="Facultatif"
                          value={categorySubtypeId}
                          onChange={(v) => setCategorySubtypeId(categorySubtypeId === v ? null : v)}
                          options={subtypes.map((s) => ({ value: s.id, label: s.name }))}
                        />
                      </FormGridItem>
                    );
                  })()}
                  <FormGridItem span={2}>
                    <FormField testID="web-tx-notes" label="Note" placeholder="Facultatif" value={notes} onChangeText={setNotes} />
                  </FormGridItem>
                </>
              )}

              {mode === 'transfert' && (
                <FormGridItem>
                  <Select
                    testID="web-tx-dest-account"
                    label="Compte destination"
                    placeholder="Choisir un compte"
                    value={toAccountId}
                    onChange={setToAccountId}
                    options={formAccounts.filter((a) => a.id !== accountId).map((a) => ({ value: a.id, label: a.name, sublabel: `${a.soldeCourant.toLocaleString('fr-FR')} DH` }))}
                  />
                </FormGridItem>
              )}

              {mode !== 'transfert' && (
                <FormGridItem>
                  <Text style={styles.actionLabelSpacer}> </Text>
                  {formError ? <Text style={styles.error}>{formError}</Text> : null}
                  <TouchableOpacity testID="web-tx-submit" style={styles.submitButton} onPress={onSubmit} disabled={submitting}>
                    {submitting ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.submitButtonText}>Enregistrer</Text>}
                  </TouchableOpacity>
                </FormGridItem>
              )}
            </FormGrid>

            {mode === 'transfert' && (
              <>
                <View style={styles.transferKindRow}>
                  {(['ponctuel', 'recurrent'] as const).map((k) => (
                    <TouchableOpacity
                      key={k}
                      testID={`web-tx-transfer-kind-${k}`}
                      style={[styles.segmentItem, transferKind === k && styles.segmentActive]}
                      onPress={() => setTransferKind(k)}
                    >
                      <Text style={[styles.segmentText, transferKind === k && styles.segmentTextActive]}>{k === 'ponctuel' ? 'Ponctuel' : 'Récurrent'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {transferKind === 'recurrent' ? (
                  <FormGrid columns={{ mobile: 1, tablet: 2, desktop: 3 }}>
                    <FormGridItem>
                      <FormField testID="web-tx-transfer-label" label="Libellé" placeholder="ex. Épargne" value={transferLabel} onChangeText={setTransferLabel} />
                    </FormGridItem>
                    <FormGridItem>
                      <Select
                        testID="web-tx-transfer-frequency"
                        label="Fréquence"
                        value={transferRecurrenceRule}
                        options={frequencyOptions(RECURRING_TRANSFER_RULES)}
                        onChange={setTransferRecurrenceRule}
                      />
                    </FormGridItem>
                    <FormGridItem>
                      <DateField label="Prochain transfert" value={transferAnchorDate} onChange={setTransferAnchorDate} />
                    </FormGridItem>
                    <FormGridItem span={2}>
                      <FormField testID="web-tx-transfer-note" label="Note" placeholder="Facultatif" value={transferNote} onChangeText={setTransferNote} />
                    </FormGridItem>
                    <FormGridItem>
                      <Text style={styles.actionLabelSpacer}> </Text>
                      {formError ? <Text style={styles.error}>{formError}</Text> : null}
                      <TouchableOpacity testID="web-tx-submit" style={styles.submitButton} onPress={onSubmit} disabled={submitting}>
                        {submitting ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.submitButtonText}>Créer le transfert récurrent</Text>}
                      </TouchableOpacity>
                    </FormGridItem>
                  </FormGrid>
                ) : (
                  <>
                    {(() => {
                      const numericAmount = Number(amount.replace(',', '.'));
                      const from = formAccounts.find((a) => a.id === accountId);
                      const to = formAccounts.find((a) => a.id === toAccountId);
                      if (!from || !to || !numericAmount || numericAmount <= 0) return null;
                      return (
                        <View style={styles.transferPreview} testID="web-transfer-preview">
                          <Text style={styles.transferPreviewLine}>
                            {from.name} : {from.soldeCourant.toLocaleString('fr-FR')} → {(from.soldeCourant - numericAmount).toLocaleString('fr-FR')} DH
                          </Text>
                          <Text style={styles.transferPreviewLine}>
                            {to.name} : {to.soldeCourant.toLocaleString('fr-FR')} → {(to.soldeCourant + numericAmount).toLocaleString('fr-FR')} DH
                          </Text>
                        </View>
                      );
                    })()}
                    <FormActions align="left">
                      {formError ? <Text style={styles.error}>{formError}</Text> : null}
                      <TouchableOpacity testID="web-tx-submit" style={styles.submitButton} onPress={onSubmit} disabled={submitting}>
                        {submitting ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.submitButtonText}>Confirmer le transfert</Text>}
                      </TouchableOpacity>
                    </FormActions>
                  </>
                )}
              </>
            )}
          </>
        )}
      </FormContainer>

      {/* Opérations — liste dense, groupée par jour (Aujourd'hui / Hier / date). */}
      <View style={styles.listWrap}>
        <View style={styles.listHead}>
          <Text style={styles.listTitle}>Opérations</Text>
          <TouchableOpacity testID="web-tx-filters-button" style={styles.filterButton} onPress={openFilters}>
            <Text style={styles.filterButtonText}>Filtres{filtersActive ? ' •' : ''}</Text>
          </TouchableOpacity>
        </View>

        {entries.length === DEFAULT_LIST_LIMIT && (
          <Text style={styles.limitWarning}>Affichage limité aux {DEFAULT_LIST_LIMIT} transactions les plus récentes — affinez les filtres pour voir le reste.</Text>
        )}

        <View style={styles.table}>
          {!compactRows && (
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.th, styles.colDate]}>Date</Text>
              <Text style={[styles.th, styles.colLabel]}>Libellé</Text>
              <Text style={[styles.th, styles.colCategory]}>Catégorie</Text>
              <Text style={[styles.th, styles.colAccount]}>Compte / enveloppe</Text>
              <Text style={[styles.th, styles.colStatus]}>Statut</Text>
              <Text style={[styles.th, styles.colAmount]}>Montant</Text>
              <View style={styles.colActions} />
            </View>
          )}

          {listLoading && entries.length === 0 ? (
            <ActivityIndicator style={{ marginTop: 24 }} />
          ) : entries.length === 0 ? (
            <Text style={styles.empty}>{filtersActive ? 'Aucune transaction pour ces filtres.' : "Aucune transaction pour l'instant."}</Text>
          ) : (
            sections.map((section) => (
              <View key={section.title}>
                <Text style={styles.dayHeader}>{section.title}</Text>
                {section.data.map((item) => {
                  const positive = item.amount >= 0;
                  const budgetLabel = item.budgetId ? (budgetLabelById[item.budgetId] ?? 'Budget') : null;
                  const planLabel = item.financialPlanId ? (planLabelById[item.financialPlanId] ?? 'Plan') : null;
                  const attachLabel = planLabel ?? budgetLabel;
                  const label = item.label ?? KIND_LABEL[item.displayKind] ?? item.kind;
                  const statusLabel = STATUS_LABEL[item.displayKind] ?? null;
                  const amountText = `${positive ? '+' : ''}${item.amount.toLocaleString('fr-FR')} DH`;
                  const openDetail = () => navigation.navigate('TransactionDetail', { kind: item.kind, id: item.id });

                  if (compactRows) {
                    return (
                      <TouchableOpacity
                        key={`${item.kind}-${item.id}`}
                        testID={`web-transaction-row-${item.kind}-${item.id}`}
                        style={styles.compactRow}
                        onPress={openDetail}
                      >
                        <View style={styles.compactTopLine}>
                          <Text style={styles.compactLabel} numberOfLines={1}>
                            {label}
                          </Text>
                          <Text style={[styles.compactAmount, positive ? styles.amountPositive : styles.amountNegative]}>{amountText}</Text>
                        </View>
                        <Text style={styles.compactMeta} numberOfLines={1}>
                          {formatShortDate(item.occurredAt)} · {item.accountName}
                        </Text>
                        <Text style={styles.compactMeta} numberOfLines={1}>
                          {item.categoryName ?? '—'}
                          {statusLabel ? ` · ${statusLabel}` : ''}
                        </Text>
                      </TouchableOpacity>
                    );
                  }

                  return (
                    <TouchableOpacity
                      key={`${item.kind}-${item.id}`}
                      testID={`web-transaction-row-${item.kind}-${item.id}`}
                      style={styles.tableRow}
                      onPress={openDetail}
                    >
                      <Text style={[styles.td, styles.colDate]}>{formatShortDate(item.occurredAt)}</Text>
                      <Text style={[styles.td, styles.colLabel]} numberOfLines={1}>
                        {label}
                      </Text>
                      <Text style={[styles.td, styles.colCategory]} numberOfLines={1}>
                        {item.categoryName ?? '—'}
                      </Text>
                      <Text style={[styles.td, styles.colAccount]} numberOfLines={1}>
                        {item.accountName}
                        {attachLabel ? ` / ${attachLabel}` : ''}
                      </Text>
                      <View style={styles.colStatus}>
                        {statusLabel && <Text style={styles.statusBadge}>{statusLabel}</Text>}
                      </View>
                      <Text style={[styles.td, styles.colAmount, positive ? styles.amountPositive : styles.amountNegative]}>{amountText}</Text>
                      <TouchableOpacity
                        testID={`web-transaction-actions-${item.kind}-${item.id}`}
                        style={styles.colActions}
                        onPress={openDetail}
                      >
                        <Ionicons name="ellipsis-horizontal" size={16} color={webColors.textSecondary} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))
          )}
        </View>
      </View>

      {/* Tiroir latéral Filtres — mêmes 7 champs que la modal mobile. */}
      {filtersOpen && (
        <View style={styles.drawerOverlay}>
          <TouchableOpacity style={styles.drawerBackdrop} onPress={() => setFiltersOpen(false)} />
          <ScrollView style={styles.drawer} contentContainerStyle={styles.drawerContent}>
            <Text style={styles.drawerTitle}>Filtrer les transactions</Text>

            <View style={styles.dateRow}>
              <View style={{ flex: 1, marginRight: webSpacing.sm }}>
                <DateField label="Du" placeholder="Date de début" value={draftFilters.from} onChange={(v) => setDraftFilters((f) => ({ ...f, from: v }))} />
              </View>
              <View style={{ flex: 1 }}>
                <DateField label="Au" placeholder="Date de fin" value={draftFilters.to} onChange={(v) => setDraftFilters((f) => ({ ...f, to: v }))} />
              </View>
            </View>

            <MultiSelect
              testID="web-tx-filter-kind"
              label="Type"
              placeholder="Tous les types"
              value={draftFilters.kinds}
              onChange={(kinds) => setDraftFilters((f) => ({ ...f, kinds }))}
              options={Object.keys(KIND_GROUPS).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            />
            <Select
              testID="web-tx-filter-account"
              label="Compte"
              placeholder="Tous les comptes"
              value={draftFilters.accountId}
              onChange={(v) => setDraftFilters((f) => ({ ...f, accountId: v }))}
              options={filterAccounts.map((a) => ({ value: a.id, label: a.name }))}
            />
            <Select
              testID="web-tx-filter-category"
              label="Catégorie"
              placeholder="Toutes les catégories"
              value={draftFilters.categoryId}
              onChange={(v) => setDraftFilters((f) => ({ ...f, categoryId: v }))}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
            <Select
              testID="web-tx-filter-budget"
              label="Budget"
              placeholder="Tous les budgets"
              value={draftFilters.budgetId}
              onChange={(v) => setDraftFilters((f) => ({ ...f, budgetId: v }))}
              options={budgets.map((b) => ({ value: b.id, label: b.category.name }))}
            />
            <Select
              testID="web-tx-filter-plan"
              label="Plan financier"
              placeholder="Tous les plans"
              value={draftFilters.financialPlanId}
              onChange={(v) => setDraftFilters((f) => ({ ...f, financialPlanId: v }))}
              options={plans.map((p) => ({ value: p.id, label: p.label }))}
            />
            <Select
              testID="web-tx-filter-initiator"
              label="Initiateur"
              placeholder="Tout le monde"
              value={draftFilters.createdByUserId}
              onChange={(v) => setDraftFilters((f) => ({ ...f, createdByUserId: v }))}
              options={members.map((m) => ({ value: m.userId, label: m.name }))}
            />

            <View style={styles.drawerActions}>
              <TouchableOpacity style={styles.drawerButtonSecondary} onPress={resetFilters}>
                <Text style={styles.drawerButtonSecondaryText}>Réinitialiser</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="web-tx-filters-apply" style={styles.drawerButton} onPress={applyFilters}>
                <Text style={styles.drawerButtonText}>Appliquer</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center' },

  formCard: {
    backgroundColor: webColors.surface,
    borderRadius: webRadius.xl,
    padding: webSpacing.lg,
    borderWidth: 1,
    borderColor: webColors.borderStrong,
    marginBottom: webSpacing.xl,
  },
  formTitle: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.sm },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: webSpacing.sm, marginBottom: webSpacing.md },
  modeChip: { backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.pill, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: webColors.border },
  modeChipActive: { backgroundColor: webColors.primary, borderColor: webColors.primary },
  modeChipText: { fontSize: 12, fontWeight: '600', color: webColors.textSecondary },
  modeChipTextActive: { color: webColors.textOnPrimary },

  noAccountBanner: { flexDirection: 'row', alignItems: 'center', gap: webSpacing.sm },
  noAccountText: { fontSize: 13, color: webColors.textSecondary },
  noAccountLink: { fontSize: 13, fontWeight: '700', color: webColors.success },

  actionLabelSpacer: { fontSize: 13, fontWeight: '600', marginBottom: 6, opacity: 0 },

  transferKindRow: { flexDirection: 'row', backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.md, padding: 3, marginTop: webSpacing.sm, width: 220 },
  segmentItem: { flex: 1, paddingVertical: 8, borderRadius: webRadius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: webColors.surface },
  segmentText: { fontSize: 12, color: webColors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: webColors.textPrimary },
  transferPreview: { marginTop: webSpacing.sm },
  transferPreviewLine: { fontSize: 12, color: webColors.textPrimary, fontWeight: '600', marginTop: 2 },

  submitButton: { backgroundColor: webColors.primary, borderRadius: webRadius.md, paddingHorizontal: 20, paddingVertical: 10, alignSelf: 'flex-start' },
  submitButtonText: { color: webColors.textOnPrimary, fontWeight: '700', fontSize: 13 },
  error: { color: webColors.danger, fontSize: 12, fontWeight: '600', marginBottom: 6 },

  deadlineGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: webSpacing.sm },
  deadlineCard: { width: 220, backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.md, padding: webSpacing.sm, borderWidth: 1, borderColor: webColors.border },
  deadlineLabel: { fontSize: 13, fontWeight: '700', color: webColors.textPrimary },
  deadlineAmount: { fontSize: 12, color: webColors.textSecondary, marginTop: 2 },

  listWrap: { width: '100%', maxWidth: LIST_MAX_WIDTH, alignSelf: 'center' },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: webSpacing.sm },
  listTitle: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary },
  filterButton: { backgroundColor: webColors.surface, borderRadius: webRadius.pill, paddingHorizontal: webSpacing.md, paddingVertical: 8, borderWidth: 1, borderColor: webColors.borderStrong },
  filterButtonText: { fontSize: 12, fontWeight: '600', color: webColors.textPrimary },
  limitWarning: { fontSize: 11, color: webColors.textSecondary, marginBottom: webSpacing.sm, fontStyle: 'italic' },

  table: { backgroundColor: webColors.surface, borderRadius: webRadius.lg, borderWidth: 1, borderColor: webColors.border, overflow: 'hidden' },
  tableHeaderRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: webColors.tableHeaderBg, paddingHorizontal: webSpacing.md, paddingVertical: 8 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: webSpacing.md, paddingVertical: 9, borderTopWidth: 1, borderTopColor: webColors.tableRowBorder },
  th: { fontSize: 11, fontWeight: '700', color: webColors.textSecondary, textTransform: 'uppercase' },
  td: { fontSize: 12, color: webColors.textPrimary },
  colDate: { width: 64 },
  colLabel: { flex: 2, paddingRight: webSpacing.sm },
  colCategory: { flex: 1, paddingRight: webSpacing.sm },
  colAccount: { flex: 1.4, paddingRight: webSpacing.sm },
  colStatus: { width: 84, alignItems: 'flex-start' },
  colAmount: { width: 100, textAlign: 'right', fontWeight: '700' },
  colActions: { width: 28, alignItems: 'center', justifyContent: 'center' },
  amountPositive: { color: webColors.success },
  amountNegative: { color: webColors.danger },
  statusBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: webColors.textSecondary,
    backgroundColor: webColors.surfaceMuted,
    borderRadius: webRadius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  dayHeader: { fontSize: 11, fontWeight: '700', color: webColors.textSecondary, textTransform: 'uppercase', paddingHorizontal: webSpacing.md, paddingTop: webSpacing.sm, paddingBottom: 4, backgroundColor: webColors.surfaceMuted },
  empty: { color: webColors.textSecondary, textAlign: 'center', padding: webSpacing.xl, fontSize: 13 },

  // Ligne compacte mobile (§ refonte liste Web) — même composant, seule la
  // présentation change en dessous du seuil "mobile" de useResponsiveLayout.
  compactRow: { paddingHorizontal: webSpacing.md, paddingVertical: webSpacing.sm, borderTopWidth: 1, borderTopColor: webColors.tableRowBorder },
  compactTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  compactLabel: { fontSize: 13, fontWeight: '600', color: webColors.textPrimary, flexShrink: 1, paddingRight: webSpacing.sm },
  compactAmount: { fontSize: 13, fontWeight: '700' },
  compactMeta: { fontSize: 11, color: webColors.textSecondary, marginTop: 2 },

  drawerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', justifyContent: 'flex-end', zIndex: 30 },
  drawerBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,26,41,0.35)' },
  drawer: { width: 360, backgroundColor: webColors.surface, height: '100%' },
  drawerContent: { padding: webSpacing.lg },
  drawerTitle: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.md },
  dateRow: { flexDirection: 'row', marginBottom: webSpacing.xs },
  drawerActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: webSpacing.md, gap: webSpacing.sm },
  drawerButton: { backgroundColor: webColors.primary, borderRadius: webRadius.sm, paddingHorizontal: 18, paddingVertical: 10 },
  drawerButtonText: { color: webColors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  drawerButtonSecondary: { paddingHorizontal: 14, paddingVertical: 10 },
  drawerButtonSecondaryText: { color: webColors.textSecondary, fontWeight: '600', fontSize: 13 },
});
