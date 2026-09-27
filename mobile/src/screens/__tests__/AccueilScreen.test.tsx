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
const mockListPlannedOperations = jest.fn();
const mockListMedicalClaims = jest.fn();
const mockRealizePlannedOperation = jest.fn();
jest.mock('../../api/client', () => ({
  listAccounts: () => mockListAccounts(),
  listPlannedOperations: () => mockListPlannedOperations(),
  listMedicalClaims: () => mockListMedicalClaims(),
  realizePlannedOperation: (...args: unknown[]) => mockRealizePlannedOperation(...args),
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
  mockListPlannedOperations.mockResolvedValue([]);
  mockListMedicalClaims.mockResolvedValue([]);
});

it("n'affiche aucune métrique globale inventée, mais les comptes avec leurs sous-comptes et le non-affecté", async () => {
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

  await waitFor(() => expect(screen.getByText('CIH')).toBeTruthy());
  expect(screen.getByText('BP Lamiaa')).toBeTruthy();
  expect(screen.getByText('CIH-Voiture')).toBeTruthy();
  expect(screen.getByText('Non affecté')).toBeTruthy();
  // Pas de "Disponible libre" (hero métrique retirée par l'audit maquette).
  expect(screen.queryByText(/Disponible libre/)).toBeNull();
});

it('état vide : aucun compte -> message et pas de crash', async () => {
  mockListAccounts.mockResolvedValue([]);
  renderWithSafeArea(<AccueilScreen />);
  await waitFor(() => expect(screen.getByText(/Aucun compte/)).toBeTruthy());
});

it('tap sur un compte -> navigue vers AccountDetail', async () => {
  mockListAccounts.mockResolvedValue([
    { id: 'bp', name: 'BP Lamiaa', bank: null, type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 25000, nonAffecte: 25000, subaccounts: [] },
  ]);
  renderWithSafeArea(<AccueilScreen />);
  await waitFor(() => screen.getByTestId('accueil-account-bp'));
  fireEvent.press(screen.getByTestId('accueil-account-bp'));
  expect(mockNavigate).toHaveBeenCalledWith('AccountDetail', { id: 'bp' });
});

it('tap sur le sous-compte Santé -> navigue directement vers Health (jamais SubaccountDetail générique)', async () => {
  mockListAccounts.mockResolvedValue([
    {
      id: 'cih', name: 'CIH', bank: null, type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 3000, nonAffecte: 0,
      subaccounts: [{ id: 'sante', accountId: 'cih', name: 'CIH-Santé', balance: 3000 }],
    },
  ]);
  renderWithSafeArea(<AccueilScreen />);
  await waitFor(() => screen.getByTestId('accueil-subaccount-sante'));
  fireEvent.press(screen.getByTestId('accueil-subaccount-sante'));
  expect(mockNavigate).toHaveBeenCalledWith('Health', { id: 'sante' });
});

it('tap sur un sous-compte non-Santé -> navigue vers SubaccountDetail', async () => {
  mockListAccounts.mockResolvedValue([
    {
      id: 'cih', name: 'CIH', bank: null, type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 5000, nonAffecte: 0,
      subaccounts: [{ id: 'voiture', accountId: 'cih', name: 'CIH-Voiture', balance: 5000 }],
    },
  ]);
  renderWithSafeArea(<AccueilScreen />);
  await waitFor(() => screen.getByTestId('accueil-subaccount-voiture'));
  fireEvent.press(screen.getByTestId('accueil-subaccount-voiture'));
  expect(mockNavigate).toHaveBeenCalledWith('SubaccountDetail', { id: 'voiture' });
});

it('section "À faire" : échéance prévue en attente -> carte avec action Payer qui réalise l\'opération', async () => {
  mockListAccounts.mockResolvedValue([]);
  mockListPlannedOperations.mockResolvedValue([
    { id: 'p1', kind: 'EXPENSE', label: 'Voyage Été', expectedDate: '2020-01-01', expectedAmount: 8000, categoryId: null, sourceAccountId: 'cih', sourceSubaccountId: null, destinationAccountId: null, destinationSubaccountId: null, status: 'PENDING', realizedOperationId: null },
  ]);
  mockRealizePlannedOperation.mockResolvedValue({});

  renderWithSafeArea(<AccueilScreen />);
  await waitFor(() => screen.getByText('Voyage Été'));
  expect(screen.getByText('Payer')).toBeTruthy();
  fireEvent.press(screen.getByTestId('accueil-action-planned-p1'));
  await waitFor(() => expect(mockRealizePlannedOperation).toHaveBeenCalledWith('p1', { actualAmount: '8000' }));
});

it('section "À faire" : dossier santé en attente -> carte "Voir" qui navigue vers Health', async () => {
  mockListAccounts.mockResolvedValue([]);
  mockListMedicalClaims.mockResolvedValue([
    { id: 'claim1', sourceOperationId: 'op1', subaccountId: 'sante', label: 'Consultation', amountEngaged: 700, amountReimbursed: 0, reste: 700, status: 'PENDING', closedAt: null, createdAt: '2026-01-01', reimbursements: [] },
  ]);

  renderWithSafeArea(<AccueilScreen />);
  await waitFor(() => screen.getByText('Consultation'));
  fireEvent.press(screen.getByTestId('accueil-action-claim-claim1'));
  expect(mockNavigate).toHaveBeenCalledWith('Health', { id: 'sante' });
});
