import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/HomeScreen';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { TransactionsScreen } from '../screens/transactions/TransactionsScreen';
import { AccountsScreen } from '../screens/accounts/AccountsScreen';

const Tab = createBottomTabNavigator();

/**
 * Navigation principale (document 03 §J.2/J.4) : Accueil / Transactions / Calendrier /
 * Épargne / Plus. Le bouton central « + » (feuille modale de saisie rapide, écrans
 * Home/Transactions) navigue vers le stack racine (RootNavigator), pas un onglet.
 */
export function RootTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Accueil" component={HomeScreen} />
      <Tab.Screen name="Transactions" component={TransactionsScreen} />
      <Tab.Screen name="Calendrier">
        {() => (
          <PlaceholderScreen
            title="Calendrier"
            subtitle="Vue échéances/calendrier financier — arrivera avec le Lot 5 (trésorerie & dashboard)."
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Épargne">
        {() => <PlaceholderScreen title="Épargne" subtitle="Poches, provisions & objectifs — arrivera avec le Lot 6." />}
      </Tab.Screen>
      <Tab.Screen name="Plus" component={AccountsScreen} />
    </Tab.Navigator>
  );
}
