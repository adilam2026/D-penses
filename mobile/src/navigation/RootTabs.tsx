import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AccueilScreen } from '../screens/AccueilScreen';
import { EpargneScreen } from '../screens/EpargneScreen';
import { AjouterScreen } from '../screens/AjouterScreen';
import { PlanningScreen } from '../screens/PlanningScreen';
import { AppShell } from './AppShell';
import { colors, elevation } from '../ui/theme';

const Tab = createBottomTabNavigator();

type IconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  Accueil: { active: 'home', inactive: 'home-outline' },
  Planning: { active: 'calendar', inactive: 'calendar-outline' },
  Épargne: { active: 'wallet', inactive: 'wallet-outline' },
};

/** Navigation basse Finance Maison : exactement Accueil / Planning / Épargne / Ajouter, sous un shell persistant (Finance Maison + foyer + ☰). L'onglet "Ajouter" reste un onglet ordinaire (texte, hit-area, accessibilité du tab bar par défaut inchangés) — seule son icône est surélevée dans un disque terracotta (maquette « Foyer » validée), jamais un bouton flottant séparé hors du tab bar. */
export function RootTabs() {
  return (
    <AppShell>
      <Tab.Navigator
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
