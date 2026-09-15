/**
 * Portail Web v4 (WEB-V4.4A) — extraction MÉCANIQUE (aucun changement de
 * comportement) des types/helpers déjà présents dans AccountDetailScreen.tsx
 * (mobile), partagés avec AccountDetailScreen.web.tsx. Le mapping type→libellé
 * de compte reste dans accountsLogic.ts (déjà partagé, jamais un second
 * libellé qui pourrait diverger).
 */
export interface Account {
  id: string;
  name: string;
  type: string;
  status: 'actif' | 'archive';
  includeInOperationalTreasury: boolean;
  soldeCourant: number;
  reservedByEnvelopes: number;
}

export interface Reconciliation {
  id: string;
  declaredBalance: number | string;
  discrepancy: number | string;
  status: 'pending' | 'resolue';
  createdAt: string;
}

export function n(v: number | string): number {
  return typeof v === 'number' ? v : Number(v);
}
