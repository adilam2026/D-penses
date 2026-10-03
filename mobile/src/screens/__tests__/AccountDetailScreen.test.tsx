import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AccountDetailScreen } from '../AccountDetailScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { id: 'cih' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockGetAccount = jest.fn();
const mockListFinancialOperations = jest.fn();
const mockListGoals = jest.fn();
const mockRenameAccount = jest.fn();
const mockUpdateAccount = jest.fn();
jest.mock('../../api/client', () => ({
  getAccount: (...args: unknown[]) => mockGetAccount(...args),
  listFinancialOperations: (...args: unknown[]) => mockListFinancialOperations(...args),
  listGoals: () => mockListGoals(),
  renameAccount: (...args: unknown[]) => mockRenameAccount(...args),
  updateAccount: (...args: unknown[]) => mockUpdateAccount(...args),
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
  mockListGoals.mockResolvedValue([]);
  mockGetAccount.mockResolvedValue({ id: 'cih', name: 'CIH', bank: 'CIH Bank', type: 'COURANT', ownerMemberId: null, ownerLabel: null, active: true, balance: 20000, nonAffecte: 8000, subaccounts: [] });
  mockListFinancialOperations.mockResolvedValue([
    { id: 'op1', kind: 'EXPENSE', label: 'Réparation', date: '2026-09-10', amount: 700, categoryId: null, sourceAccountId: 'cih', sourceSubaccountId: null, destinationAccountId: null, destinationSubaccountId: null, budgetImpact: 'NORMAL', reversalOfOperationId: null, reversalReason: null, createdAt: '2026-09-10', ledgerEntries: [{ id: 'le1', accountId: 'cih', subaccountId: null, amount: -700, affectsAccountBalance: true }] },
  ]);
});

it("écran très simple : nom, solde, historique — rien d'autre", async () => {
  renderWithSafeArea(<AccountDetailScreen />);
  await waitFor(() => expect(screen.getByText('CIH')).toBeTruthy());
  expect(screen.getByText('Compte bancaire')).toBeTruthy();
  expect(screen.getByText('Solde')).toBeTruthy();
  expect(screen.getByText(/20 000/)).toBeTruthy();
  expect(screen.getByText('Réparation')).toBeTruthy();
});

it('menu ⋯ -> Ajouter une transaction navigue vers Ajouter avec le compte pré-rempli', async () => {
  renderWithSafeArea(<AccountDetailScreen />);
  await waitFor(() => screen.getByTestId('account-detail-menu'));
  fireEvent.press(screen.getByTestId('account-detail-menu'));
  await waitFor(() => screen.getByTestId('account-detail-choice-sheet-option-add-transaction'));
  fireEvent.press(screen.getByTestId('account-detail-choice-sheet-option-add-transaction'));
  expect(mockNavigate).toHaveBeenCalledWith('Tabs', { screen: 'Ajouter', params: { prefill: { sourceAccountId: 'cih' } } });
});

it('menu ⋯ -> Modifier renomme le compte', async () => {
  mockRenameAccount.mockResolvedValue({});
  renderWithSafeArea(<AccountDetailScreen />);
  await waitFor(() => screen.getByTestId('account-detail-menu'));
  fireEvent.press(screen.getByTestId('account-detail-menu'));
  await waitFor(() => screen.getByTestId('account-detail-choice-sheet-option-edit'));
  fireEvent.press(screen.getByTestId('account-detail-choice-sheet-option-edit'));
  await waitFor(() => screen.getByTestId('rename-modal-input'));
  fireEvent.changeText(screen.getByTestId('rename-modal-input'), 'CIH Bank Renommé');
  await waitFor(() => expect(screen.getByTestId('rename-modal-input').props.value).toBe('CIH Bank Renommé'));
  fireEvent.press(screen.getByTestId('rename-modal-submit'));
  await waitFor(() => expect(mockRenameAccount).toHaveBeenCalledWith('cih', 'CIH Bank Renommé'));
});

// §8 — désactivation logique (jamais de suppression), badge "Désactivé" et blocage des nouvelles opérations.
it('menu ⋯ -> Désactiver appelle updateAccount({active:false}) puis affiche "Désactivé" et bloque "Ajouter une transaction"', async () => {
  mockUpdateAccount.mockResolvedValue({});
  renderWithSafeArea(<AccountDetailScreen />);
  await waitFor(() => screen.getByTestId('account-detail-menu'));
  fireEvent.press(screen.getByTestId('account-detail-menu'));
  await waitFor(() => screen.getByTestId('account-detail-choice-sheet-option-deactivate'));

  mockGetAccount.mockResolvedValue({ id: 'cih', name: 'CIH', bank: 'CIH Bank', type: 'COURANT', ownerMemberId: null, ownerLabel: null, active: false, balance: 20000, nonAffecte: 8000, subaccounts: [] });
  fireEvent.press(screen.getByTestId('account-detail-choice-sheet-option-deactivate'));
  await waitFor(() => expect(mockUpdateAccount).toHaveBeenCalledWith('cih', { active: false }));

  await waitFor(() => expect(screen.getByText(/Désactivé/)).toBeTruthy());
  fireEvent.press(screen.getByTestId('account-detail-menu'));
  await waitFor(() => screen.getByTestId('account-detail-choice-sheet-option-reactivate'));
  expect(screen.getByTestId('account-detail-choice-sheet-option-add-transaction').props.accessibilityState?.disabled).toBe(true);
});
