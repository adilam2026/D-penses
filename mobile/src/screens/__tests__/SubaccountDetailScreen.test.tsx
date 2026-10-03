import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SubaccountDetailScreen } from '../SubaccountDetailScreen';

const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, replace: mockReplace, goBack: mockGoBack }),
  useRoute: () => ({ params: { id: 'voiture' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockListAccounts = jest.fn();
const mockListFinancialOperations = jest.fn();
const mockListGoals = jest.fn();
jest.mock('../../api/client', () => ({
  listAccounts: () => mockListAccounts(),
  listFinancialOperations: (...args: unknown[]) => mockListFinancialOperations(...args),
  listGoals: () => mockListGoals(),
  renameSubaccount: jest.fn(),
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
  mockListFinancialOperations.mockResolvedValue([]);
  mockListGoals.mockResolvedValue([]);
});

it('affiche "Disponible" + "Rattaché à {compte}" (jamais "Solde")', async () => {
  mockListAccounts.mockResolvedValue([
    { id: 'cih', name: 'CIH', bank: null, type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 20000, nonAffecte: 15000, subaccounts: [{ id: 'voiture', accountId: 'cih', name: 'CIH-Voiture', active: true, balance: 5000 }] },
  ]);
  renderWithSafeArea(<SubaccountDetailScreen />);
  await waitFor(() => expect(screen.getByText('CIH-Voiture')).toBeTruthy());
  expect(screen.getByText('Rattaché à CIH')).toBeTruthy();
  expect(screen.getByText('Disponible')).toBeTruthy();
  expect(screen.queryByText('Solde')).toBeNull();
});

it('menu ⋯ propose "Ajouter de l\'argent" en plus de Modifier/Ajouter une transaction', async () => {
  mockListAccounts.mockResolvedValue([
    { id: 'cih', name: 'CIH', bank: null, type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 20000, nonAffecte: 15000, subaccounts: [{ id: 'voiture', accountId: 'cih', name: 'CIH-Voiture', active: true, balance: 5000 }] },
  ]);
  renderWithSafeArea(<SubaccountDetailScreen />);
  await waitFor(() => screen.getByTestId('subaccount-detail-menu'));
  fireEvent.press(screen.getByTestId('subaccount-detail-menu'));
  await waitFor(() => screen.getByTestId('subaccount-detail-choice-sheet-option-add-money'));
  fireEvent.press(screen.getByTestId('subaccount-detail-choice-sheet-option-add-money'));
  expect(mockNavigate).toHaveBeenCalledWith('Tabs', {
    screen: 'Ajouter',
    params: { prefill: { kind: 'SAVINGS_CONTRIBUTION', destinationAccountId: 'cih', destinationSubaccountId: 'voiture' } },
  });
});

it('le sous-compte "Santé" redirige vers Health (jamais cet écran générique)', async () => {
  mockListAccounts.mockResolvedValue([
    { id: 'cih', name: 'CIH', bank: null, type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 3000, nonAffecte: 0, subaccounts: [{ id: 'voiture', accountId: 'cih', name: 'CIH-Santé', active: true, balance: 3000 }] },
  ]);
  renderWithSafeArea(<SubaccountDetailScreen />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('Health', { id: 'voiture' }));
});
