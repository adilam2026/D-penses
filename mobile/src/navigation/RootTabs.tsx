import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { HomeScreen } from '../screens/HomeScreen';
import { PlanningScreen } from '../screens/planning/PlanningScreen';
import { EnvelopesScreen } from '../screens/envelopes/EnvelopesScreen';
import { useQuickActions } from '../state/QuickActionsContext';

const Tab = createBottomTabNavigator();

type IconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  Accueil: { active: 'home', inactive: 'home-outline' },
  Planning: { active: 'grid', inactive: 'grid-outline' },
  Enveloppes: { active: 'wallet', inactive: 'wallet-outline' },
};

// Jamais rendu : `tabBarButton` remplace entièrement le bouton par défaut de cet
// onglet (CentralPlusButton, ci-dessous), qui ouvre la bottom sheet directement —
// jamais une navigation réelle vers un écran "QuickActions".
function QuickActionsPlaceholder() {
  return null;
}

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
 * Refonte maquette V6B §19 — navigation principale mandatée : Accueil /
 * Planning / [+] / Enveloppes, 4 positions symétriques (le bouton central
 * occupe le 3e des 4 emplacements). Transactions/Calendrier/Projection/
 * Budgets/Objectifs et le reste de l'app existante restent entièrement
 * fonctionnels et atteignables depuis le menu ☰ (HamburgerMenuScreen,
 * menuSections.ts) — rien n'est supprimé, seule la barre du bas change pour
 * suivre la maquette. Le bouton central n'est jamais un écran réel.
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
      <Tab.Screen name="Planning" component={PlanningScreen} />
      <Tab.Screen
        name="QuickActions"
        component={QuickActionsPlaceholder}
        options={{ tabBarButton: () => <CentralPlusButton />, tabBarLabel: () => null }}
      />
      <Tab.Screen name="Enveloppes" component={EnvelopesScreen} />
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
