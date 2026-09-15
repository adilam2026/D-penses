import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Marge haute unique pour tout écran headerShown:false (onglets + modales) —
 * évite qu'un titre/bouton/champ passe sous la barre système Android (heure,
 * icônes). `extra` ajoute un espacement visuel sous la zone système ; ne
 * jamais coder une valeur en dur écran par écran, toujours passer par ce hook
 * (source unique, miroir de useBottomInset — corrections UI/UX finales §2).
 */
export function useTopInset(extra = 16): number {
  const insets = useSafeAreaInsets();
  return insets.top + extra;
}
