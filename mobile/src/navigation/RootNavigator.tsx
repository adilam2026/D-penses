import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { SignupScreen } from '../screens/auth/SignupScreen';
import { VerifyEmailScreen } from '../screens/auth/VerifyEmailScreen';
import { HouseholdSetupScreen } from '../screens/household/HouseholdSetupScreen';
import { HouseholdMembersScreen } from '../screens/household/HouseholdMembersScreen';
import { JoinHouseholdScreen } from '../screens/household/JoinHouseholdScreen';
import { MenuScreen } from '../screens/MenuScreen';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { AccountDetailScreen } from '../screens/AccountDetailScreen';
import { SubaccountDetailScreen } from '../screens/SubaccountDetailScreen';
import { TransactionDetailScreen } from '../screens/TransactionDetailScreen';
import { UpcomingTransactionsScreen } from '../screens/UpcomingTransactionsScreen';
import { HealthScreen } from '../screens/HealthScreen';
import { FinancialPlansScreen } from '../screens/FinancialPlansScreen';
import { FinancialPlanDetailScreen } from '../screens/FinancialPlanDetailScreen';
import { DeadlineDetailScreen } from '../screens/DeadlineDetailScreen';
import { AccountsScreen } from '../screens/AccountsScreen';
import { CreateAccountScreen } from '../screens/CreateAccountScreen';
import { SavingsSubaccountsScreen } from '../screens/SavingsSubaccountsScreen';
import { CreateSubaccountScreen } from '../screens/CreateSubaccountScreen';
import { CategoriesScreen } from '../screens/CategoriesScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { GuideScreen } from '../screens/GuideScreen';
import { ResetDataScreen } from '../screens/ResetDataScreen';
import { RootTabs } from './RootTabs';
import { colors } from '../ui/theme';

const Stack = createNativeStackNavigator();

function PlaceholderRoute() {
  const route = useRoute<RouteProp<{ Placeholder: { title: string } }, 'Placeholder'>>();
  return <PlaceholderScreen title={route.params?.title ?? ''} subtitle="Cet écran sera construit dans une prochaine étape." />;
}

/**
 * Bascule entre trois états : non connecté → Auth, connecté sans foyer actif →
 * onboarding foyer, connecté avec foyer actif → application (Tabs + menu).
 */
export function RootNavigator() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (status === 'signedOut') {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Signup" component={SignupScreen} />
        <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} />
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
      <Stack.Screen name="Menu" component={MenuScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="AccountDetail" component={AccountDetailScreen} />
      <Stack.Screen name="SubaccountDetail" component={SubaccountDetailScreen} />
      <Stack.Screen name="TransactionDetail" component={TransactionDetailScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="UpcomingTransactions" component={UpcomingTransactionsScreen} />
      <Stack.Screen name="Health" component={HealthScreen} />
      <Stack.Screen name="FinancialPlans" component={FinancialPlansScreen} />
      <Stack.Screen name="FinancialPlanDetail" component={FinancialPlanDetailScreen} />
      <Stack.Screen name="DeadlineDetail" component={DeadlineDetailScreen} />
      <Stack.Screen name="HouseholdMembers" component={HouseholdMembersScreen} options={{ headerShown: true, title: 'Membres du foyer' }} />
      <Stack.Screen name="JoinHousehold" component={JoinHouseholdScreen} options={{ headerShown: true, title: 'Mes foyers' }} />
      <Stack.Screen name="Accounts" component={AccountsScreen} />
      <Stack.Screen name="CreateAccount" component={CreateAccountScreen} />
      <Stack.Screen name="SavingsSubaccounts" component={SavingsSubaccountsScreen} />
      <Stack.Screen name="CreateSubaccount" component={CreateSubaccountScreen} />
      <Stack.Screen name="Categories" component={CategoriesScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Guide" component={GuideScreen} />
      <Stack.Screen name="ResetData" component={ResetDataScreen} />
      <Stack.Screen name="Placeholder" component={PlaceholderRoute} />
    </Stack.Navigator>
  );
}
