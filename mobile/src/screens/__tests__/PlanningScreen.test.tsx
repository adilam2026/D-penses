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
    balanceMensuelle: 0,
    balanceCumulee: 0,
    depensesPrevues: 0,
    depensesPayees: 0,
    depensesReste: 0,
    depensesCouvertes: null,
    depensesAProvisionner: null,
    epargnePrevue: 0,
    epargneVersee: 0,
    epargneReste: 0,
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

it('case prévue (PENDING) : tap simple ouvre un mini pop-up ; seul "Marquer comme payé" déclenche le paiement, avec un toast', async () => {
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
              singleOccurrence: { plannedOperationId: 'po-1', status: 'PENDING', expectedAmount: 700, realizedAmount: null, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null, recurrenceRuleId: null, categoryId: null, kind: 'EXPENSE' },
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
  await waitFor(() => screen.getByTestId('planning-popup-confirm'));
  // Le paiement n'a pas encore eu lieu tant que "Marquer comme payé" n'a pas été cliqué.
  expect(mockRealizePlannedOperation).not.toHaveBeenCalled();

  fireEvent.press(screen.getByTestId('planning-popup-confirm'));
  await waitFor(() => expect(mockRealizePlannedOperation).toHaveBeenCalledWith('po-1', { actualAmount: '700' }));
  await waitFor(() => screen.getByText('Transaction marquée comme payée'));
});

it('case prévue : "Fermer" ferme le pop-up sans déclencher de paiement', async () => {
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
              singleOccurrence: { plannedOperationId: 'po-1', status: 'PENDING', expectedAmount: 700, realizedAmount: null, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null, recurrenceRuleId: null, categoryId: null, kind: 'EXPENSE' },
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
  await waitFor(() => screen.getByTestId('planning-popup-close'));
  fireEvent.press(screen.getByTestId('planning-popup-close'));
  await waitFor(() => expect(screen.queryByTestId('planning-popup-close')).toBeNull());
  expect(mockRealizePlannedOperation).not.toHaveBeenCalled();
});

