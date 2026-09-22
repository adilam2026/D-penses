import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { FinancialPlansScreen } from '../financial-plans/FinancialPlansScreen';
import { ChildrenScreen } from '../children/ChildrenScreen';
import { ChildCostsScreen } from '../children/ChildCostsScreen';
import { BudgetsScreen } from '../budgets/BudgetsScreen';
import * as api from '../../api/client';

jest.mock('../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => require('react').createElement(Text, null, props.name) };
});

/**
 * Correctif critique post-Vague 3 (§16 "bugs supplémentaires trouvés") — audit
 * exhaustif de `navigation.getParent()` a révélé le MÊME bug que celui déjà
 * connu sur EpargneScreen/FinancialPlanDetailScreen sur 4 écrans Stack
 * RACINE supplémentaires (RootNavigator) : FinancialPlansScreen,
 * ChildrenScreen, ChildCostsScreen, BudgetsScreen. Sur un Stack.Screen racine,
 * `getParent()` retourne toujours undefined — `?.navigate(...)` ne faisait
 * donc STRICTEMENT rien (boutons "morts" en silence). Ces tests prouvent que
 * chaque action déclenche réellement `navigate` (plain, jamais getParent()?.).
 */
const mockNavigate = jest.fn();
const mockGetParent = jest.fn(() => undefined); // simule fidèlement un Stack.Screen racine
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, getParent: mockGetParent }),
  useRoute: () => ({ params: { id: 'child-1' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return {
    ...actual,
    listFinancialPlans: jest.fn(),
    createFinancialPlan: jest.fn(),
    listChildren: jest.fn(),
    getChildCosts: jest.fn(),
    listVariableBudgets: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('FinancialPlansScreen', () => {
  // Convergence V6C §1/§2 — le bouton "+" ouvre désormais directement le
  // formulaire Nom/Description (jamais un choix de type de plan/wizard) ;
  // la création navigue réellement vers FinancialPlanDetail (plain
  // `navigate`, jamais `getParent()?.navigate` — même garde-fou que ci-dessous).
  it('créer un plan (Nom/Description) navigue réellement vers FinancialPlanDetail', async () => {
    mockedApi.listFinancialPlans.mockResolvedValue([]);
    mockedApi.createFinancialPlan.mockResolvedValue({ id: 'new-plan' });
    await render(<FinancialPlansScreen />);
    await waitFor(() => screen.getByTestId('financial-plans-add-button'));
    await fireEvent.press(screen.getByTestId('financial-plans-add-button'));
    await waitFor(() => screen.getByTestId('financial-plan-create-label'));

    await fireEvent.changeText(screen.getByTestId('financial-plan-create-label'), 'École 2026/2027');
    await fireEvent.press(screen.getByTestId('financial-plan-create-save'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('FinancialPlanDetail', { id: 'new-plan' }));
  });

  it('taper "[Voir]" sur un plan navigue réellement vers FinancialPlanDetail', async () => {
    mockedApi.listFinancialPlans.mockResolvedValue([{ id: 'p1', label: 'École', description: null, active: true, chargeCount: 3 }]);
    await render(<FinancialPlansScreen />);
    await waitFor(() => screen.getByText('École'));

    await fireEvent.press(screen.getByTestId('financial-plan-view-p1'));

    expect(mockNavigate).toHaveBeenCalledWith('FinancialPlanDetail', { id: 'p1' });
  });
});

describe('ChildrenScreen', () => {
  it('taper un enfant navigue réellement vers ChildCosts', async () => {
    mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Yasmine', lastName: 'T' }]);
    await render(<ChildrenScreen />);
    await waitFor(() => screen.getByText('Yasmine T'));

    await fireEvent.press(screen.getByText('Yasmine T'));

    expect(mockNavigate).toHaveBeenCalledWith('ChildCosts', { id: 'c1' });
  });
});

describe('ChildCostsScreen', () => {
  it('taper la prochaine échéance navigue réellement vers DeadlineDetail', async () => {
    mockedApi.getChildCosts.mockResolvedValue({
      child: { firstName: 'Yasmine', lastName: 'T' },
      coutConnu: 1000,
      paye: 0,
      resteAPayer: 1000,
      resteAFinancer: 1000,
      byCategory: {},
      chargesCommunesNonVentilees: [],
      prochaineEcheance: { deadlineId: 'd1', chargePlanId: 'cp1', label: 'Scolarité', dueDate: '2026-09-30', resteAPayer: 1000 },
      plansAssocies: [{ id: 'p1', label: 'École' }],
    });
    await render(<ChildCostsScreen />);
    await waitFor(() => screen.getByText('Prochaine échéance'));

    await fireEvent.press(screen.getByText('Scolarité'));
    expect(mockNavigate).toHaveBeenCalledWith('DeadlineDetail', { id: 'd1' });

    await fireEvent.press(screen.getByText('École'));
    expect(mockNavigate).toHaveBeenCalledWith('FinancialPlanDetail', { id: 'p1' });
  });
});

describe('BudgetsScreen', () => {
  it('taper "+ Nouveau budget" navigue réellement vers CreateBudget', async () => {
    mockedApi.listVariableBudgets.mockResolvedValue([]);
    await render(<BudgetsScreen />);
    await waitFor(() => screen.getByText('+ Nouveau budget'));

    await fireEvent.press(screen.getByText('+ Nouveau budget'));

    expect(mockNavigate).toHaveBeenCalledWith('CreateBudget');
  });

  it('taper un budget navigue réellement vers BudgetDetail', async () => {
    mockedApi.listVariableBudgets.mockResolvedValue([
      {
        id: 'b1',
        referenceAmount: 1000,
        referencePeriod: 'mois',
        category: { name: 'Alimentation' },
        status: { budgetPeriode: 1000, consommeADate: 200, budgetContractuelRestant: 800, rythmeProjete: 400, healthStatus: 'sous_budget' },
      },
    ]);
    await render(<BudgetsScreen />);
    await waitFor(() => screen.getByText('Alimentation'));

    await fireEvent.press(screen.getByText('Alimentation'));

    expect(mockNavigate).toHaveBeenCalledWith('BudgetDetail', { id: 'b1' });
  });
});
