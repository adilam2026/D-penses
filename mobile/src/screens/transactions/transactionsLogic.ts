import * as api from '../../api/client';

/**
 * Portail Web v4 §1 — extraction MÉCANIQUE (aucun changement de comportement)
 * des types/constantes/fonctions pures de TransactionsScreen.tsx (mobile),
 * pour être réutilisés à l'identique par TransactionsScreen.web.tsx : mêmes
 * filtres, même regroupement mensuel, jamais une seconde règle parallèle qui
 * pourrait diverger (ex. mapping kind→libellé, conversion de dates).
 */

export interface LedgerEntry {
  kind: string;
  displayKind: string;
  id: string;
  occurredAt: string;
  amount: number;
  accountName: string;
  label: string | null;
  // Point 3 — déjà renvoyé par le backend (transactions.service.ts), utilisé
  // désormais comme repli de regroupement (Plan → Catégorie → "Autres").
  categoryId: string | null;
  categoryName: string | null;
  categoryTypeName: string | null;
  categorySubtypeName: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  budgetId: string | null;
  financialPlanId: string | null;
}

export const KIND_LABEL: Record<string, string> = {
  revenu: 'Revenu',
  paiement: 'Paiement',
  depense: 'Dépense',
  transfert: 'Transfert',
  ajustement: 'Ajustement',
};

export const KIND_GROUPS: Record<string, string[]> = {
  revenu: ['income'],
  paiement: ['payment'],
  depense: ['budget_expense', 'adhoc_expense'],
  transfert: ['transfer_in', 'transfer_out'],
  ajustement: ['adjustment'],
};

export interface Filters {
  from: string;
  to: string;
  kinds: string[];
  accountId: string | null;
  categoryId: string | null;
  budgetId: string | null;
  financialPlanId: string | null;
  createdByUserId: string | null;
}

export const EMPTY_FILTERS: Filters = {
  from: '',
  to: '',
  kinds: [],
  accountId: null,
  categoryId: null,
  budgetId: null,
  financialPlanId: null,
  createdByUserId: null,
};

export function hasActiveFilters(f: Filters): boolean {
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

export function kindsToCsv(kinds: string[]): string | undefined {
  if (kinds.length === 0) return undefined;
  const raw = kinds.flatMap((k) => KIND_GROUPS[k] ?? []);
  return raw.length ? raw.join(',') : undefined;
}

export function toApiFilters(f: Filters): api.TransactionFilters {
  return {
    from: f.from ? new Date(f.from).toISOString() : undefined,
    to: f.to ? new Date(new Date(f.to).getTime() + 86400000).toISOString() : undefined,
    kind: kindsToCsv(f.kinds),
    accountId: f.accountId ?? undefined,
    categoryId: f.categoryId ?? undefined,
    budgetId: f.budgetId ?? undefined,
    financialPlanId: f.financialPlanId ?? undefined,
    createdByUserId: f.createdByUserId ?? undefined,
    // Correction UX (Transactions) — un écart de rapprochement de solde n'est
    // jamais une opération saisie par l'utilisateur : jamais affiché ici,
    // toujours actif (pas un filtre optionnel côté écran).
    excludeReconciliation: true,
  };
}

// M6 — couleur d'identification de l'initiateur (bande/fond des lignes Transactions,
// pastilles du filtre). User.color prime quand renseigné ; sinon repli déterministe
// (même userId → toujours la même couleur, jamais un plantage sur color=null/undefined,
// jamais une régression pour les comptes créés avant ce lot).
const FALLBACK_COLOR_PALETTE = ['#5B8DEF', '#E5896D', '#57B894', '#C77DD4', '#D9A441', '#4FB5C2', '#E06B8B', '#8B95A6'];

export function initiatorColor(userId: string | null | undefined, explicitColor?: string | null): string {
  if (explicitColor) return explicitColor;
  if (!userId) return FALLBACK_COLOR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return FALLBACK_COLOR_PALETTE[hash % FALLBACK_COLOR_PALETTE.length];
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Refonte liste Transactions Web — format court ("28 sept.") pour la colonne
// Date d'une liste dense, jamais recalculé différemment ailleurs.
export function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// Refonte liste Transactions Web — libellé de statut, dérivé UNIQUEMENT du
// displayKind déjà renvoyé par le backend (DISPLAY_KIND, transactions.service.ts) :
// aucune donnée ni règle métier nouvelle, un pur habillage d'affichage. Clés
// alignées sur les valeurs réelles de displayKind (avec l'accent sur "dépense").
export const STATUS_LABEL: Record<string, string> = {
  paiement: 'Payée',
  dépense: 'Payée',
  revenu: 'Reçu',
  transfert: 'Versé',
  ajustement: 'Ajusté',
};

export function monthKey(occurredAtIso: string): string {
  return occurredAtIso.slice(0, 7);
}

export function monthSectionTitle(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function groupByMonth(entries: LedgerEntry[]): { title: string; data: LedgerEntry[] }[] {
  const byMonth = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    const key = monthKey(e.occurredAt);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(e);
  }
  return Array.from(byMonth.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, data]) => ({ title: monthSectionTitle(key), data }));
}

