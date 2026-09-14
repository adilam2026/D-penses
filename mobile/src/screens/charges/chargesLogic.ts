/**
 * Portail Web v4 (WEB-V4.3) — extraction MÉCANIQUE (aucun changement de
 * comportement) des types/libellés/helpers déjà présents dans
 * ChargesScreen.tsx (mobile), partagés avec ChargesScreen.web.tsx.
 */
export interface NextDeadline {
  id: string;
  dueDate: string;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  resteAPayer: number | string | null | undefined;
  financialStatus?: 'ouverte' | 'partiellement_payee' | 'soldee' | 'annulee';
}

export interface ChargePlan {
  id: string;
  label: string;
  recurrenceRule: string | null;
  status: 'actif' | 'inactif';
  deadlines: NextDeadline[];
}

export const STATUS_LABEL: Record<string, string> = { inconnu: 'Inconnu', estime: 'Estimé', confirme: 'Confirmé' };

// R6.2 (§2, correctif NaN DH) : v peut être null (montant inconnu, cas normal)
// OU undefined (champ absent de la réponse) — jamais rendu tel quel.
export function n(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const parsed = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}
