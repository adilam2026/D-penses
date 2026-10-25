import React from 'react';
import { Alert } from 'react-native';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react-native';
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
const mockListCategories = jest.fn();
const mockListFinancialPlans = jest.fn();
const mockRealizePlannedOperation = jest.fn();
const mockUnrealizePlannedOperation = jest.fn();
const mockPartialRealizePlannedOperation = jest.fn();
const mockGetFinancialOperation = jest.fn();
const mockUpdatePlannedOperation = jest.fn();
const mockCancelPlannedOperation = jest.fn();
const mockListRecurrenceRules = jest.fn();
const mockUpdateRecurrenceRule = jest.fn();
const mockGetMyHousehold = jest.fn();

jest.mock('../../api/client', () => ({
  getPlanning: (...args: unknown[]) => mockGetPlanning(...args),
  listAccounts: () => mockListAccounts(),
  listCategories: () => mockListCategories(),
  listFinancialPlans: () => mockListFinancialPlans(),
  realizePlannedOperation: (...args: unknown[]) => mockRealizePlannedOperation(...args),
  unrealizePlannedOperation: (...args: unknown[]) => mockUnrealizePlannedOperation(...args),
  partialRealizePlannedOperation: (...args: unknown[]) => mockPartialRealizePlannedOperation(...args),
  getFinancialOperation: (...args: unknown[]) => mockGetFinancialOperation(...args),
  updatePlannedOperation: (...args: unknown[]) => mockUpdatePlannedOperation(...args),
  cancelPlannedOperation: (...args: unknown[]) => mockCancelPlannedOperation(...args),
  listRecurrenceRules: (...args: unknown[]) => mockListRecurrenceRules(...args),
  updateRecurrenceRule: (...args: unknown[]) => mockUpdateRecurrenceRule(...args),
  getMyHousehold: () => mockGetMyHousehold(),
}));

function renderWithSafeArea(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>{ui}</SafeAreaProvider>,
  );
}

function emptyCell(): PlanningTableApi['depenses'][number]['cells'][string] {
  return { displayAmount: 0, budgetAmount: 0, pendingAmount: 0, realizedAmount: 0, status: 'EMPTY', singleOccurrence: null, items: [] };
}

function emptySynthese(): PlanningTableApi['synthese'][string] {
  return {
    totalRevenus: 0,
    totalDepenses: 0,
    totalEpargne: 0,
    resultatPrevu: 0,
    projectionCumulee: 0,
    resteDepenses: null,
    resteVersements: null,
    couverte: null,
    aProvisionner: null,
  };
}

function basePlanning(overrides?: Partial<PlanningTableApi>): PlanningTableApi {
  return {
    months: ['2026-09', '2026-10', '2026-11'],
    revenus: [],
    depenses: [],
    epargne: [],
    synthese: {
      '2026-09': emptySynthese(),
      '2026-10': emptySynthese(),
      '2026-11': emptySynthese(),
    },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  mockListAccounts.mockResolvedValue([
    { id: 'cih', name: 'CIH', bank: null, type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 20000, nonAffecte: 15000, subaccounts: [{ id: 'voiture', accountId: 'cih', name: 'CIH-Voiture', balance: 5000, active: true }] },
  ]);
  mockListCategories.mockResolvedValue([]);
  mockListFinancialPlans.mockResolvedValue([]);
  mockListRecurrenceRules.mockResolvedValue([]);
  mockGetMyHousehold.mockResolvedValue({
    id: 'h1',
    name: 'Foyer',
    currency: 'MAD',
    monthStartDay: 1,
    memberships: [
      { id: 'm-adil', role: 'admin', user: { id: 'u-adil', firstName: 'Adil', lastName: 'A', email: 'adil@test.local', color: null } },
      { id: 'm-lamiaa', role: 'member', user: { id: 'u-lamiaa', firstName: 'Lamiaa', lastName: 'L', email: 'lamiaa@test.local', color: null } },
    ],
  });
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

it('case prévue (PENDING) : tap simple ouvre l\'ActionSheet ; le paiement n\'est déclenché qu\'après confirmation explicite, avec un toast', async () => {
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
              pendingAmount: 700,
              realizedAmount: 0,
              status: 'PENDING',
              singleOccurrence: { plannedOperationId: 'po-1', status: 'PENDING', expectedAmount: 700, realizedAmount: null, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null, recurrenceRuleId: null, categoryId: null, kind: 'EXPENSE', responsibleMemberId: null , expectedDate: '2026-09-15', realizedOperationId: null },
              items: [{ type: 'PLANNED_PENDING', plannedOperationId: 'po-1', label: 'Assurance voiture', amount: 700, date: '2026-09-15', sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null }],
            },
            '2026-10': emptyCell(),
            '2026-11': emptyCell(),
          },
        },
      ],
    }),
  );
  mockRealizePlannedOperation.mockResolvedValue({});

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));

  fireEvent.press(screen.getAllByTestId(/^planning-cell-/)[0]);
  await waitFor(() => screen.getByTestId('action-sheet-pay'));
  // Le paiement n'a pas encore eu lieu tant que le formulaire n'a pas été confirmé.
  expect(mockRealizePlannedOperation).not.toHaveBeenCalled();

  fireEvent.press(screen.getByTestId('action-sheet-pay'));
  await waitFor(() => screen.getByTestId('action-sheet-pay-submit'));
  expect(screen.getByTestId('action-sheet-pay-amount').props.value).toBe('700');
  fireEvent.press(screen.getByTestId('action-sheet-pay-submit'));
  await waitFor(() => expect(mockRealizePlannedOperation).toHaveBeenCalledWith('po-1', expect.objectContaining({ actualAmount: '700' })));
  await waitFor(() => screen.getByText('Voiture payé'));
});

