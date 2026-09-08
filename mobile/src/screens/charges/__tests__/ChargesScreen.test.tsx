import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ChargesScreen } from '../ChargesScreen';
import * as api from '../../../api/client';

/**
 * Recette post-Vague 3 (§6/§7) — liste compacte des charges récurrentes,
 * séparée de la création, charges arrêtées repliées mais accessibles.
 */
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
  return { ...actual, listChargePlans: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
});

it('"+ Ajouter une charge" navigue vers l\'écran de création dédié (jamais un formulaire permanent)', async () => {
  mockedApi.listChargePlans.mockResolvedValue([]);
  await render(<ChargesScreen />);
  await waitFor(() => screen.getByTestId('add-charge-button'));

  await fireEvent.press(screen.getByTestId('add-charge-button'));

  expect(mockNavigate).toHaveBeenCalledWith('CreateCharge');
});

it('affiche une ligne compacte (libellé, fréquence, prochaine échéance) et tap → détail', async () => {
  mockedApi.listChargePlans.mockResolvedValue([
    {
      id: 'cp1',
      label: 'Internet',
      recurrenceRule: 'mensuel',
      status: 'actif',
      deadlines: [{ id: 'd1', dueDate: '2026-09-16', amountStatus: 'confirme', resteAPayer: 299 }],
    },
  ]);
  await render(<ChargesScreen />);
  await waitFor(() => screen.getByText('Internet'));

  expect(screen.getByText(/Mensuel/)).toBeTruthy();
  expect(screen.getByText(/Confirmé/)).toBeTruthy();

  await fireEvent.press(screen.getByTestId('charge-row-cp1'));
  expect(mockNavigate).toHaveBeenCalledWith('ChargePlanDetail', { id: 'cp1' });
});

it('R6.2 §2 / TEST G : resteAPayer absent de la réponse (undefined) — jamais "NaN DH" pour un montant connu', async () => {
  // Reproduit le bug réel observé sur APK Samsung : le backend omettait
  // resteAPayer sur la prochaine échéance retournée par GET /charge-plans
  // (undefined, pas null) alors que amountStatus/le montant sous-jacent
  // étaient bien connus — Number(undefined) donnait "NaN DH" à l'affichage.
  mockedApi.listChargePlans.mockResolvedValue([
    {
      id: 'cp1',
      label: 'Loyer',
      recurrenceRule: 'mensuel',
      status: 'actif',
      deadlines: [{ id: 'd1', dueDate: '2026-09-16', amountStatus: 'confirme', resteAPayer: undefined }],
    },
  ]);
  await render(<ChargesScreen />);
  await waitFor(() => screen.getByText('Loyer'));

  expect(screen.queryByText(/NaN/)).toBeNull();
});

it('R6.2 §2 / TEST H : montant réellement inconnu affiché explicitement ("Montant inconnu"), jamais NaN ni vide silencieux', async () => {
  mockedApi.listChargePlans.mockResolvedValue([
    {
      id: 'cp1',
      label: 'Assurance moto',
      recurrenceRule: 'annuel',
      status: 'actif',
      deadlines: [{ id: 'd1', dueDate: '2026-12-01', amountStatus: 'inconnu', resteAPayer: null }],
    },
  ]);
  await render(<ChargesScreen />);
  await waitFor(() => screen.getByText('Assurance moto'));

  expect(screen.getByText('Montant inconnu')).toBeTruthy();
  expect(screen.queryByText(/NaN/)).toBeNull();
});

it('les charges arrêtées (status=inactif) restent accessibles, repliées par défaut', async () => {
  mockedApi.listChargePlans.mockResolvedValue([
    { id: 'cp1', label: 'Actif', recurrenceRule: 'mensuel', status: 'actif', deadlines: [] },
    { id: 'cp2', label: 'Arrêté', recurrenceRule: 'mensuel', status: 'inactif', deadlines: [] },
  ]);
  await render(<ChargesScreen />);
  await waitFor(() => screen.getByText('Actif'));

  expect(screen.queryByText('Arrêté')).toBeNull();
  expect(screen.getByText(/charges arrêtées \(1\)/)).toBeTruthy();

  await fireEvent.press(screen.getByTestId('toggle-inactive-charges'));
  expect(screen.getByText('Arrêté')).toBeTruthy();
});
