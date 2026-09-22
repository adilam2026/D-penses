import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from '../screens/HomeScreen';
import { TransactionsScreen } from '../screens/transactions/TransactionsScreen';
import { CalendarScreen } from '../screens/calendar/CalendarScreen';
import { ProjectionScreen } from '../screens/projection/ProjectionScreen';
import { PlanningScreen } from '../screens/planning/PlanningScreen';
import { EnvelopesScreen } from '../screens/envelopes/EnvelopesScreen';

const Stack = createNativeStackNavigator();

/**
 * Architecture Web v3 §2/§3/§10 — équivalent Web de RootTabs.tsx (résolu à la
 * place de celui-ci sur les builds Web, même mécanisme que DateField.web.tsx) :
 * AUCUNE bottom bar visible sur desktop, la Sidebar est la seule navigation
 * visible (§10 — "aucune bottom bar visible sur desktop"). Mêmes noms de route
 * que la version native (Accueil/Transactions/Projection/Calendrier), pour que
 * la Sidebar (menuSections.ts) navigue avec navigationRef.navigate('Tabs',
 * {screen: 'Accueil'}) sans distinguer plateforme. "Accueil" résout ici vers
 * HomeScreen.web.tsx (résolution Metro par extension de plateforme) ; les 3
 * autres écrans n'ont pas encore de variante Web dédiée pour ce lot (WEB-D1 =
 * Home uniquement) et restent donc les écrans mobiles existants, inchangés,
 * simplement rendus dans la zone de contenu du shell desktop.
 */
export function RootTabs() {
  return (
    <Stack.Navigator initialRouteName="Accueil" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Accueil" component={HomeScreen} />
      <Stack.Screen name="Planning" component={PlanningScreen} />
      <Stack.Screen name="Enveloppes" component={EnvelopesScreen} />
      <Stack.Screen name="Transactions" component={TransactionsScreen} />
      <Stack.Screen name="Projection" component={ProjectionScreen} />
      <Stack.Screen name="Calendrier" component={CalendarScreen} />
    </Stack.Navigator>
  );
}
