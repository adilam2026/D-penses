import type { Ionicons } from '@expo/vector-icons';
import type { PlannedOperationKind } from '../api/client';
import { colors } from './theme';

type IconName = keyof typeof Ionicons.glyphMap;

/** Indicateur visuel par type (Prochaines transactions §9) — partagé Accueil/liste complète. */
export const PLANNED_OPERATION_KIND_VISUALS: Record<PlannedOperationKind, { icon: IconName; color: string; background: string }> = {
  EXPENSE: { icon: 'arrow-down-circle', color: colors.danger, background: colors.dangerLight },
  INCOME: { icon: 'arrow-up-circle', color: colors.success, background: colors.successLight },
  SAVINGS_CONTRIBUTION: { icon: 'leaf', color: colors.primary, background: colors.surfaceActive },
};