it('case déjà payée : tap simple ouvre un mini pop-up avec "Annuler le paiement", avec un toast après confirmation', async () => {
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
              singleOccurrence: { plannedOperationId: 'po-1', status: 'REALIZED', expectedAmount: 700, realizedAmount: 820, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null, recurrenceRuleId: null, categoryId: null, kind: 'EXPENSE' },
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
  await waitFor(() => screen.getByText('Annuler le paiement'));
  expect(mockUnrealizePlannedOperation).not.toHaveBeenCalled();

  fireEvent.press(screen.getByTestId('planning-popup-confirm'));
  await waitFor(() => expect(mockUnrealizePlannedOperation).toHaveBeenCalledWith('po-1'));
  await waitFor(() => screen.getByText('Transaction remise à venir'));
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
              singleOccurrence: { plannedOperationId: 'po-1', status: 'PENDING', expectedAmount: 700, realizedAmount: null, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null, recurrenceRuleId: null, categoryId: null, kind: 'EXPENSE' },
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

  // Appui long sur une case PENDING ouvre désormais un petit menu
  // (Payer/Ajuster, Modifier l'échéance, Annuler l'échéance) — "Payer /
  // Ajuster" mène au même AdjustModal qu'avant (comportement inchangé).
  await waitFor(() => screen.getByTestId('planning-pending-menu-option-pay'));
  fireEvent.press(screen.getByTestId('planning-pending-menu-option-pay'));

  await waitFor(() => screen.getByTestId('planning-adjust-submit'));
  expect(screen.getByText('Prévu 700 DH')).toBeTruthy();
  const amountField = screen.getByTestId('planning-adjust-amount');
  await waitFor(() => expect(amountField.props.value).toBe('700'));

  fireEvent.changeText(amountField, '820');
  await waitFor(() => expect(amountField.props.value).toBe('820'));
  fireEvent.press(screen.getByTestId('planning-adjust-submit'));

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
              singleOccurrence: { plannedOperationId: 'po-1', status: 'PENDING', expectedAmount: 1000, realizedAmount: null, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null, recurrenceRuleId: null, categoryId: null, kind: 'EXPENSE' },
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
  await waitFor(() => screen.getByTestId('planning-pending-menu-option-pay'));
  fireEvent.press(screen.getByTestId('planning-pending-menu-option-pay'));
  await waitFor(() => screen.getByTestId('planning-adjust-partial-submit'));

  // Bouton désactivé sans montant saisi.
  expect(screen.getByTestId('planning-adjust-partial-submit').props.accessibilityState?.disabled).toBe(true);

  fireEvent.changeText(screen.getByTestId('planning-adjust-partial-amount'), '400');
  await waitFor(() => expect(screen.getByTestId('planning-adjust-partial-submit').props.accessibilityState?.disabled).toBe(false));
  fireEvent.press(screen.getByTestId('planning-adjust-partial-submit'));

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

  // L'appui long ouvre bien le menu à 3 options (jamais le détail ambigu).
  fireEvent(screen.getAllByTestId(/^planning-cell-/)[0], 'longPress');
  await waitFor(() => screen.getByTestId('planning-pending-menu-option-pay'));
  expect(screen.queryByText('RÉALISÉ')).toBeNull(); // CategoryDetailModal ne s'est jamais ouvert

  fireEvent.press(screen.getByTestId('planning-pending-menu-option-pay'));
  await waitFor(() => screen.getByTestId('planning-adjust-submit'));

  // Affiche clairement Prévu/Déjà payé/Reste.
  expect(screen.getByText('Prévu 800 DH')).toBeTruthy();
  expect(screen.getByTestId('planning-adjust-deja-paye')).toBeTruthy();
  expect(screen.getByText('Déjà payé 300 DH')).toBeTruthy();
  expect(screen.getByText('Reste à payer 500 DH')).toBeTruthy();
  // Le montant réel est pré-rempli avec le RESTE (500), jamais le prévu complet (800).
  expect(screen.getByTestId('planning-adjust-amount').props.value).toBe('500');

  // Un 2e paiement partiel (200 sur les 500 restants) reste possible.
  fireEvent.changeText(screen.getByTestId('planning-adjust-partial-amount'), '200');
  await waitFor(() => expect(screen.getByTestId('planning-adjust-partial-submit').props.accessibilityState?.disabled).toBe(false));
  fireEvent.press(screen.getByTestId('planning-adjust-partial-submit'));
  await waitFor(() => expect(mockPartialRealizePlannedOperation).toHaveBeenCalledWith('po-carburant', expect.objectContaining({ actualAmount: '200' })));
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
              pendingAmount: 0,
              realizedAmount: 820,
              status: 'REALIZED',
              singleOccurrence: { plannedOperationId: 'po-1', status: 'REALIZED', expectedAmount: 700, realizedAmount: 820, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null, recurrenceRuleId: null, categoryId: null, kind: 'EXPENSE' },
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
  // Vocabulaire Planning ("le paiement") volontairement distinct de "la transaction"
  // (TransactionDetailScreen) — jamais un "Modifier"/"Annuler" nu et ambigu.
  expect(screen.getByText('Modifier le paiement')).toBeTruthy();
  expect(screen.getByText('Annuler le paiement')).toBeTruthy();
  fireEvent.press(screen.getByTestId('planning-realized-menu-option-cancel'));

  await waitFor(() => expect(mockUnrealizePlannedOperation).toHaveBeenCalledWith('po-1'));

  // "Voir la transaction" navigue vers l'écran de détail canonique (jamais une
  // mini-modale ad hoc) — même flux Modifier/Annuler/Fermer que partout ailleurs.
  fireEvent(screen.getAllByTestId(/^planning-cell-/)[0], 'longPress');
  await waitFor(() => screen.getByTestId('planning-realized-menu-option-view'));
  fireEvent.press(screen.getByTestId('planning-realized-menu-option-view'));
  expect(mockNavigate).toHaveBeenCalledWith('TransactionDetail', { id: 'op-1' });
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
  // réalisé") rouvre le flux AdjustModal complet, jamais un realize() instantané.
  fireEvent.press(screen.getAllByTestId(/^planning-cell-/)[0]);
  await waitFor(() => screen.getByTestId('planning-detail-pay-adjust-po-2'));
  fireEvent.press(screen.getByTestId('planning-detail-pay-adjust-po-2'));
  await waitFor(() => screen.getByTestId('planning-adjust-submit'));
  await fireEvent.press(screen.getByTestId('planning-adjust-submit'));
  await waitFor(() => expect(mockRealizePlannedOperation).toHaveBeenCalledWith('po-2', expect.objectContaining({ actualAmount: '70' })));
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
  };
}