it('case prévue : "Fermer" ferme l\'ActionSheet sans déclencher de paiement', async () => {
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
              pendingAmount: 700,
              realizedAmount: 0,
              status: 'PENDING',
              singleOccurrence: { plannedOperationId: 'po-1', status: 'PENDING', expectedAmount: 700, realizedAmount: null, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null, recurrenceRuleId: null, categoryId: null, kind: 'EXPENSE', responsibleMemberId: null , expectedDate: '2026-09-15', realizedOperationId: null },
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
  await waitFor(() => screen.getByTestId('action-sheet-close'));
  fireEvent.press(screen.getByTestId('action-sheet-close'));
  await waitFor(() => expect(screen.queryByTestId('action-sheet-close')).toBeNull());
  expect(mockRealizePlannedOperation).not.toHaveBeenCalled();
});

it('case déjà payée : tap simple ouvre l\'ActionSheet avec "Annuler le paiement", avec un toast après confirmation', async () => {
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
              pendingAmount: 0,
              realizedAmount: 820,
              status: 'REALIZED',
              singleOccurrence: { plannedOperationId: 'po-1', status: 'REALIZED', expectedAmount: 700, realizedAmount: 820, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null, recurrenceRuleId: null, categoryId: null, kind: 'EXPENSE', responsibleMemberId: null , expectedDate: '2026-09-15', realizedOperationId: 'op-1' },
              items: [{ type: 'PLANNED_REALIZED', plannedOperationId: 'po-1', financialOperationId: 'op-1', label: 'Assurance voiture', amount: 820, date: '2026-09-15', sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null }],
            },
            '2026-10': emptyCell(),
            '2026-11': emptyCell(),
          },
        },
      ],
    }),
  );
  mockUnrealizePlannedOperation.mockResolvedValue({});

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  fireEvent.press(screen.getAllByTestId(/^planning-cell-/)[0]);
  await waitFor(() => screen.getByText('✓ Payé entièrement — 700 DH'));
  expect(mockUnrealizePlannedOperation).not.toHaveBeenCalled();

  fireEvent.press(screen.getByTestId('action-sheet-unrealize'));
  await waitFor(() => expect(mockUnrealizePlannedOperation).toHaveBeenCalledWith('po-1'));
  await waitFor(() => screen.getByText('Paiement annulé'));
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
              pendingAmount: 700,
              realizedAmount: 0,
              status: 'PENDING',
              singleOccurrence: { plannedOperationId: 'po-1', status: 'PENDING', expectedAmount: 700, realizedAmount: null, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null, recurrenceRuleId: null, categoryId: null, kind: 'EXPENSE', responsibleMemberId: null , expectedDate: '2026-09-15', realizedOperationId: null },
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

  // Appui long OU tap simple ouvrent désormais exactement le même
  // ActionSheet (§3 "montant cliquable") — jamais deux comportements
  // différents selon l'appui.
  await waitFor(() => screen.getByTestId('action-sheet-pay'));
  fireEvent.press(screen.getByTestId('action-sheet-pay'));

  await waitFor(() => screen.getByTestId('action-sheet-pay-submit'));
  const amountField = screen.getByTestId('action-sheet-pay-amount');
  await waitFor(() => expect(amountField.props.value).toBe('700'));

  fireEvent.changeText(amountField, '820');
  await waitFor(() => expect(amountField.props.value).toBe('820'));
  fireEvent.press(screen.getByTestId('action-sheet-pay-submit'));

  await waitFor(() => expect(mockRealizePlannedOperation).toHaveBeenCalledWith('po-1', expect.objectContaining({ actualAmount: '820' })));
});

