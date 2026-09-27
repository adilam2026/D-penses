import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PlanningScreen } from '../PlanningScreen';
import { clearCache } from '../../state/cache';
import type { PlanningTableApi } from '../../api/client';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    // Réagit aux changements de dépendances du callback (ex. horizon) — contrairement
    // au vrai useFocusEffect qui ne se relance qu'au focus, ce mock imite l'effet
    // pratique recherché ici : re-déclencher `load` quand `months` change.
    React.useEffect(cb, [cb]);
  },
}));

const mockGetPlanning = jest.fn();
const mockListAccounts = jest.fn();
const mockListFinancialPlans = jest.fn();
const mockRealizePlannedOperation = jest.fn();
const mockUnrealizePlannedOperation = jest.fn();
const mockGetFinancialOperation = jest.fn();

jest.mock('../../api/client', () => ({
  getPlanning: (...args: unknown[]) => mockGetPlanning(...args),
  listAccounts: () => mockListAccounts(),
  listFinancialPlans: () => mockListFinancialPlans(),
  realizePlannedOperation: (...args: unknown[]) => mockRealizePlannedOperation(...args),
  unrealizePlannedOperation: (...args: unknown[]) => mockUnrealizePlannedOperation(...args),
  getFinancialOperation: (...args: unknown[]) => mockGetFinancialOperation(...args),
}));

function renderWithSafeArea(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>{ui}</SafeAreaProvider>,
  );
}

function emptyCell(): PlanningTableApi['depenses'][number]['cells'][string] {
  return { displayAmount: 0, budgetAmount: 0, status: 'EMPTY', singleOccurrence: null, items: [] };
}

function basePlanning(overrides?: Partial<PlanningTableApi>): PlanningTableApi {
  return {
    months: ['2026-09', '2026-10', '2026-11'],
    revenus: [],
    depenses: [],
    epargne: [],
    synthese: {
      '2026-09': { totalRevenus: 0, totalDepenses: 0, totalEpargne: 0, balanceMensuelle: 0, balanceCumulee: 0 },
      '2026-10': { totalRevenus: 0, totalDepenses: 0, totalEpargne: 0, balanceMensuelle: 0, balanceCumulee: 0 },
      '2026-11': { totalRevenus: 0, totalDepenses: 0, totalEpargne: 0, balanceMensuelle: 0, balanceCumulee: 0 },
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  mockListAccounts.mockResolvedValue([
    { id: 'cih', name: 'CIH', bank: null, type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 20000, nonAffecte: 15000, subaccounts: [{ id: 'voiture', accountId: 'cih', name: 'CIH-Voiture', balance: 5000 }] },
  ]);
  mockListFinancialPlans.mockResolvedValue([]);
});

it('affiche le sélecteur d\'horizon (3/6/9/12) avec 6 mois actif par défaut', async () => {
  mockGetPlanning.mockResolvedValue(basePlanning());
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => expect(mockGetPlanning).toHaveBeenCalledWith(6));
  expect(screen.getByTestId('planning-horizon-3')).toBeTruthy();
  expect(screen.getByTestId('planning-horizon-12')).toBeTruthy();
});

it('changer d\'horizon relance getPlanning avec le nouveau nombre de mois', async () => {
  mockGetPlanning.mockResolvedValue(basePlanning());
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => expect(mockGetPlanning).toHaveBeenCalledWith(6));
  fireEvent.press(screen.getByTestId('planning-horizon-12'));
  await waitFor(() => expect(mockGetPlanning).toHaveBeenCalledWith(12));
});

it('case prévue (PENDING) : tap simple ouvre la confirmation "Payer" avec le compte source', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({
      depenses: [
        {
          key: 'cat-voiture',
          label: 'Voiture',
          categoryId: 'cat-voiture',
          cells: {
            '2026-09': {
              displayAmount: 700,
              budgetAmount: 700,
              status: 'PENDING',
              singleOccurrence: { plannedOperationId: 'po-1', status: 'PENDING', expectedAmount: 700, realizedAmount: null, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null },
              items: [{ type: 'PLANNED_PENDING', plannedOperationId: 'po-1', label: 'Assurance voiture', amount: 700, date: '2026-09-15', sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null }],
            },
            '2026-10': emptyCell(),
            '2026-11': emptyCell(),
          },
        },
      ],
    }),
  );

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  fireEvent.press(screen.getAllByTestId(/^planning-cell-/)[0]);

  await waitFor(() => screen.getByTestId('planning-confirm-pay'));
  expect(screen.getByText(/Payer 700 DH depuis CIH-Voiture/)).toBeTruthy();

  fireEvent.press(screen.getByTestId('planning-confirm-pay'));
  await waitFor(() => expect(mockRealizePlannedOperation).toHaveBeenCalledWith('po-1', { actualAmount: '700' }));
});

