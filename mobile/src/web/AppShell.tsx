import React from 'react';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';

interface Props {
  children: React.ReactNode;
  navigationRef: NavigationContainerRefWithCurrent<any>;
  currentRouteName: string | undefined;
}

/**
 * Architecture Web v3 §2 — AppShell natif : passthrough STRICT, aucun wrapper
 * supplémentaire. Le shell desktop (sidebar/header) n'existe que dans
 * AppShell.web.tsx, jamais chargé sur mobile (résolution Metro par extension
 * de plateforme, même mécanisme que DateField.web.tsx).
 */
export function AppShell({ children }: Props) {
  return <>{children}</>;
}