// Corrections consolidées §13 — tri principal inchangé (plus récent d'abord),
// départage explicite pour les entrées du MÊME jour (jamais un ordre implicite
// d'insertion/id) : alphabétique par libellé, jamais par kind/montant.
export function sortLedgerEntries(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => {
    const dayA = a.occurredAt.slice(0, 10);
    const dayB = b.occurredAt.slice(0, 10);
    if (dayA !== dayB) return dayA < dayB ? 1 : -1;
    return (a.label ?? '').localeCompare(b.label ?? '', 'fr-FR', { sensitivity: 'base' });
  });
}

// Corrections consolidées §12 — ligne spéciale (jamais une vraie transaction)
// marquant le début d'un sous-groupe par plan financier au sein d'un mois.
export interface PlanHeaderRow {
  kind: '__plan_header__';
  key: string;
  label: string;
}

export type TransactionListRow = PlanHeaderRow | LedgerEntry;

export function isPlanHeaderRow(row: TransactionListRow): row is PlanHeaderRow {
  return row.kind === '__plan_header__';
}

// Point 3 (révision) — niveau 2 du regroupement : plan financier si présent,
// SINON catégorie, SINON "Autres" (jamais un bucket "Autres" prématuré qui
// ignorerait la catégorie disponible). Clé stable (id), jamais le libellé
// affiché (deux catégories pourraient en théorie partager un nom).
const NONE_GROUP = '__none__';
function groupKeyOf(e: LedgerEntry): string {
  if (e.financialPlanId) return `plan:${e.financialPlanId}`;
  if (e.categoryId) return `cat:${e.categoryId}`;
  return NONE_GROUP;
}
function groupLabelOf(e: LedgerEntry, planLabelById: Record<string, string>): string {
  if (e.financialPlanId) return planLabelById[e.financialPlanId] ?? 'Plan';
  if (e.categoryId) return e.categoryName ?? 'Catégorie';
  return 'Autres';
}

/**
 * Corrections consolidées §12, révision point 3 — regroupement par mois
 * (comme groupByMonth), PUIS par plan financier si présent, SINON catégorie,
 * SINON "Autres" (toujours en dernier) — jamais une seconde règle de tri
 * parallèle (réutilise sortLedgerEntries, §13, pour l'ordre intra-groupe :
 * date décroissante, égalité tranchée par libellé alphabétique). Chaque
 * transaction apparaît dans EXACTEMENT un sous-groupe, jamais deux (partition
 * stricte par groupKeyOf). Un composant SectionList reste à PLAT : les
 * en-têtes de groupe sont des lignes spéciales injectées dans `data`, jamais
 * une liste imbriquée.
 */
export function groupByMonthAndPlan(entries: LedgerEntry[], planLabelById: Record<string, string>): { title: string; data: TransactionListRow[] }[] {
  const sorted = sortLedgerEntries(entries);
  const byMonth = new Map<string, LedgerEntry[]>();
  for (const e of sorted) {
    const key = monthKey(e.occurredAt);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(e);
  }
  return Array.from(byMonth.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([monthKeyValue, monthEntries]) => {
      const byGroup = new Map<string, LedgerEntry[]>();
      for (const e of monthEntries) {
        const key = groupKeyOf(e);
        if (!byGroup.has(key)) byGroup.set(key, []);
        byGroup.get(key)!.push(e);
      }
      const groupKeys = Array.from(byGroup.keys()).filter((k) => k !== NONE_GROUP);
      const orderedKeys = byGroup.has(NONE_GROUP) ? [...groupKeys, NONE_GROUP] : groupKeys;
      const data: TransactionListRow[] = [];
      for (const key of orderedKeys) {
        const groupEntries = byGroup.get(key)!;
        const label = key === NONE_GROUP ? 'Autres' : groupLabelOf(groupEntries[0], planLabelById);
        data.push({ kind: '__plan_header__', key: `${monthKeyValue}-${key}`, label });
        data.push(...groupEntries);
      }
      return { title: monthSectionTitle(monthKeyValue), data };
    });
}

// Refonte liste Transactions Web — regroupement visuel par jour exact
// (Aujourd'hui / Hier / date précise), en plus de groupByMonth (toujours
// utilisé tel quel par TransactionsScreen.tsx natif, non modifié ici) : même
// tri (sortLedgerEntries, §13), jamais un second ordre parallèle.
export function daySectionTitle(occurredAtIso: string): string {
  const day = occurredAtIso.slice(0, 10);
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const yesterdayKey = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  if (day === todayKey) return "Aujourd'hui";
  if (day === yesterdayKey) return 'Hier';
  return new Date(occurredAtIso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function groupByDay(entries: LedgerEntry[]): { title: string; data: LedgerEntry[] }[] {
  const sorted = sortLedgerEntries(entries);
  const byDay = new Map<string, LedgerEntry[]>();
  for (const e of sorted) {
    const key = e.occurredAt.slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(e);
  }
  return Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([, data]) => ({ title: daySectionTitle(data[0].occurredAt), data }));
}

export const DEFAULT_LIST_LIMIT = 200;
