import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TransactionDetailScreen } from '../TransactionDetailScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams = { id: 'op-1', accountId: 'cih' };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: mockRouteParams }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockGetFinancialOperation = jest.fn();
const mockListAccounts = jest.fn();
const mockListCategories = jest.fn();
const mockCancelFinancialOperation = jest.fn();
const mockCorrectFinancialOperation = jest.fn();
jest.mock('../../api/client', () => ({
  getFinancialOperation: (...args: unknown[]) => mockGetFinancialOperation(...args),
  listAccounts: () => mockListAccounts(),
  listCategories: () => mockListCategories(),
  cancelFinancialOperation: (...args: unknown[]) => mockCancelFinancialOperation(...args),
  correctFinancialOperation: (...args: unknown[]) => mockCorrectFinancialOperation(...args),
}));

function renderWithSafeArea(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>{ui}</SafeAreaProvider>,
  );
}

const baseOperation = {
  id: 'op-1',
  kind: 'EXPENSE' as const,
  label: 'Courses',
  date: '2026-09-20',
  amount: 800,
  categoryId: 'cat-courses',
  sourceAccountId: 'cih',
  sourceSubaccountId: null,
  destinationAccountId: null,
  destinationSubaccountId: null,
  budgetImpact: 'NORMAL' as const,
  reversalOfOperationId: null,
  reversalReason: null,
  correctionOfOperationId: null,
  createdAt: '2026-09-20',
  ledgerEntries: [{ id: 'le-1', accountId: 'cih', subaccountId: null, amount: -800, affectsAccountBalance: true }],
  reversals: [],
  reversalOfOperation: null,
  correctedByOperations: [],
  correctionOfOperation: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = { id: 'op-1', accountId: 'cih' };
  mockListAccounts.mockResolvedValue([{ id: 'cih', name: 'CIH', bank: null, type: 'COURANT', ownerMemberId: null, ownerLabel: null, active: true, balance: 20000, nonAffecte: 20000, subaccounts: [] }]);
  mockListCategories.mockResolvedValue([{ id: 'cat-courses', name: 'Courses', active: true, sortOrder: 0, isDefaultFallback: false }]);
});

it('affiche type/montant/date/libellé/catégorie/compte/statut', async () => {
  mockGetFinancialOperation.mockResolvedValue(baseOperation);
  renderWithSafeArea(<TransactionDetailScreen />);

  await waitFor(() => expect(screen.getAllByText('Courses').length).toBeGreaterThan(0));
  expect(screen.getByText('Dépense')).toBeTruthy();
  expect(screen.getByText('CIH')).toBeTruthy();
  expect(screen.getByText('Réalisée')).toBeTruthy();
  expect(screen.getByText(/800 DH/)).toBeTruthy();
});

it('Annuler ouvre une confirmation puis appelle cancelFinancialOperation (jamais de suppression physique)', async () => {
  mockGetFinancialOperation.mockResolvedValue(baseOperation);
  mockCancelFinancialOperation.mockResolvedValue({ ...baseOperation, id: 'op-1-reversal' });
  renderWithSafeArea(<TransactionDetailScreen />);

  await waitFor(() => screen.getByTestId('transaction-detail-cancel'));
  fireEvent.press(screen.getByTestId('transaction-detail-cancel'));
  await waitFor(() => screen.getByTestId('transaction-cancel-confirm-yes'));
  fireEvent.press(screen.getByTestId('transaction-cancel-confirm-yes'));

  await waitFor(() => expect(mockCancelFinancialOperation).toHaveBeenCalledWith('op-1'));
});

it('Modifier pré-remplit le formulaire et appelle correctFinancialOperation avec les nouvelles valeurs', async () => {
  mockGetFinancialOperation.mockResolvedValue(baseOperation);
  mockCorrectFinancialOperation.mockResolvedValue({});
  renderWithSafeArea(<TransactionDetailScreen />);

  await waitFor(() => screen.getByTestId('transaction-detail-modify'));
  fireEvent.press(screen.getByTestId('transaction-detail-modify'));
  await waitFor(() => screen.getByTestId('transaction-correct-submit'));

  expect(screen.getByTestId('transaction-correct-label').props.value).toBe('Courses');
  expect(screen.getByTestId('transaction-correct-amount').props.value).toBe('800');

  const amountField = screen.getByTestId('transaction-correct-amount');
  fireEvent.changeText(amountField, '650');
  await waitFor(() => expect(amountField.props.value).toBe('650'));
  fireEvent.press(screen.getByTestId('transaction-correct-submit'));

  await waitFor(() =>
    expect(mockCorrectFinancialOperation).toHaveBeenCalledWith('op-1', expect.objectContaining({ label: 'Courses', amount: '650' })),
  );
});

it('une opération déjà annulée ne propose plus Modifier/Annuler (double-action impossible)', async () => {
  mockGetFinancialOperation.mockResolvedValue({ ...baseOperation, reversals: [{ ...baseOperation, id: 'op-1-rev', reversalOfOperationId: 'op-1' }] });
  renderWithSafeArea(<TransactionDetailScreen />);

  await waitFor(() => expect(screen.getAllByText('Courses').length).toBeGreaterThan(0));
  expect(screen.queryByTestId('transaction-detail-cancel')).toBeNull();
  expect(screen.queryByTestId('transaction-detail-modify')).toBeNull();
  expect(screen.getByText('Annulée')).toBeTruthy();
});

it('un renversement lui-même ne propose ni Modifier ni Annuler', async () => {
  mockGetFinancialOperation.mockResolvedValue({ ...baseOperation, id: 'op-1-rev', reversalOfOperationId: 'op-1', reversalReason: 'Doublon' });
  renderWithSafeArea(<TransactionDetailScreen />);

  await waitFor(() => expect(screen.getAllByText('Courses').length).toBeGreaterThan(0));
  expect(screen.queryByTestId('transaction-detail-cancel')).toBeNull();
  expect(screen.queryByTestId('transaction-detail-modify')).toBeNull();
  expect(screen.getByText(/Annulation/)).toBeTruthy();
});
