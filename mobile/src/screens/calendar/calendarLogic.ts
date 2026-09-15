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