it('case prévue : appui long permet un paiement partiel (montant payé < prévu) sans clore l\'échéance', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({
      depenses: [
        {
          key: 'cat-voiture',
          label: 'Voiture',
          categoryId: 'cat-voiture',
          cells: {
            '2026-09': {
              displayAmount: 1000,
              budgetAmount: 1000,
              pendingAmount: 1000,
              realizedAmount: 0,
              status: 'PENDING',
              singleOccurrence: { plannedOperationId: 'po-1', status: 'PENDING', expectedAmount: 1000, realizedAmount: null, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null, recurrenceRuleId: null, categoryId: null, kind: 'EXPENSE', responsibleMemberId: null , expectedDate: '2026-09-15', realizedOperationId: null },
              items: [{ type: 'PLANNED_PENDING', plannedOperationId: 'po-1', label: 'Assurance voiture', amount: 1000, date: '2026-09-15', sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null }],
            },
            '2026-10': emptyCell(),
            '2026-11': emptyCell(),
          },
        },
      ],
    }),
  );
  mockPartialRealizePlannedOperation.mockResolvedValue({});

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  fireEvent(screen.getAllByTestId(/^planning-cell-/)[0], 'longPress');
  await waitFor(() => screen.getByTestId('action-sheet-partial'));
  fireEvent.press(screen.getByTestId('action-sheet-partial'));
  await waitFor(() => screen.getByTestId('action-sheet-partial-submit'));

  // Bouton désactivé sans montant saisi.
  expect(screen.getByTestId('action-sheet-partial-submit').props.accessibilityState?.disabled).toBe(true);

  fireEvent.changeText(screen.getByTestId('action-sheet-partial-amount'), '400');
  await waitFor(() => expect(screen.getByTestId('action-sheet-partial-submit').props.accessibilityState?.disabled).toBe(false));
  fireEvent.press(screen.getByTestId('action-sheet-partial-submit'));

  await waitFor(() => expect(mockPartialRealizePlannedOperation).toHaveBeenCalledWith('po-1', expect.objectContaining({ actualAmount: '400' })));
  // Le paiement partiel n'appelle jamais le realize complet.
  expect(mockRealizePlannedOperation).not.toHaveBeenCalled();
});

// Correctif "paiements partiels successifs" : une échéance déjà
// partiellement payée (case MIXTE, plusieurs items, singleOccurrence
// renseigné avec realizedAmount > 0) doit rester TOUJOURS interactive —
// avant le correctif, un 2e item dans la case mettait singleOccurrence à
// null et l'appui long tombait sur CategoryDetailModal au lieu du menu
// Payer/Ajuster habituel.
it("case partiellement payée (MIXTE) : l'appui long propose TOUJOURS le menu Payer/Ajuster, jamais bloqué après un 1er paiement partiel", async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({
      depenses: [
        {
          key: 'cat-transport',
          label: 'Transport',
          categoryId: 'cat-transport',
          cells: {
            '2026-09': {
              displayAmount: 800,
              budgetAmount: 800,
              pendingAmount: 500,
              realizedAmount: 300,
              status: 'MIXED',
              singleOccurrence: {
                plannedOperationId: 'po-carburant',
                status: 'PENDING',
                expectedAmount: 800,
                realizedAmount: 300,
                sourceAccountId: 'cih',
                sourceSubaccountId: null,
                destinationAccountId: null,
                destinationSubaccountId: null,
                recurrenceRuleId: null,
                categoryId: 'cat-transport',
                kind: 'EXPENSE',
                responsibleMemberId: null,
                expectedDate: '2026-09-15',
                realizedOperationId: null,
              },
              items: [
                { type: 'PLANNED_REALIZED', plannedOperationId: 'po-carburant', financialOperationId: 'op-1', label: 'Carburant Adil', amount: 300, date: '2026-09-02', sourceAccountId: 'cih', sourceSubaccountId: null, destinationAccountId: null, destinationSubaccountId: null },
                { type: 'PLANNED_PENDING', plannedOperationId: 'po-carburant', label: 'Carburant Adil', amount: 500, expectedAmount: 800, date: '2026-09-15', sourceAccountId: 'cih', sourceSubaccountId: null, destinationAccountId: null, destinationSubaccountId: null },
              ],
            },
            '2026-10': emptyCell(),
            '2026-11': emptyCell(),
          },
        },
      ],
    }),
  );
  mockPartialRealizePlannedOperation.mockResolvedValue({});

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  expect(screen.getByText('300/800 DH')).toBeTruthy();
  expect(screen.getByText('reste 500 DH')).toBeTruthy();

  // L'appui long ouvre bien l'ActionSheet (jamais le détail ambigu).
  fireEvent(screen.getAllByTestId(/^planning-cell-/)[0], 'longPress');
  await waitFor(() => screen.getByTestId('action-sheet-pay'));
  expect(screen.queryByText('RÉALISÉ')).toBeNull(); // CategoryDetailModal ne s'est jamais ouvert

  // Affiche clairement Prévu/Déjà payé/Reste, dès le menu (sans ouvrir de sous-formulaire).
  expect(screen.getByText('Prévu')).toBeTruthy();
  expect(screen.getByTestId('action-sheet-deja-paye')).toBeTruthy();
  expect(screen.getByText('800 DH')).toBeTruthy();
  expect(screen.getByTestId('action-sheet-deja-paye').props.children).toBe('300 DH');
  expect(screen.getByTestId('action-sheet-reste').props.children).toBe('500 DH');
  // "Nouveau paiement partiel" (jamais "Payer partiellement") dès qu'un 1er paiement partiel existe.
  expect(screen.getByText('Nouveau paiement partiel')).toBeTruthy();

  // Un 2e paiement partiel (200 sur les 500 restants) reste possible.
  fireEvent.press(screen.getByTestId('action-sheet-partial'));
  await waitFor(() => screen.getByTestId('action-sheet-partial-submit'));
  fireEvent.changeText(screen.getByTestId('action-sheet-partial-amount'), '200');
  await waitFor(() => expect(screen.getByTestId('action-sheet-partial-submit').props.accessibilityState?.disabled).toBe(false));
  fireEvent.press(screen.getByTestId('action-sheet-partial-submit'));
  await waitFor(() => expect(mockPartialRealizePlannedOperation).toHaveBeenCalledWith('po-carburant', expect.objectContaining({ actualAmount: '200' })));
});

