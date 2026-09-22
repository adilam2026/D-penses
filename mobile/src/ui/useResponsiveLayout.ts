import { useWindowDimensions } from 'react-native';

/**
 * Refonte maquette V6B §17 — seuils responsive uniques pour mobile/tablette/
 * web, natif ET web (contrairement à useWebBreakpoint, web-only, réservé au
 * shell desktop existant). Seule source de vérité pour le nombre de colonnes
 * d'une grille de cartes (comptes/enveloppes) : jamais un seuil dupliqué par
 * écran.
 */
export type DeviceClass = 'mobile' | 'tablet' | 'desktop';
export type Orientation = 'portrait' | 'landscape';

const TABLET_MIN = 640;
const DESKTOP_MIN = 1024;

export interface ResponsiveLayout {
  width: number;
  height: number;
  orientation: Orientation;
  deviceClass: DeviceClass;
  /** Nombre de colonnes recommandé pour une grille de cartes (comptes/enveloppes). */
  columns: number;
  /** Largeur maximale du contenu sur web desktop (§17E) — jamais étiré sur tout l'écran. */
  maxContentWidth: number;
}

export function useResponsiveLayout(): ResponsiveLayout {
  const { width, height } = useWindowDimensions();
  const orientation: Orientation = width >= height ? 'landscape' : 'portrait';
  const deviceClass: DeviceClass = width >= DESKTOP_MIN ? 'desktop' : width >= TABLET_MIN ? 'tablet' : 'mobile';

  let columns = 1;
  if (deviceClass === 'desktop') columns = 3;
  else if (deviceClass === 'tablet') columns = 2;
  else if (orientation === 'landscape') columns = 2;

  return { width, height, orientation, deviceClass, columns, maxContentWidth: 1300 };
}
