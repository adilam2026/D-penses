import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { SignupScreen } from '../screens/auth/SignupScreen';
import { HouseholdSetupScreen } from '../screens/household/HouseholdSetupScreen';
import { QuickAddScreen } from '../screens/quickadd/QuickAddScreen';
import { RootTabs } from './RootTabs';

const Stack = createNativeStackNavigator();

/**
 * Bascule entre trois états (docs/03 §I.1) : non connecté → Auth, connecté sans
 * foyer actif → onboarding foyer (RG-001), connecté avec foyer actif → application.
 */
export function RootNavigator() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5F2' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (status === 'signedOut') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Signup" component={SignupScreen} />
      </Stack.Navigator>
    );
  }

  if (status === 'needsHousehold') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="HouseholdSetup" component={HouseholdSetupScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Tabs" component={RootTabs} />
      <Stack.Screen name="QuickAdd" component={QuickAddScreen} options={{ presentation: 'modal' }} />
    </Stack.Navigator>
  );
}
