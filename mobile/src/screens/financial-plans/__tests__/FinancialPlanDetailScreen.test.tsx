import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { FinancialPlanDetailScreen } from '../FinancialPlanDetailScreen';
import * as api from '../../../api/client';

/**
 * Correctif critique post-Vague 3 (§11/§12) — le bouton "Payer" et le tap sur
 * une échéance à confirmer utilisaient `navigation.getParent()?.navigate(...)`.
 * FinancialPlanDetailScreen est un Stack.Screen RACINE (RootNavigator), pas un
 * écran imbriqué dans RootTabs : `getParent()` y retourne toujours undefined,
 * donc `?.navigate(...)` ne faisait STRICTEMENT rien (bug identique à celui
 * déjà corrigé sur EpargneScreen). Ces tests prouvent que le tap déclenche
 * réellement la navigation (plain `navigate`), pas seulement qu'aucune erreur
 * n'est levée.
 */
const mockNavigate = jest.fn();
const mockGetParent = jest.fn(() => undefined); // simule fidèlement un Stack.Screen racine
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, getParent: mockGetParent }),
  useRoute: () => ({ params: { id: 'plan-1' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { ...actual, getFinancialPlan: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

const PLAN = {
  label: 'École 2026/2027',
  knownPlanCost: 20000,
  paidAmount: 0,
  remainingDue: 20000,
  provisionCoverage: 0,
  remainingToFund: 20000,
  tauxCouverture: 0,
  completude: 'complet' as const,
  deadlinesCertain: [
    {
      id: 'd1',
      dueDate: '2026-09-30',
      chargePlanLabel: 'Scolarité T1',
      amountCurrent: 21800,
      amountStatus: 'confirme' as const,
      resteAPayer: 21800,
      financialStatus: 'ouverte' as const,
      provisionId: null,
      coverageAffectee: 0,
      engagementNonCouvert: 21800,
      coverageStatus: 'non_couverte' as const,
    },
    {
      id: 'd2',
      dueDate: '2026-10-15',
      chargePlanLabel: 'Garderie',
      amountCurrent: 500,
      amountStatus: 'estime' as const,
      resteAPayer: 500,
      financialStatus: 'ouverte' as const,
      provisionId: null,
      coverageAffectee: 0,
      engagementNonCouvert: 500,
      coverageStatus: 'non_couverte' as const,
    },
  ],
  envisagedItems: [],
  envisagedTotal: 0,
  unknownItems: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.getFinancialPlan.mockResolvedValue(PLAN);
});

it('le bouton "Payer" navigue réellement vers DeadlineDetail (bug critique corrigé)', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('pay-deadline-d1'));

  await fireEvent.press(screen.getByTestId('pay-deadline-d1'));

  expect(mockNavigate).toHaveBeenCalledWith('DeadlineDetail', { id: 'd1' });
});

it('taper une échéance "Estimé" navigue réellement vers ConfirmDeadline (bug critique corrigé)', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByText(/Garderie/));

  await fireEvent.press(screen.getByText(/Garderie/));

  expect(mockNavigate).toHaveBeenCalledWith('ConfirmDeadline', { id: 'd2' });
});

it('taper une échéance déjà confirmée navigue vers DeadlineDetail (pas ConfirmDeadline)', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByText(/Scolarité T1/));

  await fireEvent.press(screen.getByText(/Scolarité T1/));

  expect(mockNavigate).toHaveBeenCalledWith('DeadlineDetail', { id: 'd1' });
});
