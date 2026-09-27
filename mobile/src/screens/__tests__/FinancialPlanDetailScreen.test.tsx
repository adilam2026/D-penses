import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FinancialPlanDetailScreen } from '../FinancialPlanDetailScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { id: 'plan-scolarite' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockGetFinancialPlan = jest.fn();
const mockListAccounts = jest.fn();
jest.mock('../../api/client', () => ({
  getFinancialPlan: (...args: unknown[]) => mockGetFinancialPlan(...args),
  listAccounts: () => mockListAccounts(),
  updateFinancialPlan: jest.fn(),
  addFinancialPlanDeadline: jest.fn(),
  addFinancialPlanItem: jest.fn(),
}));

function renderWithSafeArea(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>{ui}</SafeAreaProvider>,
  );
}

const scolaritePlan = {
  id: 'plan-scolarite',
  label: 'Plan Scolarité',
  accountId: null,
  subaccountId: 'scolarite',
  disponibleActuel: 45000,
  items: [{ id: 'item-1', label: 'Frais école', expectedAmount: 30000, frequency: 'ONCE', active: true }],
  deadlines: [
    { deadlineId: 'd-1', label: 'Janvier', dueDate: '2027-01-31', totalPrevu: 40000, disponible: 45000, reste: 12000, monthsRemaining: 4, recommendedMonthly: 3000, paid: false, items: [] },
  ],
  nextDeadline: { deadlineId: 'd-1', label: 'Janvier', dueDate: '2027-01-31', totalPrevu: 40000, disponible: 45000, reste: 12000, monthsRemaining: 4, recommendedMonthly: 3000, paid: false, items: [] },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockListAccounts.mockResolvedValue([]);
});

it('§10/test F : affiche Disponible actuel et la prochaine échéance (besoin/disponible/reste/recommandation)', async () => {
  mockGetFinancialPlan.mockResolvedValue(scolaritePlan);
  renderWithSafeArea(<FinancialPlanDetailScreen />);

  await waitFor(() => screen.getByTestId('plan-detail-next-deadline'));
  expect(screen.getByText('Plan Scolarité')).toBeTruthy();
  expect(screen.getAllByText('45 000 DH').length).toBeGreaterThan(0);
  expect(screen.getByText('40 000 DH')).toBeTruthy();
  expect(screen.getByText('12 000 DH')).toBeTruthy();
  expect(screen.getByText(/3 000 DH\/mois/)).toBeTruthy();
});

it('§11 : liste des échéances -> tap navigue vers DeadlineDetail', async () => {
  mockGetFinancialPlan.mockResolvedValue(scolaritePlan);
  renderWithSafeArea(<FinancialPlanDetailScreen />);

  await waitFor(() => screen.getByTestId('plan-detail-deadline-d-1'));
  fireEvent.press(screen.getByTestId('plan-detail-deadline-d-1'));
  expect(mockNavigate).toHaveBeenCalledWith('DeadlineDetail', { planId: 'plan-scolarite', deadlineId: 'd-1' });
});

it('§12 : une échéance déjà payée affiche "Payée ✓"', async () => {
  mockGetFinancialPlan.mockResolvedValue({
    ...scolaritePlan,
    deadlines: [{ ...scolaritePlan.deadlines[0], paid: true }],
  });
  renderWithSafeArea(<FinancialPlanDetailScreen />);

  await waitFor(() => screen.getByText('Payée ✓'));
});
