import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface QuickActionsState {
  visible: boolean;
  open: () => void;
  close: () => void;
}

const QuickActionsContext = createContext<QuickActionsState | null>(null);

/**
 * Vague 3 §3 — état d'ouverture de la bottom sheet du bouton "+" central,
 * partagé entre RootTabs (qui intercepte l'appui sur l'onglet central) et
 * QuickActionsSheet (rendue une seule fois, hors de la tab bar, pour pouvoir
 * recouvrir tout l'écran).
 */
export function QuickActionsProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const value = useMemo(() => ({ visible, open, close }), [visible, open, close]);
  return <QuickActionsContext.Provider value={value}>{children}</QuickActionsContext.Provider>;
}

export function useQuickActions(): QuickActionsState {
  const ctx = useContext(QuickActionsContext);
  if (!ctx) throw new Error('useQuickActions() appelé hors de QuickActionsProvider');
  return ctx;
}
