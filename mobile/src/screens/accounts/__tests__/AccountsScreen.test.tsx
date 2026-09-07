import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
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
  return { ...actual, listAllAccounts: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

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
