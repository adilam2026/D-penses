import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { CreateChargeScreen } from '../CreateChargeScreen';
import * as api from '../../../api/client';

/**
 * Recette post-Vague 3 (§2/§3) — catégorie et fréquence via sélecteur compact,
 * plus de 15-20 chips affichées en permanence.
 */
jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { ...actual, listCategories: jest.fn(), createChargePlan: jest.fn(), createDeadline: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listCategories.mockResolvedValue([
    { id: 'cat1', name: 'Logement', kind: 'expense' },
    { id: 'cat2', name: 'Loisirs', kind: 'expense' },
  ]);
});

it('catégorie via sélecteur compact (jamais des chips permanentes)', async () => {
  await render(<CreateChargeScreen />);
  await waitFor(() => screen.getByTestId('charge-category-select'));

  expect(screen.queryByText('Loisirs')).toBeNull(); // pas affiché en permanence, seulement dans la liste ouverte

  await fireEvent.press(screen.getByTestId('charge-category-select'));
  await waitFor(() => screen.getByTestId('charge-category-select-option-cat2'));
  await fireEvent.press(screen.getByTestId('charge-category-select-option-cat2'));

  expect(screen.getByText('Loisirs')).toBeTruthy();
});

it('fréquence via sélecteur compact, et crée la charge avec la fréquence choisie', async () => {
  mockedApi.createChargePlan.mockResolvedValue({ id: 'cp1' });
  mockedApi.createDeadline.mockResolvedValue({ id: 'd1' });
  await render(<CreateChargeScreen />);
  await waitFor(() => screen.getByTestId('charge-frequency-select'));

  await fireEvent.press(screen.getByTestId('charge-frequency-select'));
  await waitFor(() => screen.getByTestId('charge-frequency-select-option-trimestriel'));
  await fireEvent.press(screen.getByTestId('charge-frequency-select-option-trimestriel'));

  await fireEvent.changeText(screen.getByPlaceholderText('Ex. Internet, Loyer, École'), 'Assurance');
  await fireEvent.press(screen.getByText('Confirmé'));
  await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '450');

  await fireEvent.press(screen.getByTestId('create-charge-submit'));

  await waitFor(() =>
    expect(mockedApi.createChargePlan).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Assurance', recurrenceRule: 'trimestriel', recurrenceAnchorDate: expect.any(String) }),
    ),
  );
  expect(mockGoBack).toHaveBeenCalled();
});

it('R6.2 §1 : la même date pilote la première échéance ET l\'ancre de récurrence (jamais un jour du mois séparé)', async () => {
  mockedApi.createChargePlan.mockResolvedValue({ id: 'cp1' });
  mockedApi.createDeadline.mockResolvedValue({ id: 'd1' });
  await render(<CreateChargeScreen />);
  await waitFor(() => screen.getByTestId('charge-frequency-select'));

  await fireEvent.changeText(screen.getByPlaceholderText('Ex. Internet, Loyer, École'), 'Internet');
  await fireEvent.press(screen.getByText('Confirmé'));
  await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '299');
  await fireEvent.press(screen.getByTestId('create-charge-submit'));

  await waitFor(() => expect(mockedApi.createChargePlan).toHaveBeenCalled());
  const [payload] = mockedApi.createChargePlan.mock.calls[0];
  expect(payload.recurrenceAnchorDate).toBe(payload.startDate);
});
