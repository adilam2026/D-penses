import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FinancialPlanDetailScreen } from '../FinancialPlanDetailScreen';

// Remplace le calendrier natif par un simple champ texte testable — le comportement du
// calendrier natif lui-même est déjà couvert par ui/__tests__/DateField.test.tsx ; ici
// on veut seulement piloter la valeur de date sans dépendre du module natif.
jest.mock('../../ui/DateField', () => {
  const { TextInput: RNTextInput } = require('react-native');
  return {
    DateField: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) =>
      require('react').createElement(RNTextInput, { testID: 'date-field-stub', accessibilityLabel: label, value, onChangeText: onChange }),
  };
});

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

it('Item 8 : "Ajouter une échéance" exige un Montant et l\'envoie à addFinancialPlanDeadline', async () => {
  const api = require('../../api/client');
  mockGetFinancialPlan.mockResolvedValue(scolaritePlan);
  api.addFinancialPlanDeadline.mockResolvedValue({});
  renderWithSafeArea(<FinancialPlanDetailScreen />);

  await waitFor(() => screen.getByTestId('plan-detail-add-deadline'));
  fireEvent.press(screen.getByTestId('plan-detail-add-deadline'));
  await waitFor(() => screen.getByTestId('add-deadline-submit'));

  // Sans montant renseigné, le bouton reste désactivé (montant désormais obligatoire).
  fireEvent.changeText(screen.getByTestId('add-deadline-label'), 'Février');
  await waitFor(() => expect(screen.getByTestId('add-deadline-label').props.value).toBe('Février'));
  fireEvent.changeText(screen.getByTestId('date-field-stub'), '2027-02-28');
  await waitFor(() => expect(screen.getByTestId('date-field-stub').props.value).toBe('2027-02-28'));
  fireEvent.press(screen.getByTestId('add-deadline-submit'));
  expect(api.addFinancialPlanDeadline).not.toHaveBeenCalled();

  fireEvent.changeText(screen.getByTestId('add-deadline-amount'), '3500');
  await waitFor(() => expect(screen.getByTestId('add-deadline-amount').props.value).toBe('3500'));
  fireEvent.press(screen.getByTestId('add-deadline-submit'));
  await waitFor(() => expect(api.addFinancialPlanDeadline).toHaveBeenCalledWith('plan-scolarite', expect.objectContaining({ label: 'Février', amount: '3500' })));
});
