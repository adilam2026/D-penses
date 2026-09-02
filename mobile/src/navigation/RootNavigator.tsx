import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { SignupScreen } from '../screens/auth/SignupScreen';
import { HouseholdSetupScreen } from '../screens/household/HouseholdSetupScreen';
import { QuickAddScreen } from '../screens/quickadd/QuickAddScreen';
import { AccountsScreen } from '../screens/accounts/AccountsScreen';
import { BudgetsScreen } from '../screens/budgets/BudgetsScreen';
import { BudgetDetailScreen } from '../screens/budgets/BudgetDetailScreen';
import { CreateBudgetScreen } from '../screens/budgets/CreateBudgetScreen';
import { ChildrenScreen } from '../screens/children/ChildrenScreen';
import { ChildCostsScreen } from '../screens/children/ChildCostsScreen';
import { FinancialPlansScreen } from '../screens/financial-plans/FinancialPlansScreen';
import { FinancialPlanDetailScreen } from '../screens/financial-plans/FinancialPlanDetailScreen';
import { ConfirmDeadlineScreen } from '../screens/financial-plans/ConfirmDeadlineScreen';
import { SchoolWizardScreen } from '../screens/school-wizard/SchoolWizardScreen';
import { CreatePocketScreen } from '../screens/savings/CreatePocketScreen';
import { PocketDetailScreen } from '../screens/savings/PocketDetailScreen';
import { GoalsScreen } from '../screens/savings/GoalsScreen';
import { GoalDetailScreen } from '../screens/savings/GoalDetailScreen';
import { CreateGoalScreen } from '../screens/savings/CreateGoalScreen';
import { ProjectionScreen } from '../screens/projection/ProjectionScreen';
import { SimulatorScreen } from '../screens/simulation/SimulatorScreen';
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
      <Stack.Screen name="Accounts" component={AccountsScreen} options={{ headerShown: true, title: 'Comptes' }} />
      <Stack.Screen name="Budgets" component={BudgetsScreen} options={{ headerShown: true, title: 'Budgets' }} />
      <Stack.Screen name="BudgetDetail" component={BudgetDetailScreen} options={{ headerShown: true, title: 'Budget' }} />
      <Stack.Screen name="CreateBudget" component={CreateBudgetScreen} options={{ headerShown: true, title: 'Nouveau budget', presentation: 'modal' }} />
      <Stack.Screen name="Children" component={ChildrenScreen} options={{ headerShown: true, title: 'Enfants' }} />
      <Stack.Screen name="ChildCosts" component={ChildCostsScreen} options={{ headerShown: true, title: 'Coûts' }} />
      <Stack.Screen name="FinancialPlans" component={FinancialPlansScreen} options={{ headerShown: true, title: 'Plans financiers' }} />
      <Stack.Screen name="FinancialPlanDetail" component={FinancialPlanDetailScreen} options={{ headerShown: true, title: 'Plan financier' }} />
      <Stack.Screen name="ConfirmDeadline" component={ConfirmDeadlineScreen} options={{ headerShown: true, title: 'Confirmer la facture', presentation: 'modal' }} />
      <Stack.Screen name="SchoolWizard" component={SchoolWizardScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="CreatePocket" component={CreatePocketScreen} options={{ headerShown: true, title: 'Nouvelle poche', presentation: 'modal' }} />
      <Stack.Screen name="PocketDetail" component={PocketDetailScreen} options={{ headerShown: true, title: 'Épargne' }} />
      <Stack.Screen name="Goals" component={GoalsScreen} options={{ headerShown: true, title: 'Objectifs' }} />
      <Stack.Screen name="GoalDetail" component={GoalDetailScreen} options={{ headerShown: true, title: 'Objectif' }} />
      <Stack.Screen name="CreateGoal" component={CreateGoalScreen} options={{ headerShown: true, title: 'Nouvel objectif', presentation: 'modal' }} />
      <Stack.Screen name="Projection" component={ProjectionScreen} options={{ headerShown: true, title: 'Projection' }} />
      <Stack.Screen name="Simulator" component={SimulatorScreen} options={{ headerShown: true, title: 'Simulateur' }} />
    </Stack.Navigator>
  );
}
