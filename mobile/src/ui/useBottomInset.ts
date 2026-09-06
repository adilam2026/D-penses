import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Marge basse unique pour tout contenu ancré en bas d'écran (formulaire de
 * création, barre d'action) — évite qu'il passe sous la barre système Android
 * (gestes ou 3 boutons). `extra` ajoute un espacement visuel au-dessus de la
 * zone système ; ne jamais coder une valeur en dur écran par écran, toujours
 * passer par ce hook (source unique, cf. audit Lot 9bis §UX).
 */
export function useBottomInset(extra = 16): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + extra;
}
