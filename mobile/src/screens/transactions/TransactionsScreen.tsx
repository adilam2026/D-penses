import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Modal, RefreshControl, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { DateField } from '../../ui/DateField';
import { MultiSelect } from '../../ui/MultiSelect';
import { Select } from '../../ui/Select';
import { colors, elevation, radius, spacing } from '../../ui/theme';

interface LedgerEntry {
  kind: string;
  displayKind: string;
  id: string;
  occurredAt: string;
  amount: number;
  accountName: string;
  // Vague 2 §20 : quand un Type est renseigné (Courses, Carburant...), le backend
  // construit déjà `label` en "Type · Sous-type" (ex. "Courses · Viande") — jamais
  // recalculé côté mobile, la catégorie parente reste affichée séparément ci-dessous.
  label: string | null;
  categoryName: string | null;
  categoryTypeName: string | null;
  categorySubtypeName: string | null;
  // Mini-lot T2 — colonnes exposées par le Lot T1 backend.
  createdByUserId: string | null;
  createdByName: string | null;
  budgetId: string | null;
  financialPlanId: string | null;
}

const KIND_LABEL: Record<string, string> = {
  revenu: 'Revenu',
  paiement: 'Paiement',
  depense: 'Dépense',
  transfert: 'Transfert',
  ajustement: 'Ajustement',
};

// Mini-lot T2 — mapping affichage → kinds bruts (pure couche mobile, jamais un
// nouveau paramètre serveur : le backend accepte déjà kind=a,b,c en CSV, T1).
// L'utilisateur choisit un "Type" au sens de l'écran (les 5 catégories déjà
// affichées), jamais les 7 valeurs brutes de la vue ledger_entry.
const KIND_GROUPS: Record<string, string[]> = {
  revenu: ['income'],
  paiement: ['payment'],
  depense: ['budget_expense', 'adhoc_expense'],
  transfert: ['transfer_in', 'transfer_out'],
  ajustement: ['adjustment'],
};

// Limite par défaut du backend (transactions.service.ts) — T2 n'introduit aucune
// pagination ; on se contente de signaler quand le résultat semble tronqué.
const DEFAULT_LIST_LIMIT = 200;

interface Filters {
  from: string; // DateField ISO (YYYY-MM-DD) ou ''
  to: string;
  kinds: string[]; // clés de KIND_GROUPS
  accountId: string | null;
  categoryId: string | null;
  budgetId: string | null;
  financialPlanId: string | null;
  createdByUserId: string | null;
}

const EMPTY_FILTERS: Filters = {
  from: '',
  to: '',
  kinds: [],
  accountId: null,
  categoryId: null,
  budgetId: null,
  financialPlanId: null,
  createdByUserId: null,
};

function hasActiveFilters(f: Filters): boolean {
  return (
    !!f.from ||
    !!f.to ||
    f.kinds.length > 0 ||
    !!f.accountId ||
    !!f.categoryId ||
    !!f.budgetId ||
    !!f.financialPlanId ||
    !!f.createdByUserId
  );
}

function kindsToCsv(kinds: string[]): string | undefined {
  if (kinds.length === 0) return undefined;
  const raw = kinds.flatMap((k) => KIND_GROUPS[k] ?? []);
  return raw.length ? raw.join(',') : undefined;
}

/**
 * Conversion des filtres de période vers l'API — réutilise EXACTEMENT la
 * convention déjà en place dans l'app (BudgetDetailScreen.periodEndExclusive,
 * elle-même alignée sur le backend) : une date de fin choisie par l'utilisateur
 * via DateField (YYYY-MM-DD, jour inclus) doit couvrir la journée entière, donc
 * `to` = lendemain minuit UTC. `from` est déjà un jour-seul ISO, interprété par
 * `new Date()` comme minuit UTC (mécanisme natif, aucune conversion à écrire) —
 * jamais un nouveau moteur de dates.
 */
