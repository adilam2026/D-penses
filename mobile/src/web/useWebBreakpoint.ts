import { Platform, useWindowDimensions } from 'react-native';

export type WebBreakpoint = 'narrow' | 'laptop' | 'desktop';

const LAPTOP_MIN = 900;
const DESKTOP_MIN = 1200;

function breakpointFor(width: number): WebBreakpoint {
  if (width >= DESKTOP_MIN) return 'desktop';
  if (width >= LAPTOP_MIN) return 'laptop';
  return 'narrow';
}

/**
 * Architecture Web v3 — seuils Web UNIQUEMENT (jamais déclenché sur tablette
 * native : `isWeb` est faux sur iOS/Android quelle que soit la largeur, donc
 * aucun écran natif ne peut recevoir cette mise en page desktop). Seule source
 * de seuils pour le shell Web (AppShell/Sidebar/Header) ET les futurs écrans
 * *.web.tsx — jamais un seuil recalculé/dupliqué ailleurs.
 */
export function useWebBreakpoint(): { isWeb: boolean; width: number; breakpoint: WebBreakpoint } {
  const isWeb = Platform.OS === 'web';
  // useWindowDimensions() est déjà réactif au resize (web) — jamais un second
  // listener/état dupliqué ici.
  const { width } = useWindowDimensions();
  return { isWeb, width, breakpoint: isWeb ? breakpointFor(width) : 'narrow' };
}