it('case prévue : appui long ouvre le modal d\'ajustement pré-rempli avec le montant prévu', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({
      depenses: [
        {
          key: 'cat-voiture',
          label: 'Voiture',
          categoryId: 'cat-voiture',
          cells: {
            '2026-09': {
              displayAmount: 700,
              budgetAmount: 700,
              status: 'PENDING',
              singleOccurrence: { plannedOperationId: 'po-1', status: 'PENDING', expectedAmount: 700, realizedAmount: null, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null },
              items: [{ type: 'PLANNED_PENDING', plannedOperationId: 'po-1', label: 'Assurance voiture', amount: 700, date: '2026-09-15', sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null }],
            },
            '2026-10': emptyCell(),
            '2026-11': emptyCell(),
          },
        },
      ],
    }),
  );

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  fireEvent(screen.getAllByTestId(/^planning-cell-/)[0], 'longPress');

  await waitFor(() => screen.getByTestId('planning-adjust-submit'));
  expect(screen.getByText('Prévu 700 DH')).toBeTruthy();
  const amountField = screen.getByTestId('planning-adjust-amount');
  await waitFor(() => expect(amountField.props.value).toBe('700'));

  fireEvent.changeText(amountField, '820');
  await waitFor(() => expect(amountField.props.value).toBe('820'));
  fireEvent.press(screen.getByTestId('planning-adjust-submit'));

  await waitFor(() => expect(mockRealizePlannedOperation).toHaveBeenCalledWith('po-1', expect.objectContaining({ actualAmount: '820' })));
});

it('case réalisée (verte) : appui long propose Voir/Modifier/Annuler le paiement', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({
      depenses: [
        {
          key: 'cat-voiture',
          label: 'Voiture',
          categoryId: 'cat-voiture',
          cells: {
            '2026-09': {
              displayAmount: 820,
              budgetAmount: 820,
              status: 'REALIZED',
              singleOccurrence: { plannedOperationId: 'po-1', status: 'REALIZED', expectedAmount: 700, realizedAmount: 820, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null },
              items: [{ type: 'PLANNED_REALIZED', plannedOperationId: 'po-1', financialOperationId: 'op-1', label: 'Assurance voiture', amount: 820, date: '2026-09-15', sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null }],
            },
            '2026-10': emptyCell(),
            '2026-11': emptyCell(),
          },
        },
      ],
    }),
  );

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  expect(screen.getByText(/820 DH ✓/)).toBeTruthy();

  fireEvent(screen.getAllByTestId(/^planning-cell-/)[0], 'longPress');
  await waitFor(() => screen.getByTestId('planning-realized-menu-option-cancel'));
  fireEvent.press(screen.getByTestId('planning-realized-menu-option-cancel'));

  await waitFor(() => expect(mockUnrealizePlannedOperation).toHaveBeenCalledWith('po-1'));
});

it('case agrégée (plusieurs éléments, ex. Autres) : tap ouvre le détail de la catégorie', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({
      depenses: [
        {
          key: 'autres',
          label: 'Autres',
          categoryId: 'autres',
          cells: {
            '2026-09': {
              displayAmount: 4800,
              budgetAmount: 4800,
              status: 'REALIZED',
              singleOccurrence: null,
              items: [
                { type: 'REAL_UNPLANNED', financialOperationId: 'op-1', label: 'Aspirateur', amount: 2500, date: '2026-09-05', sourceAccountId: 'cih', sourceSubaccountId: null, destinationAccountId: null, destinationSubaccountId: null },
                { type: 'REAL_UNPLANNED', financialOperationId: 'op-2', label: 'Cadeau', amount: 1000, date: '2026-09-10', sourceAccountId: 'cih', sourceSubaccountId: null, destinationAccountId: null, destinationSubaccountId: null },
                { type: 'REAL_UNPLANNED', financialOperationId: 'op-3', label: 'Réparation maison', amount: 1300, date: '2026-09-20', sourceAccountId: 'cih', sourceSubaccountId: null, destinationAccountId: null, destinationSubaccountId: null },
              ],
            },
            '2026-10': emptyCell(),
            '2026-11': emptyCell(),
          },
        },
      ],
    }),
  );

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  fireEvent.press(screen.getAllByTestId(/^planning-cell-/)[0]);

  await waitFor(() => screen.getByText('Aspirateur'));
  expect(screen.getByText('Cadeau')).toBeTruthy();
  expect(screen.getByText('Réparation maison')).toBeTruthy();
});

it('plans financiers : la carte affiche la prochaine échéance et navigue vers le détail du plan', async () => {
  mockGetPlanning.mockResolvedValue(basePlanning());
  mockListFinancialPlans.mockResolvedValue([
    {
      id: 'plan-1',
      label: 'Scolarité',
      accountId: null,
      subaccountId: null,
      disponibleActuel: 12000,
      items: [{ id: 'item-1', label: 'Frais école', expectedAmount: 30000, frequency: 'ONCE', active: true }],
      deadlines: [{ deadlineId: 'd-1', label: 'Janvier', dueDate: '2027-01-01', totalPrevu: 30000, disponible: 12000, reste: 18000, monthsRemaining: 3, recommendedMonthly: 6000, paid: false, items: [] }],
      nextDeadline: { deadlineId: 'd-1', label: 'Janvier', dueDate: '2027-01-01', totalPrevu: 30000, disponible: 12000, reste: 18000, monthsRemaining: 3, recommendedMonthly: 6000, paid: false, items: [] },
    },
  ]);

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-plan-plan-1'));
  expect(screen.getByText(/Janvier : 30 000 DH/)).toBeTruthy();

  fireEvent.press(screen.getByTestId('planning-plan-plan-1'));
  expect(mockNavigate).toHaveBeenCalledWith('FinancialPlanDetail', { id: 'plan-1' });
});
