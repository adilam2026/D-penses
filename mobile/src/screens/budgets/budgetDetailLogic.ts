import type { MonthMode } from '../../api/client';

/**
 * Portail Web v4 (WEB-V4.4A) — extraction MÉCANIQUE (aucun changement de
 * comportement) des types/libellés/helpers déjà présents dans
 * BudgetDetailScreen.tsx (mobile), partagés avec BudgetDetailScreen.web.tsx.
 */
export interface HistoryEntry {
  id: string;
  amount: number;
  spentDate: string;
  notes: string | null;
}

export interface BudgetConfigValues {
  referenceAmount: number;
  referencePeriod: 'semaine' | 'mois';
}

export interface PeriodNavigation {
  at: string;
  periodStart: string;
  periodEnd: string;
  isCurrentPeriod: boolean;
  previousPeriodAt: string;
  nextPeriodAt: string | null;
}

export interface BudgetAmendmentEntry {
  budgetId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changedAt: string;
  effectiveFrom: string;
}

export interface CategoryTypeRef {
  id: string;
  name: string;
}

export interface BudgetDetail {
  id: string;
  // M3 — libellé libre, primaire à l'affichage (category.name devient
  // secondaire, cf. categoryTypeIds/categoryTypes ci-dessous). Absent des
  // anciennes fixtures/API non encore migrées : toujours lu avec un repli sur
  // category.name côté écran, jamais un plantage sur undefined.
  label?: string;
  categoryId: string;
  category: { name: string };
  // M3 — jeu de CategoryType actuellement suivis (jamais versionné, § état
  // COURANT). Liste vide = toute la catégorie (comportement historique).
  categoryTypeIds?: string[];
  categoryTypes?: CategoryTypeRef[];
  referenceAmount: number;
  referencePeriod: 'semaine' | 'mois';
  weekStartDay: number;
  monthMode: MonthMode;
  customStartDay: number | null;
  includeInPrudentProjection: boolean;
  status: {
    periodStart: string;
    periodEnd: string;
    budgetPeriode: number;
    consommeADate: number;
    budgetContractuelRestant: number;
    rythmeProjete: number;
    previsionRythmeRestant: number;
    projectionPrudenteRestante: number;
    consumptionRatio: number;
    elapsedRatio: number;
    rythmeAlerte: boolean;
    // M3 §8 (dimension B) — règle métier calculée par le moteur backend partagé
    // (common/ledger/variable-budget.util.ts), jamais recalculée ici. Optionnels
    // pour tolérer une fixture/réponse non encore migrée.
    thresholdLevel?: ConsumptionThreshold;
    exceededAmount?: number;
  };
  history: HistoryEntry[];
  periodNavigation: PeriodNavigation;
  initialValues: BudgetConfigValues | null;
  adjustedValues: BudgetConfigValues | null;
}

/**
 * M3 §8 (dimension B — seuils de consommation) : RÈGLE MÉTIER calculée par le
 * moteur backend partagé (common/ledger/variable-budget.util.ts,
 * consumptionThresholdLevel/budgetExceededAmount), jamais recalculée ici — même
 * règle pour mobile et web (« Mobile et Web consomment les mêmes règles
 * métier »). Ce fichier ne porte plus que la TRADUCTION VISUELLE (badge/
 * couleur/texte) de l'état déjà fourni par l'API (status.thresholdLevel/
 * status.exceededAmount), jamais son calcul. Distinct de healthStatus (dimension
 * A, 3 valeurs, 80/100%, consommé par BudgetsScreen.web.tsx/HomeScreen.web.tsx
 * via budgetsLogic.ts) — jamais fusionnés, jamais touché ici.
 */
export type ConsumptionThreshold = 'sous_60' | 'entre_60_75' | 'entre_75_90' | 'entre_90_100' | 'atteint' | 'depasse';

export const THRESHOLD_LABEL: Record<ConsumptionThreshold, string> = {
  sous_60: 'Sous contrôle',
  entre_60_75: '60% atteints',
  entre_75_90: '75% atteints',
  entre_90_100: '90% atteints',
  atteint: 'Budget atteint',
  depasse: 'Budget dépassé',
};

export const THRESHOLD_COLOR: Record<ConsumptionThreshold, string> = {
  sous_60: '#2E7D32',
  entre_60_75: '#F9A825',
  entre_75_90: '#EF6C00',
  entre_90_100: '#D84315',
  atteint: '#C62828',
  depasse: '#C62828',
};

export const PERIOD_OPTIONS = [
  { value: 'semaine', label: 'Semaine' },
  { value: 'mois', label: 'Mois' },
];

export const MONTH_MODE_LABELS: Record<MonthMode, string> = {
  calendaire: 'Calendaire',
  financier: 'Financier',
  personnalise: 'Personnalisé',
};

export const FIELD_LABELS: Record<string, string> = {
  referenceAmount: 'Montant de référence',
  referencePeriod: 'Périodicité',
  categoryId: 'Catégorie',
  categoryTypeId: 'Type de catégorie',
  weekStartDay: 'Jour de début de semaine',
  includeInPrudentProjection: 'Inclus dans la projection prudente',
  endDate: 'Date de fin',
  monthMode: 'Mode du mois',
  customStartDay: 'Jour de départ personnalisé',
};

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' });
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (field === 'referenceAmount') return `${Number(value).toLocaleString('fr-FR')} DH`;
  if (field === 'includeInPrudentProjection') return value ? 'Oui' : 'Non';
  if (field === 'endDate') return formatDate(value as string);
  if (field === 'monthMode') return MONTH_MODE_LABELS[value as MonthMode] ?? String(value);
  return String(value);
}

export function periodEndExclusive(periodEndIso: string): number {
  return new Date(periodEndIso).getTime() + 86400000;
}
