import { useCallback, useRef } from 'react';
import { findNodeHandle, FocusEvent, Platform, ScrollView, UIManager } from 'react-native';

/**
 * Correctif réel post-Vague 3 (§1) — le clavier recouvrait la zone active sur
 * Android réel malgré KeyboardAvoidingView (sa présence ne prouve rien : sur
 * Android, `behavior=undefined` ne fait STRICTEMENT rien ; seul
 * `android:windowSoftInputMode="adjustResize"` — déjà la valeur par défaut
 * d'Expo quand `android.softwareKeyboardLayoutMode` n'est pas configuré,
 * vérifié dans @expo/config-plugins/WindowSoftInputMode.js — redimensionne la
 * fenêtre visible ; il ne fait JAMAIS défiler automatiquement un ScrollView
 * jusqu'au champ actif). Ce hook fait le travail réel restant : au focus d'un
 * TextInput, mesurer sa position dans le ScrollView et y faire défiler
 * explicitement — un seul mécanisme partagé, câblé sur chaque `onFocus`
 * (`handleFocus`) de chaque écran de saisie identifié, jamais une
 * ré-implémentation par écran.
 */
export function useKeyboardAwareScroll() {
  const scrollRef = useRef<ScrollView>(null);

  const handleFocus = useCallback((e: FocusEvent) => {
    const scrollNode = findNodeHandle(scrollRef.current);
    const inputNode = findNodeHandle(e.target as unknown as number | null);
    if (!scrollNode || !inputNode) return;

    // Délai : laisse l'animation d'apparition du clavier (et le redimensionnement
    // adjustResize sur Android) se produire AVANT de mesurer — mesurer trop tôt
    // donnerait une position calculée sur l'ancienne hauteur de fenêtre, donc un
    // défilement insuffisant (exactement le bug constaté).
    const delay = Platform.OS === 'android' ? 150 : 50;
    setTimeout(() => {
      UIManager.measureLayout(
        inputNode,
        scrollNode,
        () => {
          // Mesure impossible (nœud démonté entre-temps) — ne jamais planter l'écran pour un confort visuel.
        },
        (_x: number, y: number) => {
          // Marge de 16px au-dessus du champ : il ne colle jamais au tout bord haut visible.
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
        },
      );
    }, delay);
  }, []);

  return { scrollRef, handleFocus };
}
