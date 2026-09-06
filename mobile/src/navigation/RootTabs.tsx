import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { HomeScreen } from '../screens/HomeScreen';
import { TransactionsScreen } from '../screens/transactions/TransactionsScreen';
import { CalendarScreen } from '../screens/calendar/CalendarScreen';
import { EpargneScreen } from '../screens/savings/EpargneScreen';
import { PlusMenuScreen } from '../screens/PlusMenuScreen';

const Tab = createBottomTabNavigator();

type IconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  Accueil: { active: 'home', inactive: 'home-outline' },
  Transactions: { active: 'swap-horizontal', inactive: 'swap-horizontal-outline' },
  Calendrier: { active: 'calendar', inactive: 'calendar-outline' },
  Épargne: { active: 'wallet', inactive: 'wallet-outline' },
  Plus: { active: 'menu', inactive: 'menu-outline' },
};

/**
 * Navigation principale (document 03 §J.2/J.4) : Accueil / Transactions / Calendrier /
 * Épargne / Plus. Le bouton central « + » (feuille modale de saisie rapide, écrans
 * Home/Transactions) navigue vers le stack racine (RootNavigator), pas un onglet.
 *
 * Icônes explicites obligatoires : sans `tabBarIcon`, React Navigation affiche son
 * propre placeholder « icône manquante » (le carré à croix constaté en recette).
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
          return <Ionicons name={focused ? icons.active : icons.inactive} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Accueil" component={HomeScreen} />
      <Tab.Screen name="Transactions" component={TransactionsScreen} />
      <Tab.Screen name="Calendrier" component={CalendarScreen} />
      <Tab.Screen name="Épargne" component={EpargneScreen} />
      <Tab.Screen name="Plus" component={PlusMenuScreen} />
    </Tab.Navigator>
  );
}
