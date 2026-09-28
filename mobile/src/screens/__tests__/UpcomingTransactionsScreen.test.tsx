import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { UpcomingTransactionsScreen } from '../UpcomingTransactionsScreen';

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockListPlannedOperations = jest.fn();
const mockListAccounts = jest.fn();
const mockCancelPlannedOperation = jest.fn();
jest.mock('../../api/client', () => ({
  listPlannedOperations: () => mockListPlannedOperations(),
  listAccounts: () => mockListAccounts(),
  cancelPlannedOperation: (...args: unknown[]) => mockCancelPlannedOperation(...args),
  updatePlannedOperation: jest.fn(),
  realizePlannedOperation: jest.fn(),
}));

function renderWithSafeArea(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>{ui}</SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListAccounts.mockResolvedValue([
    { id: 'cih', name: 'CIH', bank: null, type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 5000, nonAffecte: 5000, subaccounts: [] },
  ]);
});

it("Item 3 : liste chronologique groupée par mois, tap ouvre les 3 actions explicites", async () => {
  mockListPlannedOperations.mockResolvedValue([
    { id: 'p1', kind: 'EXPENSE', label: 'Assurance', expectedDate: '2026-10-05', expectedAmount: 800, categoryId: null, sourceAccountId: 'cih', sourceSubaccountId: null, destinationAccountId: null, destinationSubaccountId: null, status: 'PENDING', realizedOperationId: null },
    { id: 'p2', kind: 'INCOME', label: 'Salaire', expectedDate: '2026-11-01', expectedAmount: 12000, categoryId: null, sourceAccountId: null, sourceSubaccountId: null, destinationAccountId: 'cih', destinationSubaccountId: null, status: 'PENDING', realizedOperationId: null },
    { id: 'p3', kind: 'EXPENSE', label: 'Déjà réalisé', expectedDate: '2026-09-01', expectedAmount: 100, categoryId: null, sourceAccountId: 'cih', sourceSubaccountId: null, destinationAccountId: null, destinationSubaccountId: null, status: 'REALIZED', realizedOperationId: 'op-x' },
  ]);

  renderWithSafeArea(<UpcomingTransactionsScreen />);
  await waitFor(() => screen.getByText('Assurance'));
  expect(screen.getByText('Salaire')).toBeTruthy();
  // Seules les opérations PENDING apparaissent (jamais une déjà réalisée).
  expect(screen.queryByText('Déjà réalisé')).toBeNull();
  expect(screen.getByText('Octobre 2026')).toBeTruthy();
  expect(screen.getByText('Novembre 2026')).toBeTruthy();

  fireEvent.press(screen.getByTestId('upcoming-transaction-p1'));
  await waitFor(() => screen.getByTestId('planned-op-cancel'));
  expect(screen.getByText('Modifier la transaction')).toBeTruthy();
  expect(screen.getByText('Annuler la transaction')).toBeTruthy();
  expect(screen.getByTestId('planned-op-close')).toBeTruthy();

  fireEvent.press(screen.getByTestId('planned-op-cancel'));
  await waitFor(() => screen.getByTestId('planned-op-cancel-confirm'));
  fireEvent.press(screen.getByTestId('planned-op-cancel-confirm'));
  await waitFor(() => expect(mockCancelPlannedOperation).toHaveBeenCalledWith('p1'));
});

it('aucune transaction à venir -> message explicite, jamais un tableau vide silencieux', async () => {
  mockListPlannedOperations.mockResolvedValue([]);
  renderWithSafeArea(<UpcomingTransactionsScreen />);
  await waitFor(() => screen.getByText('Aucune transaction à venir.'));
});