it('case réalisée (verte) : appui long propose Voir la transaction / Annuler le paiement / Modifier l\'échéance / Annuler l\'échéance (§8)', async () => {
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
              pendingAmount: 0,
              realizedAmount: 820,
              status: 'REALIZED',
              singleOccurrence: { plannedOperationId: 'po-1', status: 'REALIZED', expectedAmount: 700, realizedAmount: 820, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null, recurrenceRuleId: null, categoryId: null, kind: 'EXPENSE', responsibleMemberId: null , expectedDate: '2026-09-15', realizedOperationId: 'op-1' },
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
  await waitFor(() => screen.getByTestId('action-sheet-unrealize'));
  expect(screen.getByText('✓ Payé entièrement — 700 DH')).toBeTruthy();
  expect(screen.getByTestId('action-sheet-view-transaction')).toBeTruthy();
  expect(screen.getByText('Annuler le paiement')).toBeTruthy();
  expect(screen.getByTestId('action-sheet-edit-paid')).toBeTruthy();
  expect(screen.getByTestId('action-sheet-cancel-paid')).toBeTruthy();

  fireEvent.press(screen.getByTestId('action-sheet-unrealize'));
  await waitFor(() => expect(mockUnrealizePlannedOperation).toHaveBeenCalledWith('po-1'));

  // "Voir la transaction" navigue vers l'écran de détail canonique (jamais une
  // mini-modale ad hoc).
  fireEvent(screen.getAllByTestId(/^planning-cell-/)[0], 'longPress');
  await waitFor(() => screen.getByTestId('action-sheet-view-transaction'));
  fireEvent.press(screen.getByTestId('action-sheet-view-transaction'));
  expect(mockNavigate).toHaveBeenCalledWith('TransactionDetail', { id: 'op-1' });
});

it('échéance déjà payée, "Modifier l\'échéance" (§8) : annule le paiement puis reprend EXACTEMENT le parcours de modification normal', async () => {
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
              pendingAmount: 0,
              realizedAmount: 700,
              status: 'REALIZED',
              singleOccurrence: { plannedOperationId: 'po-1', status: 'REALIZED', expectedAmount: 700, realizedAmount: 700, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null, recurrenceRuleId: null, categoryId: null, kind: 'EXPENSE', responsibleMemberId: null, expectedDate: '2026-09-15', realizedOperationId: 'op-1' },
              items: [{ type: 'PLANNED_REALIZED', plannedOperationId: 'po-1', financialOperationId: 'op-1', label: 'Assurance voiture', amount: 700, date: '2026-09-15', sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null }],
            },
            '2026-10': emptyCell(),
            '2026-11': emptyCell(),
          },
        },
      ],
    }),
  );
  mockUnrealizePlannedOperation.mockResolvedValue({});
  mockUpdatePlannedOperation.mockResolvedValue({});

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  fireEvent(screen.getAllByTestId(/^planning-cell-/)[0], 'longPress');
  await waitFor(() => screen.getByTestId('action-sheet-edit-paid'));
  fireEvent.press(screen.getByTestId('action-sheet-edit-paid'));

  // Le paiement est d'abord annulé (reversal déjà validé, jamais une suppression)...
  await waitFor(() => expect(mockUnrealizePlannedOperation).toHaveBeenCalledWith('po-1'));
  // ...puis le même formulaire d'édition normal s'ouvre sur l'échéance redevenue PENDING.
  await waitFor(() => screen.getByTestId('planning-edit-submit'));

  fireEvent.changeText(screen.getByTestId('planning-edit-amount'), '750');
  await waitFor(() => expect(screen.getByTestId('planning-edit-amount').props.value).toBe('750'));
  fireEvent.press(screen.getByTestId('planning-edit-submit'));
  await waitFor(() => expect(mockUpdatePlannedOperation).toHaveBeenCalledWith('po-1', expect.objectContaining({ expectedAmount: '750' })));
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
              pendingAmount: 0,
              realizedAmount: 4800,
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

