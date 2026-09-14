import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { Sidebar } from './Sidebar.web';
import { Header } from './Header.web';
import { useWebBreakpoint } from './useWebBreakpoint';
import { useAuth } from '../auth/AuthContext';
import { webColors } from './webTheme';

interface Props {
  children: React.ReactNode;
  navigationRef: NavigationContainerRefWithCurrent<any>;
  currentRouteName: string | undefined;
}

const SIDEBAR_WIDTH_DESKTOP = 232;
const SIDEBAR_WIDTH_LAPTOP = 208;

/**
 * Architecture Web v3 §2/§3 — coquille desktop réelle : sidebar fixe + header +
 * zone de contenu. Seul le contenu ({children} = RootNavigator, donc l'écran
 * actif) porte un scroll (son propre <ScrollView>, comme sur mobile) : cette
 * zone reste une simple View bornée en hauteur (flex:1), jamais un second
 * <ScrollView> ici — un seul propriétaire de scroll par écran (garde-fou
 * validé). `narrow` (<900px) : sidebar remplacée par un tiroir superposé,
 * ouvert via le bouton ☰ du Header — jamais monté en permanence sous ce seuil.
 */
export function AppShell({ children, navigationRef, currentRouteName }: Props) {
  const { status } = useAuth();
  const { breakpoint } = useWebBreakpoint();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // La coquille desktop (Sidebar/Header) n'a de sens que sur l'application
  // authentifiée : les routes qu'elle propose (Comptes, Budgets...) n'existent
  // même pas dans le Stack.Navigator "signedOut"/"needsHousehold" (RootNavigator).
  // Avant/pendant l'authentification, passthrough strict — comme sur natif.
  if (status !== 'signedIn') {
    return <>{children}</>;
  }

  const permanentSidebar = breakpoint !== 'narrow';
  const sidebarWidth = breakpoint === 'desktop' ? SIDEBAR_WIDTH_DESKTOP : SIDEBAR_WIDTH_LAPTOP;

  return (
    <View style={styles.root}>
      {permanentSidebar && (
        <Sidebar navigationRef={navigationRef} currentRouteName={currentRouteName} width={sidebarWidth} />
      )}

      <View style={styles.mainColumn}>
        <Header
          navigationRef={navigationRef}
          currentRouteName={currentRouteName}
          onToggleSidebar={!permanentSidebar ? () => setDrawerOpen((v) => !v) : undefined}
        />
        <View style={styles.content}>{children}</View>
      </View>

      {!permanentSidebar && drawerOpen && (
        <View style={styles.drawerOverlay}>
          <TouchableOpacity style={styles.drawerBackdrop} onPress={() => setDrawerOpen(false)} />
          <Sidebar
            navigationRef={navigationRef}
            currentRouteName={currentRouteName}
            width={SIDEBAR_WIDTH_LAPTOP}
            onNavigate={() => setDrawerOpen(false)}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', height: '100%', backgroundColor: webColors.background },
  mainColumn: { flex: 1, flexDirection: 'column', minWidth: 0 },
  content: { flex: 1, minHeight: 0 },
  drawerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', zIndex: 20 },
  drawerBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,26,41,0.45)' },
});
