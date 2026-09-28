/**
 * Libellés explicites d'action sur une transaction (Lot recette §3/§4) —
 * jamais un simple "Annuler" (confondu avec "annuler la saisie en cours").
 * Source unique, réutilisée partout où une transaction s'ouvre (historique,
 * Planning, Prochaines transactions) pour garantir un vocabulaire identique.
 */
export const TRANSACTION_ACTION_LABELS = {
  modify: 'Modifier la transaction',
  cancel: 'Annuler la transaction',
  close: 'Fermer',
} as const;