it("Item 6 : case MIXTE (200 réalisé + 70 à venir) affiche un split compact, jamais fondu en un seul total vert avec ✓", async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({
      depenses: [
        {
          key: 'cat-divers',
          label: 'Divers',
          categoryId: 'cat-divers',
          cells: {
            '2026-09': {
              displayAmount: 270,
              budgetAmount: 270,
              pendingAmount: 70,
              realizedAmount: 200,
              status: 'MIXED',
              singleOccurrence: null,
              items: [
                { type: 'PLANNED_REALIZED', plannedOperationId: 'po-1', financialOperationId: 'op-1', label: 'Poste A', amount: 200, date: '2026-09-05', sourceAccountId: 'cih', sourceSubaccountId: null, destinationAccountId: null, destinationSubaccountId: null },
                {
                  type: 'PLANNED_PENDING',
                  plannedOperationId: 'po-2',
                  label: 'Poste B',
                  amount: 70,
                  expectedAmount: 70,
                  date: '2026-09-20',
                  sourceAccountId: 'cih',
                  sourceSubaccountId: null,
                  destinationAccountId: null,
                  destinationSubaccountId: null,
                  recurrenceRuleId: null,
                  categoryId: 'cat-divers',
                  kind: 'EXPENSE',
                },
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
  await waitFor(() => screen.getByText('200/270 DH'));
  // Jamais affiché comme "270 DH ✓" (qui suggérerait à tort que tout est réalisé).
  expect(screen.queryByText(/270 DH ✓/)).toBeNull();
  // Item 9 : le restant doit être explicite, pas seulement déductible du split.
  expect(screen.getByText('reste 70 DH')).toBeTruthy();

  fireEvent.press(screen.getAllByTestId(/^planning-cell-/)[0]);
  await waitFor(() => screen.getByText('RÉALISÉ'));
  expect(screen.getByText('À VENIR')).toBeTruthy();
  expect(screen.getByText('Poste A')).toBeTruthy();
  expect(screen.getByText('Poste B')).toBeTruthy();
  expect(screen.getByTestId('planning-detail-pay-adjust-po-2')).toBeTruthy();

  // Item 11 : revenir sur le paiement déjà confirmé (Poste A), même dans une case
  // à plusieurs éléments — pas seulement via l'appui long singleOccurrence.
  fireEvent.press(screen.getByTestId('planning-detail-unrealize-po-1'));
  await waitFor(() => expect(mockUnrealizePlannedOperation).toHaveBeenCalledWith('po-1'));
  await waitFor(() => expect(screen.queryByTestId('planning-detail-unrealize-po-1')).toBeNull());

  // Lot "paiements partiels successifs" : "Payer / Ajuster" (ex-"Marquer
  // réalisé") rouvre le même ActionSheet unique, jamais un realize() instantané.
  fireEvent.press(screen.getAllByTestId(/^planning-cell-/)[0]);
  await waitFor(() => screen.getByTestId('planning-detail-pay-adjust-po-2'));
  fireEvent.press(screen.getByTestId('planning-detail-pay-adjust-po-2'));
  await waitFor(() => screen.getByTestId('action-sheet-pay'));
  fireEvent.press(screen.getByTestId('action-sheet-pay'));
  await waitFor(() => screen.getByTestId('action-sheet-pay-submit'));
  await fireEvent.press(screen.getByTestId('action-sheet-pay-submit'));
  await waitFor(() => expect(mockRealizePlannedOperation).toHaveBeenCalledWith('po-2', expect.objectContaining({ actualAmount: '70' })));
});

// Lot "refonte Planning/À faire" §2 — chaque bloc (Revenus/Dépenses/Épargne)
// est pliable indépendamment, jamais un grand tableau continu type Excel.
// Replié, seule la ligne TOTAL reste visible ; déplié par défaut.
it('bloc DÉPENSES pliable : repliement masque les lignes (jamais le TOTAL), dépliement les restaure', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({ depenses: [{ key: 'cat-voiture', label: 'Voiture', categoryId: 'cat-voiture', cells: { '2026-09': pendingVoitureCell(), '2026-10': emptyCell(), '2026-11': emptyCell() } }] }),
  );

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByText('Voiture'));
  expect(screen.getByText('TOTAL DÉPENSES')).toBeTruthy();

  fireEvent.press(screen.getByTestId('planning-block-toggle-depenses'));
  await waitFor(() => expect(screen.queryByText('Voiture')).toBeNull());
  // Le TOTAL (et le bloc lui-même) restent toujours visibles, même replié.
  expect(screen.getByText('TOTAL DÉPENSES')).toBeTruthy();

  fireEvent.press(screen.getByTestId('planning-block-toggle-depenses'));
  await waitFor(() => expect(screen.getByText('Voiture')).toBeTruthy());
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

// -----------------------------------------------------------------
// Lot "Planning — source au paiement + modification des échéances"
// -----------------------------------------------------------------

function pendingVoitureCell(overrides?: Partial<ReturnType<typeof voitureSingleOccurrence>>) {
  return {
    displayAmount: 700,
    budgetAmount: 700,
    pendingAmount: 700,
    realizedAmount: 0,
    status: 'PENDING' as const,
    singleOccurrence: { ...voitureSingleOccurrence(), ...overrides },
    items: [{ type: 'PLANNED_PENDING' as const, plannedOperationId: 'po-1', label: 'Assurance voiture', amount: 700, date: '2026-09-15', sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null }],
  };
}

function voitureSingleOccurrence() {
  return {
    plannedOperationId: 'po-1',
    status: 'PENDING' as const,
    expectedAmount: 700,
    realizedAmount: null,
    sourceAccountId: 'cih',
    sourceSubaccountId: 'voiture',
    destinationAccountId: null,
    destinationSubaccountId: null,
    recurrenceRuleId: null as string | null,
    categoryId: null as string | null,
    kind: 'EXPENSE' as const,
    responsibleMemberId: null as string | null,
    expectedDate: '2026-09-15',
    realizedOperationId: null as string | null,
  };
}

it("ActionSheet : le sélecteur de source est présélectionné sur la source prévue et l'override est transmis au paiement", async () => {
  mockListAccounts.mockResolvedValue([
    { id: 'cih', name: 'CIH', bank: null, type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 20000, nonAffecte: 15000, subaccounts: [{ id: 'voiture', accountId: 'cih', name: 'CIH-Voiture', balance: 5000, active: true }] },
    { id: 'bp', name: 'BP Lamiaa', bank: null, type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 10000, nonAffecte: 10000, subaccounts: [] },
  ]);
  mockGetPlanning.mockResolvedValue(
    basePlanning({ depenses: [{ key: 'cat-voiture', label: 'Voiture', categoryId: 'cat-voiture', cells: { '2026-09': pendingVoitureCell(), '2026-10': emptyCell(), '2026-11': emptyCell() } }] }),
  );

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  fireEvent(screen.getAllByTestId(/^planning-cell-/)[0], 'longPress');
  fireEvent.press(await screen.findByTestId('action-sheet-pay'));

  await waitFor(() => screen.getByTestId('action-sheet-pay-source'));
  // Présélection : la source prévue (CIH — CIH-Voiture) est affichée.
  expect(screen.getByText('CIH — CIH-Voiture')).toBeTruthy();

  // Choisir une autre source (BP Lamiaa, compte principal direct) avant de payer.
  await fireEvent.press(screen.getByTestId('action-sheet-pay-source'));
  await fireEvent.press(await screen.findByTestId('action-sheet-pay-source-option-acc:bp'));

  await fireEvent.press(screen.getByTestId('action-sheet-pay-submit'));
  await waitFor(() =>
    expect(mockRealizePlannedOperation).toHaveBeenCalledWith('po-1', expect.objectContaining({ actualAmount: '700', sourceAccountId: 'bp', sourceSubaccountId: undefined })),
  );
});

it('"Modifier l\'échéance" sur une échéance ponctuelle ouvre directement le formulaire (jamais le choix de portée)', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({ depenses: [{ key: 'cat-voiture', label: 'Voiture', categoryId: 'cat-voiture', cells: { '2026-09': pendingVoitureCell(), '2026-10': emptyCell(), '2026-11': emptyCell() } }] }),
  );
  mockUpdatePlannedOperation.mockResolvedValue({});

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  fireEvent(screen.getAllByTestId(/^planning-cell-/)[0], 'longPress');
  await fireEvent.press(await screen.findByTestId('action-sheet-edit'));

  // Ponctuelle : jamais le ChoiceSheet "cette échéance uniquement / et les suivantes".
  expect(screen.queryByTestId('planning-scope-choice-option-single')).toBeNull();
  await waitFor(() => screen.getByTestId('planning-edit-submit'));

  await fireEvent.changeText(screen.getByTestId('planning-edit-amount'), '750');
  await fireEvent.press(screen.getByTestId('planning-edit-submit'));

  await waitFor(() => expect(mockUpdatePlannedOperation).toHaveBeenCalledWith('po-1', expect.objectContaining({ expectedAmount: '750' })));
  // Lot "refonte Planning/À faire" §1 — montant modifié SANS toucher le champ
  // Responsable : jamais renvoyé (ni responsibleMemberId ni responsibleSource),
  // sinon une échéance AUTO serait silencieusement repassée MANUAL à chaque
  // simple modification de montant/date.
  const call = mockUpdatePlannedOperation.mock.calls[0][1];
  expect(call).not.toHaveProperty('responsibleMemberId');
  expect(call).not.toHaveProperty('responsibleSource');
});

it('"Modifier l\'échéance" — modifier EXPLICITEMENT le Responsable envoie responsibleMemberId + responsibleSource=MANUAL', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({ depenses: [{ key: 'cat-voiture', label: 'Voiture', categoryId: 'cat-voiture', cells: { '2026-09': pendingVoitureCell(), '2026-10': emptyCell(), '2026-11': emptyCell() } }] }),
  );
  mockUpdatePlannedOperation.mockResolvedValue({});

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  fireEvent(screen.getAllByTestId(/^planning-cell-/)[0], 'longPress');
  await fireEvent.press(await screen.findByTestId('action-sheet-edit'));
  await waitFor(() => screen.getByTestId('planning-edit-submit'));

  await fireEvent.press(screen.getByTestId('planning-edit-responsible-member'));
  await fireEvent.press(await screen.findByTestId('planning-edit-responsible-member-option-m-adil'));
  await fireEvent.press(screen.getByTestId('planning-edit-submit'));

  await waitFor(() =>
    expect(mockUpdatePlannedOperation).toHaveBeenCalledWith('po-1', expect.objectContaining({ responsibleMemberId: 'm-adil', responsibleSource: 'MANUAL' })),
  );
});

it('"Modifier l\'échéance" sur une occurrence récurrente propose le choix de portée, et "et les suivantes" appelle updateRecurrenceRule', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({
      depenses: [
        {
          key: 'cat-voiture',
          label: 'Voiture',
          categoryId: 'cat-voiture',
          cells: { '2026-09': pendingVoitureCell({ recurrenceRuleId: 'rule-1' }), '2026-10': emptyCell(), '2026-11': emptyCell() },
        },
      ],
    }),
  );
  mockListRecurrenceRules.mockResolvedValue([
    { id: 'rule-1', frequency: 'MONTHLY', anchorDate: '2026-09-15', label: 'Voiture', active: true, kind: 'EXPENSE', expectedAmount: 700, categoryId: null, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null },
  ]);
  mockUpdateRecurrenceRule.mockResolvedValue({});

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  fireEvent(screen.getAllByTestId(/^planning-cell-/)[0], 'longPress');
  await fireEvent.press(await screen.findByTestId('action-sheet-edit'));

  await fireEvent.press(await screen.findByTestId('planning-scope-choice-option-series'));
  await waitFor(() => screen.getByTestId('planning-edit-submit'));
  expect(screen.getByText('Modifier cette échéance et les suivantes')).toBeTruthy();

  await fireEvent.changeText(screen.getByTestId('planning-edit-amount'), '800');
  await fireEvent.press(screen.getByTestId('planning-edit-submit'));

  await waitFor(() =>
    expect(mockUpdateRecurrenceRule).toHaveBeenCalledWith(
      'rule-1',
      expect.objectContaining({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: '2026-09-15', expectedAmount: '800' }),
    ),
  );
});

