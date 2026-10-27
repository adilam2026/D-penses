import type { HouseholdMembershipApi, PlanningCellApi } from '../api/client';
import { colors } from './theme';

/**
 * Couleur d'identification par membre du foyer (Planning) — attribuée par
 * ordre d'arrivée dans le foyer (joinedAt), jamais d'après un prénom ou un
 * libellé : 1er membre = bleu, 2e = rose ; au-delà, aucune couleur dédiée.
 */
const MEMBER_PALETTE = [colors.memberBlue, colors.memberPink];

export function memberColorMap(members: HouseholdMembershipApi[]): Map<string, string> {
  const ordered = members
    .map((m, idx) => ({ m, idx }))
    .sort((a, b) => (a.m.joinedAt ?? '').localeCompare(b.m.joinedAt ?? '') || a.idx - b.idx)
    .map(({ m }) => m);
  return new Map(ordered.slice(0, MEMBER_PALETTE.length).map((m, i) => [m.id, MEMBER_PALETTE[i]]));
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
