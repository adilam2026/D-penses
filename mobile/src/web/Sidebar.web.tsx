import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { WEB_SIDEBAR_PRIMARY } from '../navigation/menuSections';
import { webColors, webRadius, webSpacing } from './webTheme';

interface Props {
  navigationRef: NavigationContainerRefWithCurrent<any>;
  currentRouteName: string | undefined;
  width: number;
  onNavigate?: () => void;
}

/**
 * Architecture Web v3 §3/§13 — navigation primaire du shell desktop. Remplace
 * la bottom bar sur Web (jamais montée en parallèle, cf. RootTabs.web.tsx).
 * Routes UNIQUEMENT depuis WEB_SIDEBAR_PRIMARY (menuSections.ts, source
 * partagée) — aucun nom de route dupliqué en dur ici. `navigationRef` est
 * requis (pas useNavigation()) car ce composant vit hors de l'arbre des
 * Screen, monté au-dessus de tout le RootNavigator.
 */
export function Sidebar({ navigationRef, currentRouteName, width, onNavigate }: Props) {
  function go(route: string, parent?: 'Tabs') {
    if (parent) {
      navigationRef.navigate(parent, { screen: route });
    } else {
      navigationRef.navigate(route as never);
    }
    onNavigate?.();
  }

  return (
    <View style={[styles.container, { width }]}>
      <View style={styles.brandRow}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>D+</Text>
        </View>
        <Text style={styles.brandText}>D-Penses+</Text>
      </View>

      <ScrollView contentContainerStyle={styles.navList} showsVerticalScrollIndicator={false}>
        {WEB_SIDEBAR_PRIMARY.map((item) => {
          const active = currentRouteName === item.route;
          return (
            <TouchableOpacity
              key={item.route}
              testID={`web-sidebar-${item.route}`}
              style={[styles.navItem, active && styles.navItemActive]}
              onPress={() => go(item.route, item.parent)}
            >
              <Ionicons name={item.icon} size={18} color={active ? webColors.textOnPrimary : webColors.sidebarTextMuted} style={styles.navIcon} />
              <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <TouchableOpacity testID="web-sidebar-more" style={styles.moreRow} onPress={() => go('HamburgerMenu')}>
        <Ionicons name="apps-outline" size={18} color={webColors.sidebarTextMuted} style={styles.navIcon} />
        <Text style={styles.moreLabel}>Plus</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: '100%',
    backgroundColor: webColors.sidebarBg,
    paddingVertical: webSpacing.xl,
    paddingHorizontal: webSpacing.md,
    flexShrink: 0,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: webSpacing.sm, marginBottom: webSpacing.xxl },
  brandMark: {
    width: 32,
    height: 32,
    borderRadius: webRadius.md,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: webSpacing.sm,
  },
  brandMarkText: { color: webColors.textOnPrimary, fontSize: 13, fontWeight: '800' },
  brandText: { color: webColors.textOnPrimary, fontSize: 15, fontWeight: '700' },

  navList: { paddingBottom: webSpacing.lg },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: webSpacing.sm,
    borderRadius: webRadius.md,
    marginBottom: 2,
  },
  navItemActive: { backgroundColor: 'rgba(255,255,255,0.14)' },
  navIcon: { marginRight: webSpacing.md, width: 18 },
  navLabel: { fontSize: 13, fontWeight: '600', color: webColors.sidebarTextMuted },
  navLabelActive: { color: webColors.textOnPrimary },

  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: webSpacing.sm,
    borderRadius: webRadius.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
    marginTop: webSpacing.sm,
    paddingTop: webSpacing.md,
  },
  moreLabel: { fontSize: 13, fontWeight: '600', color: webColors.sidebarTextMuted },
});
