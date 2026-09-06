import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { IncomeSourceDetailScreen } from '../IncomeSourceDetailScreen';
import * as api from '../../../api/client';

/** Recette post-Vague 3 (§5) — modifier/désactiver/supprimer une source de revenu, sans jamais casser l'historique reçu. */
jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }),
  useRoute: () => ({ params: { id: 's1', label: 'Salaire' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    getIncomeSource: jest.fn(),
    listIncomeOccurrences: jest.fn(),
    updateIncomeSource: jest.fn(),
    deleteIncomeSource: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

const SOURCE = { id: 's1', label: 'Salaire', usualAmount: 10000, recurrenceRule: 'mensuel', status: 'actif' as const };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockedApi.getIncomeSource.mockResolvedValue(SOURCE);
  mockedApi.listIncomeOccurrences.mockResolvedValue([]);
});

it('modifie le montant habituel de la source', async () => {
  mockedApi.updateIncomeSource.mockResolvedValue({ ...SOURCE, usualAmount: 11000 });
  await render(<IncomeSourceDetailScreen />);
  await waitFor(() => screen.getByTestId('income-source-save'));

  await fireEvent.changeText(screen.getByDisplayValue('10000'), '11000');
  await fireEvent.press(screen.getByTestId('income-source-save'));

  await waitFor(() => expect(mockedApi.updateIncomeSource).toHaveBeenCalledWith('s1', expect.objectContaining({ usualAmount: 11000 })));
});

it('"Arrêter la récurrence" bascule status=inactif', async () => {
  mockedApi.updateIncomeSource.mockResolvedValue({ ...SOURCE, status: 'inactif' });
  await render(<IncomeSourceDetailScreen />);
  await waitFor(() => screen.getByTestId('income-source-toggle-status'));

  await fireEvent.press(screen.getByTestId('income-source-toggle-status'));

  await waitFor(() => expect(mockedApi.updateIncomeSource).toHaveBeenCalledWith('s1', { status: 'inactif' }));
});

it('"Supprimer" demande confirmation puis supprime la source', async () => {
  mockedApi.deleteIncomeSource.mockResolvedValue({ deleted: true });
  await render(<IncomeSourceDetailScreen />);
  await waitFor(() => screen.getByTestId('income-source-delete'));

  await fireEvent.press(screen.getByTestId('income-source-delete'));
  const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  await buttons[1].onPress();

  await waitFor(() => expect(mockedApi.deleteIncomeSource).toHaveBeenCalledWith('s1'));
  expect(mockGoBack).toHaveBeenCalled();
});

it('affiche une erreur claire quand la suppression est refusée (occurrence déjà reçue, 409)', async () => {
  mockedApi.deleteIncomeSource.mockRejectedValue(new api.ApiError(409, 'Impossible de supprimer : des occurrences déjà reçues existent.'));
  await render(<IncomeSourceDetailScreen />);
  await waitFor(() => screen.getByTestId('income-source-delete'));

  await fireEvent.press(screen.getByTestId('income-source-delete'));
  const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  await buttons[1].onPress();

  await waitFor(() => screen.getByText(/occurrences déjà reçues/));
  expect(mockGoBack).not.toHaveBeenCalled();
});