it("AdjustModal : le sélecteur de source est présélectionné sur la source prévue et l'override est transmis au paiement", async () => {
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
  fireEvent.press(await screen.findByTestId('planning-pending-menu-option-pay'));

  await waitFor(() => screen.getByTestId('planning-adjust-source'));
  // Présélection : la source prévue (CIH — CIH-Voiture) est affichée.
  expect(screen.getByText('CIH — CIH-Voiture')).toBeTruthy();

  // Choisir une autre source (BP Lamiaa, compte principal direct) avant de payer.
  await fireEvent.press(screen.getByTestId('planning-adjust-source'));
  await fireEvent.press(await screen.findByTestId('planning-adjust-source-option-acc:bp'));

  await fireEvent.press(screen.getByTestId('planning-adjust-submit'));
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
  await fireEvent.press(await screen.findByTestId('planning-pending-menu-option-edit'));

  // Ponctuelle : jamais le ChoiceSheet "cette échéance uniquement / et les suivantes".
  expect(screen.queryByTestId('planning-scope-choice-option-single')).toBeNull();
  await waitFor(() => screen.getByTestId('planning-edit-submit'));

  await fireEvent.changeText(screen.getByTestId('planning-edit-amount'), '750');
  await fireEvent.press(screen.getByTestId('planning-edit-submit'));

  await waitFor(() => expect(mockUpdatePlannedOperation).toHaveBeenCalledWith('po-1', expect.objectContaining({ expectedAmount: '750' })));
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
  await fireEvent.press(await screen.findByTestId('planning-pending-menu-option-edit'));

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
  await fireEvent.press(await screen.findByTestId('planning-pending-menu-option-cancel'));

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
  await fireEvent.press(await screen.findByTestId('planning-pending-menu-option-cancel'));
  await fireEvent.press(await screen.findByTestId('planning-scope-choice-option-series'));

  await waitFor(() =>
    expect(mockUpdateRecurrenceRule).toHaveBeenCalledWith('rule-1', expect.objectContaining({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: '2026-09-15', active: false })),
  );
  alertSpy.mockRestore();
});

// Lot "synthèse enrichie" (Part 2 A/D) : bloc compact payé/prévu + reste pour
// les dépenses ET l'épargne, séparé l'un de l'autre et de Balance mensuelle/
// cumulée (conservées inchangées) — adapte le bloc de totaux existant, sans
// reconstruire le Planning.
it('synthèse enrichie : affiche payé/prévu + reste pour les dépenses et l\'épargne, séparément de la balance', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({
      synthese: {
        '2026-09': {
          totalRevenus: 2000,
          totalDepenses: 7300,
          totalEpargne: 1000,
          balanceMensuelle: -6300,
          balanceCumulee: -6300,
          depensesPrevues: 7550,
          depensesPayees: 1450,
          depensesReste: 6100,
          depensesCouvertes: 5500,
          depensesAProvisionner: 600,
          epargnePrevue: 1000,
          epargneVersee: 1000,
          epargneReste: 0,
        },
        '2026-10': emptySynthese(),
        '2026-11': emptySynthese(),
      },
    }),
  );

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByText('DÉPENSES payé/prévu'));
  expect(screen.getByText('ÉPARGNE versé/prévu')).toBeTruthy();

  const depensesCell = screen.getByTestId('planning-synthese-depenses-2026-09');
  expect(within(depensesCell).getByText('1 450/7 550 DH')).toBeTruthy();
  expect(within(depensesCell).getByText('reste 6 100 DH')).toBeTruthy();
  // Couverture (mois courant) : jamais présentée comme une marge globale — "À provisionner", pas "Couvert 5 500 / Marge".
  expect(within(depensesCell).getByText('À provisionner 600 DH')).toBeTruthy();

  const epargneCell = screen.getByTestId('planning-synthese-epargne-2026-09');
  expect(within(epargneCell).getByText('1 000/1 000 DH')).toBeTruthy();
  // L'épargne a son propre "reste" (0), jamais mélangé à celui des dépenses (6 100).
  expect(within(epargneCell).getByText('reste 0 DH')).toBeTruthy();
  // Pas de ligne de couverture pour l'épargne — jamais mélangée aux dépenses.
  expect(within(epargneCell).queryByText(/provisionner|couvert/i)).toBeNull();

  // Mois futurs (2026-10) : pas de 3e ligne de couverture, faute de projection fiable (§8).
  const depensesCellFuture = screen.getByTestId('planning-synthese-depenses-2026-10');
  expect(within(depensesCellFuture).queryByText(/provisionner|couvert/i)).toBeNull();

  // Balance mensuelle/cumulée toujours présentes, affichage inchangé.
  expect(screen.getByText('BALANCE MENSUELLE')).toBeTruthy();
  expect(screen.getByText('BALANCE CUMULÉE')).toBeTruthy();
});

it('synthèse enrichie : "✓ Tout est couvert" quand depensesAProvisionner vaut 0 (mois courant)', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({
      synthese: {
        '2026-09': { ...emptySynthese(), depensesPrevues: 1200, depensesPayees: 0, depensesReste: 1200, depensesCouvertes: 1200, depensesAProvisionner: 0 },
        '2026-10': emptySynthese(),
        '2026-11': emptySynthese(),
      },
    }),
  );

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByText('DÉPENSES payé/prévu'));
  const depensesCell = screen.getByTestId('planning-synthese-depenses-2026-09');
  expect(within(depensesCell).getByText('✓ Tout est couvert')).toBeTruthy();
  expect(within(depensesCell).queryByText(/provisionner/i)).toBeNull();
});
