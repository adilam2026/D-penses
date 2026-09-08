import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QuickCreateAccountScreen } from '../QuickCreateAccountScreen';
import * as api from '../../../api/client';
import { accountCreatedBus } from '../../../state/events';

/**
 * R6.1 §8 — la création rapide de compte (accessible depuis un formulaire
 * bloqué par un prérequis manquant) doit proposer la même bascule de
 * pilotage que l'écran Comptes, jamais un système parallèle sans ce champ.
 */
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { ...actual, createAccount: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
});

it('crée un compte avec includeInOperationalTreasury=true par défaut', async () => {
  mockedApi.createAccount.mockResolvedValue({ id: 'acc1', name: 'Compte principal' });
  const busSpy = jest.spyOn(accountCreatedBus, 'emit');
  await render(<QuickCreateAccountScreen />);

  await fireEvent.changeText(screen.getByTestId('quickcreate-account-name-input'), 'Compte principal');
  await fireEvent.press(screen.getByTestId('quickcreate-account-submit'));

  await waitFor(() =>
    expect(mockedApi.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Compte principal', includeInOperationalTreasury: true }),
    ),
  );
  expect(busSpy).toHaveBeenCalledWith({ id: 'acc1', name: 'Compte principal', type: 'courant' });
  expect(mockGoBack).toHaveBeenCalled();
});

it('R6.1 §8 : désactiver la bascule "Inclure ce compte dans ma situation financière" exclut le compte à la création', async () => {
  mockedApi.createAccount.mockResolvedValue({ id: 'acc2', name: 'Livret bloqué' });
  await render(<QuickCreateAccountScreen />);

  await fireEvent(screen.getByTestId('quickcreate-account-pilotage-switch'), 'valueChange', false);
  await fireEvent.changeText(screen.getByTestId('quickcreate-account-name-input'), 'Livret bloqué');
  await fireEvent.press(screen.getByTestId('quickcreate-account-submit'));

  await waitFor(() =>
    expect(mockedApi.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Livret bloqué', includeInOperationalTreasury: false }),
    ),
  );
});
