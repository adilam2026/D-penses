import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import * as api from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { WEB_SIDEBAR_PRIMARY } from '../navigation/menuSections';
import { webColors, webSpacing } from './webTheme';

interface Props {
  navigationRef: NavigationContainerRefWithCurrent<any>;
  currentRouteName: string | undefined;
  onToggleSidebar?: () => void;
}

// Titre de page = libellé déjà validé dans la Sidebar (source unique, jamais un
// second jeu de libellés) ; "HamburgerMenu" reste l'unique exception (accessible
// via "Plus", pas dans la nav primaire).
const EXTRA_TITLES: Record<string, string> = { HamburgerMenu: 'Menu' };

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
        <Text style={styles.title}>{titleForRoute(currentRouteName)}</Text>
      </View>

      <View style={styles.right}>
        {householdName && <Text style={styles.household}>{householdName}</Text>}
        <TouchableOpacity
          testID="web-header-settings"
          style={styles.iconButton}
          onPress={() => navigationRef.navigate('HouseholdConfig' as never)}
        >
          <Ionicons name="settings-outline" size={18} color={webColors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity testID="web-header-logout" style={styles.logoutButton} onPress={signOut}>
          <Ionicons name="log-out-outline" size={16} color={webColors.textOnPrimary} />
          <Text style={styles.logoutText}>Déconnexion</Text>
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
  left: { flexDirection: 'row', alignItems: 'center' },
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
  logoutText: { color: webColors.textOnPrimary, fontSize: 12, fontWeight: '600', marginLeft: 6 },
});
