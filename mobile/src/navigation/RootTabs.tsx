import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { HomeScreen } from '../screens/HomeScreen';
import { TransactionsScreen } from '../screens/transactions/TransactionsScreen';
import { BudgetsScreen } from '../screens/budgets/BudgetsScreen';
import { HamburgerMenuScreen } from '../screens/HamburgerMenuScreen';
import { useQuickActions } from '../state/QuickActionsContext';

const Tab = createBottomTabNavigator();

type IconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  Accueil: { active: 'home', inactive: 'home-outline' },
  Transactions: { active: 'swap-horizontal', inactive: 'swap-horizontal-outline' },
  Budgets: { active: 'pie-chart', inactive: 'pie-chart-outline' },
  Plus: { active: 'menu', inactive: 'menu-outline' },
};

// Jamais rendu : `tabBarButton` remplace entièrement le bouton par défaut de cet
// onglet (CentralPlusButton, ci-dessous), qui ouvre la bottom sheet directement —
// jamais une navigation réelle vers un écran "QuickActions" (§3).
function QuickActionsPlaceholder() {
  return null;
}

// Déclaré au niveau module (jamais à l'intérieur de RootTabs) — même règle que
// partout ailleurs dans l'app depuis la correction du bug de remount (Vague 1).
function CentralPlusButton() {
  const { open } = useQuickActions();
  return (
    <View style={styles.centralWrapper} pointerEvents="box-none">
      <TouchableOpacity testID="tab-quick-actions" style={styles.centralButton} onPress={open}>
        <Ionicons name="add" size={30} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

/**
 * Navigation basse (TXT réf. §M1, remplace la disposition Round 4) : Accueil /
 * Transactions / [+] / Budgets / Plus — 5 positions symétriques, le bouton
 * central [+] occupant mathématiquement le 3e des 5 emplacements (jamais un
 * centrage approximatif sur 4). "Plus" ouvre le menu ☰ (HamburgerMenuScreen,
 * déjà utilisé en écran racine — même composant, simplement rendu ici comme
 * onglet) : Projection et Calendrier en sortent mais restent atteignables
 * depuis ce menu (section "Anticiper", menuSections.ts), inchangés par
 * ailleurs (toujours des Stack.Screen racine). Le bouton central n'est jamais
 * un écran réel : `tabPress` est intercepté.
 */
export function RootTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#172436',
        tabBarInactiveTintColor: '#9AA0A6',
        tabBarIcon: ({ focused, color, size }) => {
          const icons = TAB_ICONS[route.name];
          if (!icons) return null;
          return <Ionicons name={focused ? icons.active : icons.inactive} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Accueil" component={HomeScreen} />
      <Tab.Screen name="Transactions" component={TransactionsScreen} />
      <Tab.Screen
        name="QuickActions"
        component={QuickActionsPlaceholder}
        options={{ tabBarButton: () => <CentralPlusButton />, tabBarLabel: () => null }}
      />
      <Tab.Screen name="Budgets" component={BudgetsScreen} />
      <Tab.Screen name="Plus" component={HamburgerMenuScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  centralWrapper: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centralButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#172436',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
});
