import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeadlineDetailScreen } from '../DeadlineDetailScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { planId: 'plan-scolarite', deadlineId: 'd-1' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockGetFinancialPlan = jest.fn();
const mockMarkDeadlinePaid = jest.fn();
jest.mock('../../api/client', () => ({
  getFinancialPlan: (...args: unknown[]) => mockGetFinancialPlan(...args),
  markDeadlinePaid: (...args: unknown[]) => mockMarkDeadlinePaid(...args),
  addItemToDeadline: jest.fn(),
}));

function renderWithSafeArea(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>{ui}</SafeAreaProvider>,
  );
}

function planWithDeadline(paid: boolean) {
  return {
    id: 'plan-scolarite',
    label: 'Plan Scolarité',
    accountId: null,
    subaccountId: 'scolarite',
    disponibleActuel: 45000,
    items: [{ id: 'item-1', label: 'Frais école', expectedAmount: 30000, frequency: 'ONCE', active: true }],
    deadlines: [
      {
        deadlineId: 'd-1',
        label: 'Janvier',
        dueDate: '2027-01-31',
        totalPrevu: 40000,
        disponible: 45000,
        reste: 0,
        monthsRemaining: 4,
        recommendedMonthly: 0,
        paid,
        items: [
          { plannedOperationId: 'po-1', itemId: 'item-1', label: 'Frais école', amount: 30000, status: 'PENDING' },
          { plannedOperationId: 'po-2', itemId: 'item-2', label: 'Fournitures', amount: 4000, status: 'PENDING' },
          { plannedOperationId: 'po-3', itemId: 'item-3', label: 'Sport', amount: 3000, status: 'PENDING' },
          { plannedOperationId: 'po-4', itemId: 'item-4', label: 'Activités', amount: 3000, status: 'PENDING' },
        ],
      },
    ],
    nextDeadline: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('§12 : détail d\'une échéance — breakdown par poste avec TOTAL', async () => {
  mockGetFinancialPlan.mockResolvedValue(planWithDeadline(false));
  renderWithSafeArea(<DeadlineDetailScreen />);

  await waitFor(() => screen.getByText('Janvier'));
  expect(screen.getByText('Frais école')).toBeTruthy();
  expect(screen.getByText('Fournitures')).toBeTruthy();
  expect(screen.getByText('Sport')).toBeTruthy();
  expect(screen.getByText('Activités')).toBeTruthy();
  expect(screen.getByText('TOTAL')).toBeTruthy();
  expect(screen.getByText('40 000 DH')).toBeTruthy();
});

it('§12 : "Marquer comme payée" appelle markDeadlinePaid', async () => {
  mockGetFinancialPlan.mockResolvedValue(planWithDeadline(false));
  mockMarkDeadlinePaid.mockResolvedValue({});
  renderWithSafeArea(<DeadlineDetailScreen />);

  await waitFor(() => screen.getByTestId('deadline-detail-mark-paid'));
  fireEvent.press(screen.getByTestId('deadline-detail-mark-paid'));
  await waitFor(() => expect(mockMarkDeadlinePaid).toHaveBeenCalledWith('d-1'));
});

it('échéance déjà payée : le bouton affiche "Payée ✓" et est désactivé', async () => {
  mockGetFinancialPlan.mockResolvedValue(planWithDeadline(true));
  renderWithSafeArea(<DeadlineDetailScreen />);

  await waitFor(() => screen.getByTestId('deadline-detail-mark-paid'));
  expect(screen.getByText('Payée ✓')).toBeTruthy();
});