it('"Annuler l\'échéance" sur une échéance ponctuelle demande confirmation puis appelle cancelPlannedOperation', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({ depenses: [{ key: 'cat-voiture', label: 'Voiture', categoryId: 'cat-voiture', cells: { '2026-09': pendingVoitureCell(), '2026-10': emptyCell(), '2026-11': emptyCell() } }] }),
  );
  mockCancelPlannedOperation.mockResolvedValue({});
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
    buttons?.find((b) => b.style === 'destructive')?.onPress?.();
  });

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  fireEvent(screen.getAllByTestId(/^planning-cell-/)[0], 'longPress');
  await fireEvent.press(await screen.findByTestId('action-sheet-cancel'));

  await waitFor(() => expect(alertSpy).toHaveBeenCalled());
  await waitFor(() => expect(mockCancelPlannedOperation).toHaveBeenCalledWith('po-1'));
  alertSpy.mockRestore();
});

it('"Annuler l\'échéance" sur une récurrence propose le choix de portée ; "et les suivantes" arrête la série (active:false)', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({
      depenses: [
        {
          key: 'cat-voiture',
          label: 'Voiture',
          categoryId: 'cat-voiture',
          cells: { '2026-09': pendingVoitureCell({ recurrenceRuleId: 'rule-1' }), '2026-10': emptyCell(), '2026-11': emptyCell() },
        },
      ],
    }),
  );
  mockUpdateRecurrenceRule.mockResolvedValue({});
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
    buttons?.find((b) => b.style === 'destructive')?.onPress?.();
  });

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  fireEvent(screen.getAllByTestId(/^planning-cell-/)[0], 'longPress');
  await fireEvent.press(await screen.findByTestId('action-sheet-cancel'));
  await fireEvent.press(await screen.findByTestId('planning-scope-choice-option-series'));

  await waitFor(() =>
    expect(mockUpdateRecurrenceRule).toHaveBeenCalledWith('rule-1', expect.objectContaining({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: '2026-09-15', active: false })),
  );
  alertSpy.mockRestore();
});

