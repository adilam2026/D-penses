import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/auth/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { WebContainer } from './src/ui/WebContainer';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <WebContainer>
          <NavigationContainer>
            <RootNavigator />
            <StatusBar style="auto" />
          </NavigationContainer>
        </WebContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
