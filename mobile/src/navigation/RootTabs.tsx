import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { HomeScreen } from '../screens/HomeScreen';
import { TransactionsScreen } from '../screens/transactions/TransactionsScreen';
import { CalendarScreen } from '../screens/calendar/CalendarScreen';
import { useQuickActions } from '../state/QuickActionsContext';

const Tab = createBottomTabNavigator();

type IconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  Accueil: { active: 'home', inactive: 'home-outline' },
  Transactions: { active: 'swap-horizontal', inactive: 'swap-horizontal-outline' },
  Calendrier: { active: 'calendar', inactive: 'calendar-outline' },
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
 * Navigation basse (Vague 3 §1/§2) : Accueil / Transactions / [+] / Calendrier.
 * "Enveloppes" et "Plus" ont quitté la barre — Enveloppes vit sous ☰ Mes finances,
 * "Plus" est remplacé par le menu ☰ (structurel) + la bottom sheet "+" (quotidien).
 * Le bouton central n'est jamais un écran réel : `tabPress` est intercepté.
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
      <Tab.Screen name="Calendrier" component={CalendarScreen} />
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
