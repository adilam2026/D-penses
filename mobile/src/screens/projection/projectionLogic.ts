import type { MonthlyLineItem } from '../../api/client';

/**
 * Portail Web v4 (WEB-V4.3) — extraction MÉCANIQUE (aucun changement de
 * comportement) des libellés/formats déjà présents dans ProjectionScreen.tsx
 * (mobile), partagés avec ProjectionScreen.web.tsx.
 */
export const CATEGORY_LABEL: Record<NonNullable<MonthlyLineItem['category']>, string> = {
  obligatoire: 'Obligatoire',
  flexible: 'Flexible',
  projet: 'Projet',
};

export function formatDh(n: number): string {
  return `${n.toLocaleString('fr-FR')} DH`;
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}
