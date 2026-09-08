import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccountsScreen } from '../AccountsScreen';
import * as api from '../../../api/client';

/**
 * R5 clôture §2 — un compte archivé reste visible dans la liste des comptes
 * (pour pouvoir le réactiver depuis son détail), avec un badge explicite —
 * jamais silencieusement disparu.
 */
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { ...actual, listAllAccounts: jest.fn(), createAccount: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
});

it('liste tous les comptes (via listAllAccounts) et affiche un badge "Archivé" pour les comptes archivés', async () => {
  mockedApi.listAllAccounts.mockResolvedValue([
    { id: 'a1', name: 'Compte actif', type: 'courant', status: 'actif', soldeCourant: 1000, isFavorite: false },
    { id: 'a2', name: 'Vieux compte', type: 'epargne', status: 'archive', soldeCourant: 500, isFavorite: false },
  ]);

  await render(<AccountsScreen />);

  await waitFor(() => expect(screen.getByText('Compte actif')).toBeTruthy());
  expect(screen.getByText('Vieux compte')).toBeTruthy();
  expect(screen.getByText(/Archivé/)).toBeTruthy();
  expect(mockedApi.listAllAccounts).toHaveBeenCalled();
});

it('R6.1 §10 : un compte exclu du pilotage affiche un badge "Hors pilotage" (jamais masqué)', async () => {
  mockedApi.listAllAccounts.mockResolvedValue([
    { id: 'a3', name: 'Livret bloqué', type: 'epargne', status: 'actif', soldeCourant: 5000, isFavorite: false, includeInOperationalTreasury: false },
  ]);

  await render(<AccountsScreen />);

  await waitFor(() => expect(screen.getByText('Livret bloqué')).toBeTruthy());
  expect(screen.getByText('Hors pilotage')).toBeTruthy();
});

it('R6.1 §8 : la bascule "Inclure ce compte dans ma situation financière" est activée par défaut et transmise à la création', async () => {
  mockedApi.listAllAccounts.mockResolvedValue([]);
  mockedApi.createAccount.mockResolvedValue({});
  await render(<AccountsScreen />);
  await waitFor(() => screen.getByTestId('account-create-pilotage-switch'));

  await fireEvent.changeText(screen.getByPlaceholderText('Nom (ex. Compte principal)'), 'Nouveau compte');
  await fireEvent.press(screen.getByText('+'));

  await waitFor(() =>
    expect(mockedApi.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Nouveau compte', includeInOperationalTreasury: true }),
    ),
  );
});

it('R6.1 §8 : désactiver la bascule avant création exclut le compte du pilotage', async () => {
  mockedApi.listAllAccounts.mockResolvedValue([]);
  mockedApi.createAccount.mockResolvedValue({});
  await render(<AccountsScreen />);
  await waitFor(() => screen.getByTestId('account-create-pilotage-switch'));

  await fireEvent(screen.getByTestId('account-create-pilotage-switch'), 'valueChange', false);
  await fireEvent.changeText(screen.getByPlaceholderText('Nom (ex. Compte principal)'), 'Livret bloqué');
  await fireEvent.press(screen.getByText('+'));

  await waitFor(() =>
    expect(mockedApi.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Livret bloqué', includeInOperationalTreasury: false }),
    ),
  );
});
