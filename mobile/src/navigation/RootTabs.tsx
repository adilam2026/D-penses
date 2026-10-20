import React, { useCallback, useEffect, useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { AccueilScreen } from '../screens/AccueilScreen';
import { EpargneScreen } from '../screens/EpargneScreen';
import { AjouterScreen } from '../screens/AjouterScreen';
import { PlanningScreen } from '../screens/PlanningScreen';
import { TodoScreen } from '../screens/TodoScreen';
import { AppShell } from './AppShell';
import { colors, elevation } from '../ui/theme';

const Tab = createBottomTabNavigator();

type IconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  Accueil: { active: 'home', inactive: 'home-outline' },
  Planning: { active: 'calendar', inactive: 'calendar-outline' },
  'À faire': { active: 'checkbox', inactive: 'checkbox-outline' },
  Épargne: { active: 'wallet', inactive: 'wallet-outline' },
};

/**
 * Navigation basse Finance Maison : Accueil / Planning / Ajouter / À faire /
 * Épargne, sous un shell persistant (Finance Maison + foyer + ☰). L'onglet
 * "Ajouter" reste un onglet ordinaire (texte, hit-area, accessibilité du tab
 * bar par défaut inchangés) — seule son icône est surélevée dans un disque
 * terracotta (maquette « Foyer » validée), jamais un bouton flottant séparé
 * hors du tab bar.
 *
 * Badge "À faire" (lot dédié, §1/§15) : nombre d'ACTIONS restantes ce mois-ci,
 * TOUS responsables confondus (jamais filtré) — relu à chaque changement
 * d'onglet (screenListeners.focus) pour rester à jour après une
 * validation/un paiement partiel effectué ailleurs (Planning, À faire).
 */
export function RootTabs() {
  const [todoBadge, setTodoBadge] = useState<number | undefined>(undefined);

  const refreshBadge = useCallback(() => {
    api
      .getTodo()
      .then((todo) => setTodoBadge(todo.pendingCount > 0 ? todo.pendingCount : undefined))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshBadge();
  }, [refreshBadge]);

  return (
    <AppShell>
      <Tab.Navigator
        screenListeners={{ focus: refreshBadge }}
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textPlaceholder,
          tabBarIcon: ({ focused, color, size }) => {
            if (route.name === 'Ajouter') {
              return (
                <View style={styles.fab}>
                  <Ionicons name="add" size={26} color={colors.textOnPrimary} />
                </View>
              );
            }
            const icons = TAB_ICONS[route.name];
            if (!icons) return null;
            return <Ionicons name={focused ? icons.active : icons.inactive} size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Accueil" component={AccueilScreen} />
        <Tab.Screen name="Planning" component={PlanningScreen} />
        <Tab.Screen name="Ajouter" component={AjouterScreen} />
        <Tab.Screen name="À faire" component={TodoScreen} options={{ tabBarBadge: todoBadge }} />
        <Tab.Screen name="Épargne" component={EpargneScreen} />
      </Tab.Navigator>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  fab: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -16,
    ...elevation.raised,
  },
});
