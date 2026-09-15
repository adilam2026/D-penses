import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../ui/theme';

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * Portail Web v4 (WEB-V4.3) — extraction MÉCANIQUE (aucun changement de
 * comportement) des types/libellés/couleurs déjà présents dans
 * CalendarScreen.tsx (mobile), partagés avec CalendarScreen.web.tsx.
 */
export interface CalendarEvent {
  date: string;
  kind: 'revenu_prevu' | 'facture_attendue' | 'echeance' | 'montant_inconnu' | 'echeance_payee' | 'transfert_prevu';
  label: string;
  amount: number | null;
  deadlineId?: string;
  incomeOccurrenceId?: string;
  // M5 — cible du clic « revenu prévu » (IncomeSource, jamais l'occurrence).
  incomeSourceId?: string;
  // M5 — cible du clic « transfert planifié » (RecurringTransfer parent).
  recurringTransferId?: string;
}

export const KIND_LABEL: Record<CalendarEvent['kind'], string> = {
  revenu_prevu: 'Revenu prévu',
  facture_attendue: 'Facture attendue',
  echeance: 'À payer',
  montant_inconnu: 'Montant inconnu',
  echeance_payee: 'Payé',
  transfert_prevu: 'Transfert planifié',
};

// §9 (recette téléphone réel) : jamais la couleur seule pour distinguer un type
// d'événement — un pictogramme différent par kind, la couleur en renfort.
export const KIND_ICON: Record<CalendarEvent['kind'], IconName> = {
  revenu_prevu: 'arrow-down-circle-outline',
  facture_attendue: 'document-text-outline',
  echeance: 'alert-circle-outline',
  montant_inconnu: 'help-circle-outline',
  echeance_payee: 'checkmark-circle',
  transfert_prevu: 'swap-horizontal-outline',
};

export const KIND_COLOR: Record<CalendarEvent['kind'], string> = {
  revenu_prevu: colors.success,
  facture_attendue: colors.warning,
  echeance: colors.primary,
  montant_inconnu: colors.danger,
  echeance_payee: colors.textSecondary,
  transfert_prevu: colors.primary,
};

// Ordre d'affichage de la légende — dérivé des mêmes constantes que les lignes
// (source unique, jamais une liste dupliquée qui pourrait diverger).
export const LEGEND_ORDER: CalendarEvent['kind'][] = ['echeance', 'echeance_payee', 'revenu_prevu', 'transfert_prevu', 'montant_inconnu', 'facture_attendue'];

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
}

// Corrections UI/UX finales §8 — "30 sept." (jamais le jour de semaine), pour
// une ligne compacte dans la liste groupée par mois.
export function formatDayMonth(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

export function monthKey(dateIso: string): string {
  return dateIso.slice(0, 7);
}

export function monthSectionTitle(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
}

/**
 * Corrections UI/UX finales §8 — regroupement par mois, ordre chronologique
 * croissant (le mois le plus proche en premier), jamais un second calcul des
 * événements eux-mêmes (CalendarEvent reste la seule source, dérivée de
 * GET /calendar).
 */
export function groupEventsByMonth(events: CalendarEvent[]): { title: string; data: CalendarEvent[] }[] {
  const byMonth = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const key = monthKey(e.date);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(e);
  }
  return Array.from(byMonth.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, data]) => ({ title: monthSectionTitle(key), data: data.slice().sort((x, y) => (x.date < y.date ? -1 : 1)) }));
}
