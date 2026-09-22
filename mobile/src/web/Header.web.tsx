import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import * as api from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { WEB_SIDEBAR_PRIMARY } from '../navigation/menuSections';
import { useWebBreakpoint } from './useWebBreakpoint';
import { webColors, webSpacing } from './webTheme';

interface Props {
  navigationRef: NavigationContainerRefWithCurrent<any>;
  currentRouteName: string | undefined;
  onToggleSidebar?: () => void;
}

// Titre de page = libellé déjà validé dans la Sidebar (source unique, jamais un
// second jeu de libellés) ; "HamburgerMenu" reste l'unique exception (accessible
// via "Plus", pas dans la nav primaire).
const EXTRA_TITLES: Record<string, string> = {
  HamburgerMenu: 'Menu',
  AccountDetail: 'Compte',
  TransactionDetail: 'Transaction',
  BudgetDetail: 'Budget',
  FinancialPlanDetail: 'Plan financier',
  ChargePlanDetail: 'Charge récurrente',
  DeadlineDetail: 'Échéance',
  EnvelopeDetail: 'Enveloppe',
  MedicalClaims: 'Mutuelle',
  PocketDetail: 'Épargne',
};

function titleForRoute(routeName: string | undefined): string {
  if (!routeName) return 'D-Penses+';
  const primary = WEB_SIDEBAR_PRIMARY.find((i) => i.route === routeName);
  return primary?.label ?? EXTRA_TITLES[routeName] ?? routeName;
}

/**
 * Architecture Web v3 §3 (Header) — titre de page + contexte foyer + accès
 * utilisateur (paramètres/déconnexion), uniquement à partir de données déjà
 * disponibles (GET /households/me, déjà utilisé par HomeScreen) : jamais un
 * second appel métier inventé.
 */
export function Header({ navigationRef, currentRouteName, onToggleSidebar }: Props) {
  const { signOut } = useAuth();
  const { breakpoint } = useWebBreakpoint();
  const narrow = breakpoint === 'narrow';
  const [householdName, setHouseholdName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getMyHousehold().then((h: any) => {
      if (!cancelled) setHouseholdName(h?.name ?? null);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.left}>
        {onToggleSidebar && (
          <TouchableOpacity testID="web-header-toggle-sidebar" style={styles.iconButton} onPress={onToggleSidebar}>
            <Ionicons name="menu-outline" size={22} color={webColors.textPrimary} />
          </TouchableOpacity>
        )}
        <Text style={styles.title} numberOfLines={1}>
          {titleForRoute(currentRouteName)}
        </Text>
      </View>

      <View style={styles.right}>
        {householdName && !narrow && <Text style={styles.household}>{householdName}</Text>}
        <TouchableOpacity
          testID="web-header-settings"
          style={styles.iconButton}
          onPress={() => navigationRef.navigate('HouseholdConfig' as never)}
        >
          <Ionicons name="settings-outline" size={18} color={webColors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          testID="web-header-logout"
          style={[styles.logoutButton, narrow && styles.logoutButtonNarrow]}
          onPress={signOut}
        >
          <Ionicons name="log-out-outline" size={16} color={webColors.textOnPrimary} />
          {!narrow && <Text style={styles.logoutText}>Déconnexion</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: webSpacing.xl,
    backgroundColor: webColors.surface,
    borderBottomWidth: 1,
    borderBottomColor: webColors.border,
    flexShrink: 0,
  },
  left: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0 },
  title: { fontSize: 17, fontWeight: '700', color: webColors.textPrimary },
  right: { flexDirection: 'row', alignItems: 'center', gap: webSpacing.md },
  household: { fontSize: 12, fontWeight: '600', color: webColors.textSecondary, marginRight: webSpacing.xs },
  iconButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginRight: webSpacing.xs },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: webColors.primary,
    borderRadius: 999,
    paddingHorizontal: webSpacing.md,
    paddingVertical: 8,
  },
  logoutButtonNarrow: { paddingHorizontal: 8 },
  logoutText: { color: webColors.textOnPrimary, fontSize: 12, fontWeight: '600', marginLeft: 6 },
});
