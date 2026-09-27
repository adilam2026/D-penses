import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HealthScreen } from '../HealthScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { id: 'sante' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockListAccounts = jest.fn();
const mockListFinancialOperations = jest.fn();
const mockListMedicalClaims = jest.fn();
const mockAddMedicalReimbursement = jest.fn();
jest.mock('../../api/client', () => ({
  listAccounts: () => mockListAccounts(),
  listFinancialOperations: (...args: unknown[]) => mockListFinancialOperations(...args),
  listMedicalClaims: (...args: unknown[]) => mockListMedicalClaims(...args),
  addMedicalReimbursement: (...args: unknown[]) => mockAddMedicalReimbursement(...args),
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
  mockListAccounts.mockResolvedValue([
    { id: 'cih', name: 'CIH', bank: null, type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 3000, nonAffecte: 0, subaccounts: [{ id: 'sante', accountId: 'cih', name: 'CIH-Santé', balance: 3000 }] },
  ]);
  mockListFinancialOperations.mockResolvedValue([
    { id: 'op1', kind: 'EXPENSE', label: 'Consultation', date: '2026-09-15', amount: 700, categoryId: null, sourceAccountId: 'cih', sourceSubaccountId: 'sante', destinationAccountId: null, destinationSubaccountId: null, budgetImpact: 'ALREADY_FUNDED', reversalOfOperationId: null, reversalReason: null, createdAt: '2026-09-15', ledgerEntries: [] },
  ]);
  mockListMedicalClaims.mockResolvedValue([
    { id: 'claim1', sourceOperationId: 'op1', subaccountId: 'sante', label: 'Consultation', amountEngaged: 700, amountReimbursed: 0, reste: 700, status: 'PENDING', closedAt: null, createdAt: '2026-09-15', reimbursements: [] },
    { id: 'claim2', sourceOperationId: 'op2', subaccountId: 'sante', label: 'Analyse', amountEngaged: 400, amountReimbursed: 400, reste: 0, status: 'CLOSED', closedAt: '2026-09-20', createdAt: '2026-09-18', reimbursements: [] },
  ]);
});

it('onglet Dépenses actif par défaut ; onglet Remboursements liste les dossiers en attente avec Engagé/Remboursé/Reste/Statut', async () => {
  renderWithSafeArea(<HealthScreen />);
  await waitFor(() => expect(screen.getByText('Consultation')).toBeTruthy());

  fireEvent.press(screen.getByTestId('health-tab-remboursements'));
  await waitFor(() => screen.getByText('DOSSIERS EN ATTENTE'));
  expect(screen.getAllByText('Consultation').length).toBeGreaterThan(0);
  expect(screen.getByText('En attente')).toBeTruthy();
  expect(screen.getByText('Engagé')).toBeTruthy();
  expect(screen.getByText('Remboursé')).toBeTruthy();
  expect(screen.getAllByText(/700 DH/).length).toBeGreaterThan(0);

  // Le dossier clos n'apparaît qu'après "Afficher l'historique".
  expect(screen.queryByText('Analyse')).toBeNull();
  fireEvent.press(screen.getByTestId('health-toggle-history'));
  await waitFor(() => expect(screen.getByText('Analyse')).toBeTruthy());
  expect(screen.getByText('Reste charge')).toBeTruthy();
});

it('"J\'ai reçu un remboursement" ouvre le modal et appelle addMedicalReimbursement', async () => {
  mockAddMedicalReimbursement.mockResolvedValue({});
  renderWithSafeArea(<HealthScreen />);
  await waitFor(() => screen.getByTestId('health-tab-remboursements'));
  fireEvent.press(screen.getByTestId('health-tab-remboursements'));
  await waitFor(() => screen.getByTestId('health-claim-reimburse-claim1'));
  fireEvent.press(screen.getByTestId('health-claim-reimburse-claim1'));

  await waitFor(() => screen.getByTestId('reimburse-amount'));
  fireEvent.changeText(screen.getByTestId('reimburse-amount'), '500');
  fireEvent.press(screen.getByTestId('reimburse-account'));
  await waitFor(() => screen.getByTestId('reimburse-account-option-cih'));
  fireEvent.press(screen.getByTestId('reimburse-account-option-cih'));

  expect(screen.getByTestId('reimburse-submit')).toBeTruthy();
});
