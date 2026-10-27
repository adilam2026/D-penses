import type { HouseholdMembershipApi, PlanningCellApi } from '../api/client';
import { personColor } from './personPalette';

/**
 * memberId -> couleur de la personne (User.color), choisie dans « Membres ».
 * Jamais déduite d'un prénom, d'un libellé ni de l'ordre des membres : une
 * personne sans couleur n'apparaît pas dans la table (affichage neutre).
 */
export function memberColorMap(members: HouseholdMembershipApi[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of members) {
    const color = personColor(m.user.color);
    if (color) map.set(m.id, color);
  }
  return map;
}

/**
 * Responsable UNIQUE d'une case, lu sur le responsibleMemberId réel des
 * opérations qui la composent. null si la case est vide, si une opération
 * n'a pas de responsable (dont toute opération réelle non planifiée) ou si
 * plusieurs responsables s'y mêlent.
 */
export function cellResponsibleMemberId(cell: PlanningCellApi): string | null {
  if (cell.items.length === 0) return null;
  const ids = new Set(cell.items.map((i) => (i.type === 'REAL_UNPLANNED' ? null : (i.responsibleMemberId ?? null))));
  if (ids.size !== 1) return null;
  return [...ids][0];
}
