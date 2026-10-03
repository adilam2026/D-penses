import React, { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, type NavigationState, type PartialState } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Fraunces_600SemiBold, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { AuthProvider } from './src/auth/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { AppShell } from './src/web/AppShell';
import { colors } from './src/ui/theme';

// Architecture Web v3 §2/§3 — le shell desktop (Sidebar/Header) vit hors de
// l'arbre des Screen (monté au-dessus de tout RootNavigator) : navigationRef
// est le mécanisme standard React Navigation pour naviguer depuis un
// composant qui n'a pas accès à useNavigation(). No-op sur natif (AppShell.tsx
// = passthrough), jamais utilisé par les écrans mobiles existants.
const navigationRef = createNavigationContainerRef<any>();

// Recette standard React Navigation ("screen tracking") — nom de la route
// active la plus profonde, utilisé uniquement pour l'affichage (titre Header,
// item actif Sidebar), jamais pour une décision métier.
function getActiveRouteName(state: NavigationState | PartialState<NavigationState> | undefined): string | undefined {
  if (!state || state.index === undefined) return undefined;
  const route = state.routes[state.index];
  if (route.state) return getActiveRouteName(route.state as NavigationState);
  return route.name;
}

export default function App() {
  const [currentRouteName, setCurrentRouteName] = useState<string | undefined>(undefined);
  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  // Direction artistique « Foyer » (maquette validée) : les tokens de
  // typography.ts pointent vers des fichiers de police précis (Fraunces/Plus
  // Jakarta Sans) — tant qu'ils ne sont pas chargés, on affiche un fond
  // crème neutre plutôt qu'un flash de police système suivi d'un changement
  // brutal de rendu.
  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer
          ref={navigationRef}
          onReady={() => setCurrentRouteName(getActiveRouteName(navigationRef.getRootState()))}
          onStateChange={(state) => setCurrentRouteName(getActiveRouteName(state))}
        >
          <AppShell navigationRef={navigationRef} currentRouteName={currentRouteName}>
            <RootNavigator />
          </AppShell>
          <StatusBar style="auto" />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
