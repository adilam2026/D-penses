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
  // Correction UX (Calendrier — occurrence de revenu) — cible du clic « revenu
  // prévu » : l'OCCURRENCE précise, jamais la source récurrente entière (M5
  // inversé : gérer la source reste réservé à Gestion Revenus).
  incomeOccurrenceId?: string;
  incomeSourceId?: string;
  // M5 — cible du clic « transfert planifié » (RecurringTransfer parent).
  recurringTransferId?: string;
  // Point 5 — vue "Par catégorie / plan financier" : déjà résolus côté backend
  // (GET /calendar), jamais recalculés ici — uniquement pour les événements
  // liés à une Deadline (undefined pour revenu_prevu/transfert_prevu).
  financialPlanId?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
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

// Point 5A — même date : ordre alphabétique du libellé (insensible à la casse/
// accents), jamais l'ordre d'arrivée depuis l'API.
function compareByDateThenLabel(x: CalendarEvent, y: CalendarEvent): number {
  if (x.date !== y.date) return x.date < y.date ? -1 : 1;
  return x.label.localeCompare(y.label, 'fr', { sensitivity: 'base' });
}

/**
 * Corrections UI/UX finales §8, tri affiné point 5A — regroupement par mois,
 * ordre chronologique croissant (le mois le plus proche en premier) ; à date
 * égale, ordre alphabétique du libellé. Jamais un second calcul des
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
    .map(([key, data]) => ({ title: monthSectionTitle(key), data: data.slice().sort(compareByDateThenLabel) }));
}

const REVENU_GROUP_LABEL = 'Revenus';
const TRANSFERT_GROUP_LABEL = 'Transferts planifiés';
const AUTRES_GROUP_LABEL = 'Autres';

/**
 * Point 5B — deuxième représentation des MÊMES échéances (aucune donnée
 * dupliquée/recalculée) : Mois → Catégorie/Plan financier → opérations,
 * plutôt que Mois → Date. Regroupement :
 *  - événement lié à un FinancialPlan (financialPlanId) → sous son libellé
 *    (déjà composé/stocké tel quel côté backend, ex. "Voiture · Opel Astra") ;
 *  - sinon lié à une Category (categoryName) → sous son nom ;
 *  - sinon (revenu/transfert/charge sans catégorie) → groupe générique fixe.
 * Les groupes d'un même mois sont triés alphabétiquement (mêmes règles
 * d'insensibilité que le tri par date), puis les opérations de chaque groupe
 * triées par date puis libellé (même comparateur que la vue "Par date").
 */
export interface CalendarCategoryGroup {
  label: string;
  events: CalendarEvent[];
}

// `financialPlanLabelById` : construit côté écran depuis listFinancialPlans()
// (déjà l'API utilisée par FinancialPlansScreen/ProjectionScreen — jamais un
// second endpoint), pour résoudre financialPlanId → libellé déjà composé
// côté backend au moment de la création du plan (ex. "Voiture · Opel Astra").
function groupLabelOf(e: CalendarEvent, financialPlanLabelById: Map<string, string>): string {
  if (e.kind === 'revenu_prevu') return REVENU_GROUP_LABEL;
  if (e.kind === 'transfert_prevu') return TRANSFERT_GROUP_LABEL;
  if (e.financialPlanId) return financialPlanLabelById.get(e.financialPlanId) ?? AUTRES_GROUP_LABEL;
  return e.categoryName || AUTRES_GROUP_LABEL;
}

export function groupEventsByMonthThenCategory(
  events: CalendarEvent[],
  financialPlanLabelById: Map<string, string>,
): { title: string; groups: CalendarCategoryGroup[] }[] {
  const byMonth = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const key = monthKey(e.date);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(e);
  }
  return Array.from(byMonth.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, monthEvents]) => {
      const byGroup = new Map<string, CalendarEvent[]>();
      for (const e of monthEvents) {
        const label = groupLabelOf(e, financialPlanLabelById);
        if (!byGroup.has(label)) byGroup.set(label, []);
        byGroup.get(label)!.push(e);
      }
      const groups: CalendarCategoryGroup[] = Array.from(byGroup.entries())
        .sort((a, b) => a[0].localeCompare(b[0], 'fr', { sensitivity: 'base' }))
        .map(([label, groupEvents]) => ({ label, events: groupEvents.slice().sort(compareByDateThenLabel) }));
      return { title: monthSectionTitle(key), groups };
    });
}