// Lot "Planning allégé" (correction recette) : synthèse simplifiée
// REVENUS/DÉPENSES/VERSEMENTS/RÉSULTAT PRÉVU (mêmes totaux que les lignes
// TOTAL ci-dessus, aucun second calcul) + "RESTE À EXÉCUTER" (mois courant
// uniquement) — remplace l'ancienne synthèse payé/prévu, devenue incohérente
// avec les totaux affichés (cf. backend planning.util.ts).
it('synthèse simplifiée : REVENUS/DÉPENSES/VERSEMENTS/RÉSULTAT PRÉVU reprennent les mêmes totaux, "reste à exécuter" réservé au mois courant', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({
      synthese: {
        '2026-09': {
          totalRevenus: 2000,
          totalDepenses: 7300,
          totalEpargne: 1000,
          resultatPrevu: -6300,
          projectionCumulee: -6300,
          resteDepenses: 6100,
          resteVersements: 0,
          couverte: false,
          aProvisionner: 600,
        },
        '2026-10': emptySynthese(),
        '2026-11': emptySynthese(),
      },
    }),
  );

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getAllByText('RÉSULTAT PRÉVU'));
  // "REVENUS"/"DÉPENSES" apparaissent aussi comme titres de section du tableau
  // ET comme carte de synthèse (§2) — jamais une seule occurrence.
  expect(screen.getAllByText('REVENUS').length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText('DÉPENSES').length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText('VERSEMENTS').length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText('RESTE À EXÉCUTER')).toBeTruthy();
  // L'ancienne terminologie "balance" a disparu (§14).
  expect(screen.queryByText(/balance/i)).toBeNull();

  // Cartes de synthèse (§2) — mois courant (2026-09), mêmes totaux, aucun second calcul.
  expect(within(screen.getByTestId('planning-summary-card-revenus')).getByText('2 000 DH')).toBeTruthy();
  expect(within(screen.getByTestId('planning-summary-card-depenses')).getByText('7 300 DH')).toBeTruthy();
  expect(within(screen.getByTestId('planning-summary-card-versements')).getByText('1 000 DH')).toBeTruthy();
  expect(within(screen.getByTestId('planning-summary-card-resultat')).getByText('-6 300 DH')).toBeTruthy();

  // REVENUS/DÉPENSES/VERSEMENTS/RÉSULTAT PRÉVU = EXACTEMENT les totaux ci-dessus, aucune divergence.
  expect(within(screen.getByTestId('planning-synthese-revenus-2026-09')).getByText('2 000 DH')).toBeTruthy();
  expect(within(screen.getByTestId('planning-synthese-depenses-2026-09')).getByText('7 300 DH')).toBeTruthy();
  expect(within(screen.getByTestId('planning-synthese-versements-2026-09')).getByText('1 000 DH')).toBeTruthy();
  expect(within(screen.getByTestId('planning-synthese-resultat-prevu-2026-09')).getByText('-6 300 DH')).toBeTruthy();

  // "Reste à exécuter" (mois courant) : jamais le prévu, uniquement le reste réel.
  const resteCell = screen.getByTestId('planning-reste-a-executer-2026-09');
  expect(within(resteCell).getByText('Dépenses 6 100 DH')).toBeTruthy();
  expect(within(resteCell).getByText('Versements 0 DH')).toBeTruthy();
  // Couverture : jamais présentée comme une marge globale — "À provisionner", pas "Couvert 5 500 / Marge".
  expect(within(resteCell).getByText('À provisionner 600 DH')).toBeTruthy();

  // Mois futur (2026-10) : pas de "reste à exécuter" du tout, faute de projection fiable (§12).
  const resteCellFuture = screen.getByTestId('planning-reste-a-executer-2026-10');
  expect(within(resteCellFuture).queryByText(/provisionner|couvert|Dépenses|Versements/i)).toBeNull();

  // Projection (§13) : ligne unique sous le tableau, dernier mois VISIBLE de la fenêtre (2026-11 par défaut).
  const projectionLine = screen.getByTestId('planning-projection-cumulee');
  expect(within(projectionLine).getByText(/Projection à fin Novembre 2026/)).toBeTruthy();
});

it('"reste à exécuter" : "✓ Couvert" quand aProvisionner vaut 0 (mois courant)', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({
      synthese: {
        '2026-09': { ...emptySynthese(), resteDepenses: 1200, resteVersements: 0, couverte: true, aProvisionner: 0 },
        '2026-10': emptySynthese(),
        '2026-11': emptySynthese(),
      },
    }),
  );

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByText('RESTE À EXÉCUTER'));
  const resteCell = screen.getByTestId('planning-reste-a-executer-2026-09');
  expect(within(resteCell).getByText('✓ Couvert')).toBeTruthy();
  expect(within(resteCell).queryByText(/provisionner/i)).toBeNull();
});
