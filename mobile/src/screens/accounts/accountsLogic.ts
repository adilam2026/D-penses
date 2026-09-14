/**
 * Portail Web v4 (WEB-V4.2) — extraction MÉCANIQUE (aucun changement de
 * comportement) du mapping type de compte → libellé, déjà présent dans
 * AccountsScreen.tsx (mobile), partagé avec AccountsScreen.web.tsx : jamais
 * un second libellé qui pourrait diverger.
 */
export type AccountType = 'courant' | 'especes' | 'epargne' | 'autre';

export const TYPE_LABEL: Record<AccountType, string> = {
  courant: 'Banque',
  especes: 'Espèces',
  epargne: 'Épargne',
  autre: 'Autre',
};
