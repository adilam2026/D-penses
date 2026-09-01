import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/HomeScreen';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';

const Tab = createBottomTabNavigator();

/**
 * Navigation principale (document 03 §J.2/J.4) : Accueil / Transactions / Calendrier /
 * Épargne / Plus. Le bouton central « + » (feuille modale de saisie rapide) sera ajouté
 * avec le premier type d'opération saisissable (Lot 2 — revenus & charges de base).
 */
export function RootTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Accueil" component={HomeScreen} />
      <Tab.Screen name="Transactions">
        {() => (
          <PlaceholderScreen
            title="Transactions"
            subtitle="Alimenté par LedgerEntry — arrivera avec le Lot 2 (revenus & charges)."
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Calendrier">
        {() => (
          <PlaceholderScreen
            title="Calendrier"
            subtitle="Vue échéances/calendrier financier — arrivera avec le Lot 5 (trésorerie & dashboard)."
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Épargne">
        {() => (
          <PlaceholderScreen
            title="Épargne"
            subtitle="Poches, provisions & objectifs — arrivera avec le Lot 6."
          />
        )}
      </Tab.Screen>
      <Tab.Screen name="Plus">
        {() => (
          <PlaceholderScreen
            title="Plus"
            subtitle="Foyer, Comptes, Paramètres, Sécurité — Comptes arrive dès le Lot 1."
          />
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );
}
