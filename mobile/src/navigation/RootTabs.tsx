import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { AccueilScreen } from '../screens/AccueilScreen';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { colors } from '../ui/theme';

const Tab = createBottomTabNavigator();

type IconName = keyof typeof Ionicons.glyphMap;

const TAB_ICONS: Record<string, { active: IconName; inactive: IconName }> = {
  Accueil: { active: 'home', inactive: 'home-outline' },
  Planning: { active: 'calendar', inactive: 'calendar-outline' },
  Épargne: { active: 'leaf', inactive: 'leaf-outline' },
  Ajouter: { active: 'add-circle', inactive: 'add-circle-outline' },
};

function PlanningPlaceholder() {
  return <PlaceholderScreen title="Planning" subtitle="Vue mensuelle des opérations prévues et réalisées — à venir." />;
}

function EpargnePlaceholder() {
  return <PlaceholderScreen title="Épargne" subtitle="Vue consolidée de l'épargne du foyer — à venir." />;
}

function AjouterPlaceholder() {
  return <PlaceholderScreen title="Ajouter" subtitle="Dépense, revenu, transfert, versement — à venir." />;
}

/** Navigation basse Finance Maison : exactement Accueil / Planning / Épargne / Ajouter. */
export function RootTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textPlaceholder,
        tabBarIcon: ({ focused, color, size }) => {
          const icons = TAB_ICONS[route.name];
          if (!icons) return null;
          return <Ionicons name={focused ? icons.active : icons.inactive} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Accueil" component={AccueilScreen} />
      <Tab.Screen name="Planning" component={PlanningPlaceholder} />
      <Tab.Screen name="Épargne" component={EpargnePlaceholder} />
      <Tab.Screen name="Ajouter" component={AjouterPlaceholder} />
    </Tab.Navigator>
  );
}
