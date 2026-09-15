import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { FinancialPlansScreen } from '../FinancialPlansScreen';
import * as api from '../../../api/client';

/**
 * Corrections UI/UX finales §5/§11 — l'écran Plans financiers ne montre plus
 * les 2 boutons fixes "🎓 Frais scolaires" / "✈️ Voyage" : un seul bouton "+"
 * ouvre le choix du type de plan (École/Voyage/Voiture/Maison/Abonnements),
 * même pattern que QuickActionsSheet.onCreerPlan().
 */
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => require('react').createElement(Text, null, props.name) };
});

jest.mock('../../../api/client', () => ({
  listFinancialPlans: jest.fn(),
}));

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listFinancialPlans.mockResolvedValue([]);
});

it('affiche un seul bouton "+" (jamais les 2 boutons fixes École/Voyage)', async () => {
  await render(<FinancialPlansScreen />);
  await waitFor(() => screen.getByTestId('financial-plans-add-button'));

  expect(screen.queryByText('🎓 Frais scolaires')).toBeNull();
  expect(screen.queryByText('✈️ Voyage')).toBeNull();
});

it('le bouton "+" ouvre un choix des 5 types de plan', async () => {
  await render(<FinancialPlansScreen />);
  await waitFor(() => screen.getByTestId('financial-plans-add-button'));

  await fireEvent.press(screen.getByTestId('financial-plans-add-button'));

  await waitFor(() => expect(screen.getByTestId('plan-type-choice-option-scolaire')).toBeTruthy());
  expect(screen.getByTestId('plan-type-choice-option-voyage')).toBeTruthy();
  expect(screen.getByTestId('plan-type-choice-option-voiture')).toBeTruthy();
  expect(screen.getByTestId('plan-type-choice-option-maison')).toBeTruthy();
  expect(screen.getByTestId('plan-type-choice-option-abonnements')).toBeTruthy();
});

it('choisir "Voiture" navigue vers VehicleWizard', async () => {
  await render(<FinancialPlansScreen />);
  await waitFor(() => screen.getByTestId('financial-plans-add-button'));
  await fireEvent.press(screen.getByTestId('financial-plans-add-button'));
  await waitFor(() => expect(screen.getByTestId('plan-type-choice-option-voiture')).toBeTruthy());

  await fireEvent.press(screen.getByTestId('plan-type-choice-option-voiture'));

  expect(mockNavigate).toHaveBeenCalledWith('VehicleWizard');
});
