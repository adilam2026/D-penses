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

export const DEFAULT_LIST_LIMIT = 200;