function toApiFilters(f: Filters): api.TransactionFilters {
  return {
    from: f.from ? new Date(f.from).toISOString() : undefined,
    to: f.to ? new Date(new Date(f.to).getTime() + 86400000).toISOString() : undefined,
    kind: kindsToCsv(f.kinds),
    accountId: f.accountId ?? undefined,
    categoryId: f.categoryId ?? undefined,
    budgetId: f.budgetId ?? undefined,
    financialPlanId: f.financialPlanId ?? undefined,
    createdByUserId: f.createdByUserId ?? undefined,
  };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Clé de regroupement mensuel — dérivée directement de la chaîne ISO renvoyée
 *  par l'API (déjà en UTC côté backend), jamais Date.getMonth() (fuseau local) :
 *  même logique "pas de conversion implicite" que le reste de l'app. */
function monthKey(occurredAtIso: string): string {
  return occurredAtIso.slice(0, 7); // YYYY-MM
}

function monthSectionTitle(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Écran Transactions (§13) — affiche LedgerEntry (docs/04 §P.2), purement dérivée
 * en lecture seule : aucune table "Transaction" source de vérité n'est créée ici.
 *
 * Mini-lot T2 — panneau de filtres exploitant le registre du Lot T1 backend,
 * regroupement par mois civil, affichage de l'initiateur et des rattachements
 * budget/plan quand disponibles. Aucun changement backend.
 */
export function TransactionsScreen() {
  const navigation = useNavigation<any>();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Référentiels pour les sélecteurs du panneau ET pour mapper budgetId/
  // financialPlanId vers un libellé affichable sur chaque ligne (T2 §3) — pas
  // seulement les éléments actifs : listVariableBudgets/listFinancialPlans
  // renvoient déjà tout l'historique (aucun filtre actif/inactif côté backend),
  // et listAccounts(true) inclut les comptes archivés pour la même raison.
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [budgets, setBudgets] = useState<{ id: string; category: { name: string } }[]>([]);
  const [plans, setPlans] = useState<{ id: string; label: string }[]>([]);
  const [members, setMembers] = useState<{ userId: string; name: string }[]>([]);

  const load = useCallback(async (filters: Filters) => {
    setLoading(true);
    try {
      setEntries(await api.listTransactions(toApiFilters(filters)));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(appliedFilters);
      // Référentiels chargés une fois par focus — coût négligeable, jamais
      // désynchronisés si un budget/compte est créé ailleurs entre deux visites.
      api.listAccounts(true).then(setAccounts);
      api.listCategories().then(setCategories);
      api.listVariableBudgets().then(setBudgets);
      api.listFinancialPlans().then(setPlans);
      api.getMyHousehold().then((h: any) =>
        setMembers((h.memberships ?? []).map((m: any) => ({ userId: m.user.id, name: `${m.user.firstName} ${m.user.lastName}` }))),
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appliedFilters]),
  );

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

  const sections = useMemo(() => {
    const byMonth = new Map<string, LedgerEntry[]>();
    for (const e of entries) {
      const key = monthKey(e.occurredAt);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(e);
    }
    return Array.from(byMonth.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, data]) => ({ title: monthSectionTitle(key), data }));
  }, [entries]);

  function openFilters() {
    setDraftFilters(appliedFilters);
    setFiltersOpen(true);
  }

  function applyFilters() {
    setAppliedFilters(draftFilters);
    setFiltersOpen(false);
    // Déclenché explicitement ici (jamais seulement via l'effet de focus) :
    // le rechargement doit être immédiat au clic sur "Appliquer", pas dépendre
    // d'un futur re-déclenchement de useFocusEffect.
    load(draftFilters);
  }

  function resetFilters() {
    setDraftFilters(EMPTY_FILTERS);
  }

  const filtersActive = hasActiveFilters(appliedFilters);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Transactions</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity testID="transactions-filters-button" style={styles.filterButton} onPress={openFilters}>
            <Text style={styles.filterButtonText}>Filtres{filtersActive ? ' •' : ''}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.addButton} onPress={() => navigation.getParent()?.navigate('QuickAdd')}>
            <Text style={styles.addButtonText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {entries.length === DEFAULT_LIST_LIMIT && (
        <Text testID="transactions-limit-warning" style={styles.limitWarning}>
          Affichage limité aux {DEFAULT_LIST_LIMIT} transactions les plus récentes — affinez les filtres pour voir le reste.
        </Text>
      )}

      <SectionList
        sections={sections}
        keyExtractor={(e) => `${e.kind}-${e.id}`}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(appliedFilters)} />}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              {filtersActive ? (
                <>
                  <Text style={styles.emptyTitle}>Aucune transaction pour ces filtres.</Text>
                  <Text style={styles.emptyText}>Essayez d'élargir la période ou de retirer un critère.</Text>
                </>
              ) : (
                <>
                  <Text style={styles.emptyTitle}>Aucune transaction pour l'instant.</Text>
                  <Text style={styles.emptyText}>Vos dépenses et revenus confirmés apparaîtront ici.</Text>
                  <TouchableOpacity style={styles.emptyButton} onPress={() => navigation.getParent()?.navigate('QuickAdd')}>
                    <Text style={styles.emptyButtonText}>+ Ajouter une transaction</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const positive = item.amount >= 0;
          const budgetLabel = item.budgetId ? (budgetLabelById[item.budgetId] ?? 'Budget') : null;
          const planLabel = item.financialPlanId ? (planLabelById[item.financialPlanId] ?? 'Plan') : null;
          return (
            <TouchableOpacity
              testID={`transaction-row-${item.kind}-${item.id}`}
              style={styles.row}
              onPress={() => navigation.navigate('TransactionDetail', { kind: item.kind, id: item.id })}
            >
              <View style={styles.rowLeft}>
                <Text style={styles.rowLabel}>{item.label ?? KIND_LABEL[item.displayKind] ?? item.kind}</Text>
                <Text style={styles.rowMeta}>
                  {formatDate(item.occurredAt)} · {item.accountName}
                  {item.categoryName ? ` · ${item.categoryName}` : ''}
                </Text>
                {item.createdByName ? <Text style={styles.rowInitiator}>Ajouté par {item.createdByName}</Text> : null}
                {(budgetLabel || planLabel) && (
                  <View style={styles.attachRow}>
                    {budgetLabel ? <Text style={styles.attachBadge}>{budgetLabel}</Text> : null}
                    {planLabel ? <Text style={styles.attachBadge}>{planLabel}</Text> : null}
                  </View>
                )}
              </View>
              <View style={styles.rowRight}>
                <Text style={[styles.rowAmount, positive ? styles.amountPositive : styles.amountNegative]}>
                  {positive ? '+' : ''}
                  {item.amount.toLocaleString('fr-FR')} DH
                </Text>
                <Text style={styles.rowKind}>{KIND_LABEL[item.displayKind] ?? item.displayKind}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <Modal visible={filtersOpen} transparent animationType="fade" onRequestClose={() => setFiltersOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="transactions-filters-form">
            <Text style={styles.modalTitle}>Filtrer les transactions</Text>

            <View style={styles.dateRow}>
              <View style={styles.dateField}>
                <DateField
                  label="Du"
                  placeholder="Date de début"
                  value={draftFilters.from}
                  onChange={(v) => setDraftFilters((f) => ({ ...f, from: v }))}
                />
              </View>
              <View style={styles.dateField}>
                <DateField
                  label="Au"
                  placeholder="Date de fin"
                  value={draftFilters.to}
                  onChange={(v) => setDraftFilters((f) => ({ ...f, to: v }))}
                />
              </View>
            </View>

            <MultiSelect
              testID="transactions-filter-kind"
              label="Type"
              placeholder="Tous les types"
              value={draftFilters.kinds}
              onChange={(kinds) => setDraftFilters((f) => ({ ...f, kinds }))}
              options={Object.keys(KIND_GROUPS).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            />

            <Select
              testID="transactions-filter-account"
              label="Compte"
              placeholder="Tous les comptes"
              value={draftFilters.accountId}
              onChange={(v) => setDraftFilters((f) => ({ ...f, accountId: v }))}
              options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            />

            <Select
              testID="transactions-filter-category"
              label="Catégorie"
              placeholder="Toutes les catégories"
              value={draftFilters.categoryId}
              onChange={(v) => setDraftFilters((f) => ({ ...f, categoryId: v }))}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />

            <Select
              testID="transactions-filter-budget"
              label="Budget"
              placeholder="Tous les budgets"
              value={draftFilters.budgetId}
              onChange={(v) => setDraftFilters((f) => ({ ...f, budgetId: v }))}
              options={budgets.map((b) => ({ value: b.id, label: b.category.name }))}
            />

            <Select
              testID="transactions-filter-plan"
              label="Plan financier"
              placeholder="Tous les plans"
              value={draftFilters.financialPlanId}
              onChange={(v) => setDraftFilters((f) => ({ ...f, financialPlanId: v }))}
              options={plans.map((p) => ({ value: p.id, label: p.label }))}
            />

            <Select
              testID="transactions-filter-initiator"
              label="Initiateur"
              placeholder="Tout le monde"
              value={draftFilters.createdByUserId}
              onChange={(v) => setDraftFilters((f) => ({ ...f, createdByUserId: v }))}
              options={members.map((m) => ({ value: m.userId, label: m.name }))}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={resetFilters}>
                <Text style={styles.modalButtonSecondaryText}>Réinitialiser</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="transactions-filters-apply" style={styles.modalButton} onPress={applyFilters}>
                <Text style={styles.modalButtonText}>Appliquer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: 56, paddingHorizontal: spacing.xl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  filterButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    marginRight: spacing.sm,
  },
  filterButtonText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  addButton: { backgroundColor: colors.primary, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { color: colors.textOnPrimary, fontSize: 18, fontWeight: '700' },
  limitWarning: { fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm, fontStyle: 'italic' },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  emptyState: { alignItems: 'center', marginTop: 48, paddingHorizontal: spacing.xl },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  emptyText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: 6 },
  emptyButton: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, marginTop: spacing.xl },
  emptyButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  rowLeft: { flexShrink: 1, paddingRight: spacing.sm },
  rowLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  rowMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  rowInitiator: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  attachRow: { flexDirection: 'row', marginTop: spacing.xs },
  attachBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginRight: spacing.xs,
    overflow: 'hidden',
  },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { fontSize: 14, fontWeight: '700' },
  amountPositive: { color: colors.success },
  amountNegative: { color: colors.danger },
  rowKind: { fontSize: 11, color: colors.textSecondary, marginTop: 2, textTransform: 'uppercase' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, width: '100%', maxHeight: '85%' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  dateRow: { flexDirection: 'row', marginBottom: spacing.xs },
  dateField: { flex: 1, marginRight: spacing.sm },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.md },
  modalButton: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 18, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  modalButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  modalButtonSecondary: { paddingHorizontal: 14, paddingVertical: 10, marginRight: 8 },
  modalButtonSecondaryText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
});
