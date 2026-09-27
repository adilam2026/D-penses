import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AccueilScreen } from '../AccueilScreen';
import { clearCache } from '../../state/cache';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockListAccounts = jest.fn();
jest.mock('../../api/client', () => ({
  listAccounts: () => mockListAccounts(),
}));

const TEST_INSET_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderWithSafeArea(ui: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={TEST_INSET_METRICS}>{ui}</SafeAreaProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
});

it('affiche le disponible libre (somme des non-affectés) et les comptes avec leurs sous-comptes', async () => {
  mockListAccounts.mockResolvedValue([
    {
      id: 'cih', name: 'CIH', bank: 'CIH Bank', type: 'COURANT', ownerMemberId: null, ownerLabel: null,
      balance: 20000, nonAffecte: 8000,
      subaccounts: [
        { id: 'voiture', accountId: 'cih', name: 'CIH-Voiture', balance: 5000 },
        { id: 'voyage', accountId: 'cih', name: 'CIH-Voyage', balance: 4000 },
        { id: 'sante', accountId: 'cih', name: 'CIH-Santé', balance: 3000 },
      ],
    },
    {
      id: 'bp', name: 'BP Lamiaa', bank: 'Banque Populaire', type: 'COURANT', ownerMemberId: null, ownerLabel: null,
      balance: 25000, nonAffecte: 25000, subaccounts: [],
    },
  ]);

  renderWithSafeArea(<AccueilScreen />);

  await waitFor(() => expect(screen.getByText(/33 000/)).toBeTruthy()); // 8000 + 25000 disponible libre
  expect(screen.getByText('CIH')).toBeTruthy();
  expect(screen.getByText('BP Lamiaa')).toBeTruthy();
  expect(screen.getByText('CIH-Voiture')).toBeTruthy();
  expect(screen.getByText('Non affecté')).toBeTruthy();
});

it('état vide : aucun compte -> message et pas de crash', async () => {
  mockListAccounts.mockResolvedValue([]);
  renderWithSafeArea(<AccueilScreen />);
  await waitFor(() => expect(screen.getByText(/Aucun compte/)).toBeTruthy());
});

it("ouvre le menu au tap sur l'icône menu", async () => {
  mockListAccounts.mockResolvedValue([]);
  renderWithSafeArea(<AccueilScreen />);
  await waitFor(() => screen.getByText('Accueil'));
  fireEvent.press(screen.getByTestId('accueil-menu-button'));
  expect(mockNavigate).toHaveBeenCalledWith('Menu');
});
