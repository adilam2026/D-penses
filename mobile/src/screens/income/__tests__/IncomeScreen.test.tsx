import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { IncomeScreen } from '../IncomeScreen';
import * as api from '../../../api/client';

/** Recette post-Vague 3 (§6/§7) — même principe que ChargesScreen (§10, même moteur/mêmes composants). */
jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { ...actual, listIncomeSources: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
});

it('"+ Ajouter un revenu" navigue vers l\'écran de création dédié', async () => {
  mockedApi.listIncomeSources.mockResolvedValue([]);
  await render(<IncomeScreen />);
  await waitFor(() => screen.getByTestId('add-income-button'));

  await fireEvent.press(screen.getByTestId('add-income-button'));

  expect(mockNavigate).toHaveBeenCalledWith('CreateIncome');
});

it('affiche une ligne compacte et tap → IncomeSourceDetail', async () => {
  mockedApi.listIncomeSources.mockResolvedValue([
    { id: 's1', label: 'Salaire Lam', usualAmount: 29500, recurrenceRule: 'mensuel', status: 'actif', occurrences: [{ id: 'o1', usualDate: '2026-09-29' }] },
  ]);
  await render(<IncomeScreen />);
  await waitFor(() => screen.getByText('Salaire Lam'));

  expect(screen.getByText('29 500 DH')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('income-row-s1'));
  expect(mockNavigate).toHaveBeenCalledWith('IncomeSourceDetail', { id: 's1', label: 'Salaire Lam' });
});

it('les revenus arrêtés restent accessibles, repliés par défaut', async () => {
  mockedApi.listIncomeSources.mockResolvedValue([
    { id: 's1', label: 'Actif', usualAmount: 100, recurrenceRule: 'mensuel', status: 'actif', occurrences: [] },
    { id: 's2', label: 'Arrêté', usualAmount: 100, recurrenceRule: 'mensuel', status: 'inactif', occurrences: [] },
  ]);
  await render(<IncomeScreen />);
  await waitFor(() => screen.getByText('Actif'));

  expect(screen.queryByText('Arrêté')).toBeNull();
  await fireEvent.press(screen.getByTestId('toggle-inactive-income'));
  expect(screen.getByText('Arrêté')).toBeTruthy();
});
