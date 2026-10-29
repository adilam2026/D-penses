import React from 'react';
import { ScrollView, Text } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ForgotPinFlow } from './ForgotPinFlow';
import { authStyles } from './authStyles';

/** « Code oublié ? » depuis l'écran de connexion (email saisi, ou à saisir). */
export function ForgotPinScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const email: string | undefined = route.params?.email || undefined;
  return (
    <ScrollView contentContainerStyle={[authStyles.screen, { flexGrow: 1 }]} keyboardShouldPersistTaps="handled">
      <Text style={authStyles.brand}>Finance Maison</Text>
      <ForgotPinFlow initialEmail={email} onCancel={() => navigation.goBack()} />
    </ScrollView>
  );
}
