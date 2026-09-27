/**
 * Détection du sous-compte "Santé" (maquette : sa ligne ouvre directement
 * l'écran Mutuelle dédié, jamais le Détail sous-compte générique). Aucun
 * champ dédié côté schéma pour le distinguer : convention de nommage
 * partagée par Accueil/Épargne/SubaccountDetailScreen, à remplacer par un
 * champ explicite si un jour plusieurs sous-comptes santé coexistent.
 */
export function isSanteSubaccount(name: string): boolean {
  return name.toLowerCase().includes('sant');
}
