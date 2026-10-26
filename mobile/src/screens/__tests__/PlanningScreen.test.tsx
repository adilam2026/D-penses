import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PlanningScreen } from '../PlanningScreen';
import { clearCache } from '../../state/cache';
import * as api from '../../api/client';
import type { PlanningTableApi } from '../../api/client';
import { colors } from '../../ui/theme';
import { formatDh, formatMonthShort } from '../../ui/formatMoney';
import { shiftMonthKey } from '../../ui/monthKey';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
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
  updatePlannedOperation: (...args: unknown[]) => mockUpdatePlannedOperation(...args),
  cancelPlannedOperation: (...args: unknown[]) => mockCancelPlannedOperation(...args),
  listRecurrenceRules: (...args: unknown[]) => mockListRecurrenceRules(...args),
  updateRecurrenceRule: (...args: unknown[]) => mockUpdateRecurrenceRule(...args),
  getMyHousehold: () => mockGetMyHousehold(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
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

function voitureSingleOccurrence(overrides?: Partial<PlanningTableApi['depenses'][number]['cells'][string]['singleOccurrence']>) {
  return {
    plannedOperationId: 'po-1',
    status: 'PENDING' as const,
    expectedAmount: 700,
    realizedAmount: null as number | null,
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
    ...overrides,
  };
}

function pendingVoitureCell(overrides?: Partial<ReturnType<typeof voitureSingleOccurrence>>) {
  return {
    displayAmount: 700,
    budgetAmount: 700,
    pendingAmount: 700,
    realizedAmount: 0,
    status: 'PENDING' as const,
    singleOccurrence: voitureSingleOccurrence(overrides),
    items: [{ type: 'PLANNED_PENDING' as const, plannedOperationId: 'po-1', label: 'Assurance voiture', amount: 700, date: '2026-09-15', sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null }],
  };
}

function depensesWithCell(cell: ReturnType<typeof pendingVoitureCell> | ReturnType<typeof emptyCell>): PlanningTableApi {
  return basePlanning({ depenses: [{ key: 'cat-voiture', label: 'Voiture', categoryId: 'cat-voiture', cells: { '2026-09': cell, '2026-10': emptyCell(), '2026-11': emptyCell() } }] });
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

async function openAccordionAndPressCell() {
  // Le bloc DÉPENSES démarre replié par défaut (§7) — il faut le déplier
  // avant d'atteindre une case. Attend d'abord que le chargement initial soit
  // terminé (le toggle n'existe pas tant que l'écran affiche le spinner).
  await waitFor(() => screen.getByTestId('planning-block-toggle-depenses'));
  fireEvent.press(screen.getByTestId('planning-block-toggle-depenses'));
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  fireEvent.press(screen.getAllByTestId(/^planning-cell-/)[0]);
}

it("affiche le sélecteur d'horizon (3/6/9/12) avec 6 mois actif par défaut", async () => {
  mockGetPlanning.mockResolvedValue(basePlanning());
  renderWithSafeArea(<PlanningScreen />);
  // Sans navigation : aucune période demandée, le backend part du mois courant.
  await waitFor(() => expect(mockGetPlanning).toHaveBeenCalledWith(6, null));
  expect(screen.getByTestId('planning-horizon-3')).toBeTruthy();
  expect(screen.getByTestId('planning-horizon-12')).toBeTruthy();
});

it("changer d'horizon relance getPlanning avec le nouveau nombre de mois", async () => {
  mockGetPlanning.mockResolvedValue(basePlanning());
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => expect(mockGetPlanning).toHaveBeenCalledWith(6, null));
  fireEvent.press(screen.getByTestId('planning-horizon-12'));
  await waitFor(() => expect(mockGetPlanning).toHaveBeenCalledWith(12, null));
});

it('accordéons (§7) : Revenus ouvert par défaut, Dépenses/Versements repliés par défaut', async () => {
  mockGetPlanning.mockResolvedValue(depensesWithCell(pendingVoitureCell()));
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-accordion-revenus'));
  // Revenus : vide mais ouvert -> le texte "Aucun revenu prévu." est visible.
  expect(screen.getByText('Aucun revenu prévu.')).toBeTruthy();
  // Dépenses : replié par défaut -> "Voiture" n'est pas encore visible.
  expect(screen.queryByText('Voiture')).toBeNull();
  fireEvent.press(screen.getByTestId('planning-block-toggle-depenses'));
  await waitFor(() => expect(screen.getByText('Voiture')).toBeTruthy());
  fireEvent.press(screen.getByTestId('planning-block-toggle-depenses'));
  await waitFor(() => expect(screen.queryByText('Voiture')).toBeNull());
});

it("case prévue (PENDING) : tap ouvre l'ActionSheet, le paiement total est UNE SEULE action directe (aucun formulaire intermédiaire)", async () => {
  mockGetPlanning.mockResolvedValue(depensesWithCell(pendingVoitureCell()));
  mockRealizePlannedOperation.mockResolvedValue({});

  renderWithSafeArea(<PlanningScreen />);
  await openAccordionAndPressCell();
  await waitFor(() => screen.getByTestId('action-sheet-pay'));
  expect(mockRealizePlannedOperation).not.toHaveBeenCalled();

  // Un seul appui sur "Payer 700 DH" déclenche directement le paiement — jamais de formulaire.
  expect(screen.queryByTestId('action-sheet-pay-amount')).toBeNull();
  fireEvent.press(screen.getByTestId('action-sheet-pay'));
  await waitFor(() => expect(mockRealizePlannedOperation).toHaveBeenCalledWith('po-1', expect.objectContaining({ actualAmount: '700' })));
  await waitFor(() => screen.getByText('Voiture payé'));
});

it("case prévue : appui long ouvre EXACTEMENT le même ActionSheet que le tap (§3)", async () => {
  mockGetPlanning.mockResolvedValue(depensesWithCell(pendingVoitureCell()));
  mockRealizePlannedOperation.mockResolvedValue({});

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-block-toggle-depenses'));
  fireEvent.press(screen.getByTestId('planning-block-toggle-depenses'));
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  fireEvent(screen.getAllByTestId(/^planning-cell-/)[0], 'longPress');

  await waitFor(() => screen.getByTestId('action-sheet-pay'));
  fireEvent.press(screen.getByTestId('action-sheet-pay'));
  await waitFor(() => expect(mockRealizePlannedOperation).toHaveBeenCalledWith('po-1', expect.objectContaining({ actualAmount: '700' })));
});

it("case prévue : \"Fermer\" ferme l'ActionSheet sans déclencher de paiement", async () => {
  mockGetPlanning.mockResolvedValue(depensesWithCell(pendingVoitureCell()));

  renderWithSafeArea(<PlanningScreen />);
  await openAccordionAndPressCell();
  await waitFor(() => screen.getByTestId('action-sheet-close'));
  fireEvent.press(screen.getByTestId('action-sheet-close'));
  await waitFor(() => expect(screen.queryByTestId('action-sheet-close')).toBeNull());
  expect(mockRealizePlannedOperation).not.toHaveBeenCalled();
});

it('case prévue : paiement partiel ne demande QUE le montant (pas de date, pas de compte)', async () => {
  const cell = pendingVoitureCell();
  cell.displayAmount = 1000;
  cell.budgetAmount = 1000;
  cell.pendingAmount = 1000;
  cell.singleOccurrence.expectedAmount = 1000;
  mockGetPlanning.mockResolvedValue(depensesWithCell(cell));
  mockPartialRealizePlannedOperation.mockResolvedValue({});

  renderWithSafeArea(<PlanningScreen />);
  await openAccordionAndPressCell();
  await waitFor(() => screen.getByTestId('action-sheet-partial'));
  fireEvent.press(screen.getByTestId('action-sheet-partial'));
  await waitFor(() => screen.getByTestId('action-sheet-partial-submit'));

  expect(screen.queryByTestId('action-sheet-partial-source')).toBeNull();
  expect(screen.getByTestId('action-sheet-partial-submit').props.accessibilityState?.disabled).toBe(true);

  fireEvent.changeText(screen.getByTestId('action-sheet-partial-amount'), '400');
  await waitFor(() => screen.getByText('Il restera 600 DH à payer.'));
  fireEvent.press(screen.getByTestId('action-sheet-partial-submit'));

  await waitFor(() => expect(mockPartialRealizePlannedOperation).toHaveBeenCalledWith('po-1', expect.objectContaining({ actualAmount: '400' })));
  expect(mockRealizePlannedOperation).not.toHaveBeenCalled();
});

it('case partiellement payée (MIXTE) : reste toujours interactive, "Nouveau paiement partiel" après un 1er paiement', async () => {
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
              singleOccurrence: voitureSingleOccurrence({ plannedOperationId: 'po-carburant', expectedAmount: 800, realizedAmount: 300, sourceSubaccountId: null }),
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
  await waitFor(() => screen.getByTestId('planning-block-toggle-depenses'));
  fireEvent.press(screen.getByTestId('planning-block-toggle-depenses'));
  await waitFor(() => screen.getAllByTestId(/^planning-cell-/));
  expect(screen.getByText('300/800 DH')).toBeTruthy();
  expect(screen.getByText('reste 500 DH')).toBeTruthy();

  fireEvent(screen.getAllByTestId(/^planning-cell-/)[0], 'longPress');
  await waitFor(() => screen.getByTestId('action-sheet-pay'));
  expect(screen.getByTestId('action-sheet-deja-paye').props.children).toBe('300 DH');
  expect(screen.getByTestId('action-sheet-reste').props.children).toBe('500 DH');
  expect(screen.getByText('Nouveau paiement partiel')).toBeTruthy();

  fireEvent.press(screen.getByTestId('action-sheet-partial'));
  await waitFor(() => screen.getByTestId('action-sheet-partial-submit'));
  fireEvent.changeText(screen.getByTestId('action-sheet-partial-amount'), '200');
  await waitFor(() => expect(screen.getByTestId('action-sheet-partial-submit').props.accessibilityState?.disabled).toBe(false));
  fireEvent.press(screen.getByTestId('action-sheet-partial-submit'));
  await waitFor(() => expect(mockPartialRealizePlannedOperation).toHaveBeenCalledWith('po-carburant', expect.objectContaining({ actualAmount: '200' })));
});

it("échéance payée : le menu propose Voir la transaction / Annuler le paiement / Modifier / Annuler l'échéance", async () => {
  mockGetPlanning.mockResolvedValue(
    depensesWithCell({
      displayAmount: 820,
      budgetAmount: 820,
      pendingAmount: 0,
      realizedAmount: 820,
      status: 'REALIZED',
      singleOccurrence: voitureSingleOccurrence({ status: 'REALIZED', realizedAmount: 820, realizedOperationId: 'op-1' }),
      items: [{ type: 'PLANNED_REALIZED', plannedOperationId: 'po-1', financialOperationId: 'op-1', label: 'Assurance voiture', amount: 820, date: '2026-09-15', sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null }],
    }),
  );

  renderWithSafeArea(<PlanningScreen />);
  await openAccordionAndPressCell();
  await waitFor(() => screen.getByTestId('action-sheet-unrealize'));
  expect(screen.getByText('✓ Payé entièrement — 700 DH')).toBeTruthy();
  expect(screen.getByTestId('action-sheet-view-transaction')).toBeTruthy();
  expect(screen.getByTestId('action-sheet-edit-paid')).toBeTruthy();
  expect(screen.getByTestId('action-sheet-cancel-paid')).toBeTruthy();

  fireEvent.press(screen.getByTestId('action-sheet-view-transaction'));
  expect(mockNavigate).toHaveBeenCalledWith('TransactionDetail', { id: 'op-1' });
});

it('"Annuler le paiement" mute immédiatement (c\'est l\'action elle-même) et affiche un toast', async () => {
  mockGetPlanning.mockResolvedValue(
    depensesWithCell({
      displayAmount: 700,
      budgetAmount: 700,
      pendingAmount: 0,
      realizedAmount: 700,
      status: 'REALIZED',
      singleOccurrence: voitureSingleOccurrence({ status: 'REALIZED', realizedAmount: 700, realizedOperationId: 'op-1' }),
      items: [{ type: 'PLANNED_REALIZED', plannedOperationId: 'po-1', financialOperationId: 'op-1', label: 'Assurance voiture', amount: 700, date: '2026-09-15', sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null }],
    }),
  );
  mockUnrealizePlannedOperation.mockResolvedValue({});

  renderWithSafeArea(<PlanningScreen />);
  await openAccordionAndPressCell();
  await waitFor(() => screen.getByTestId('action-sheet-unrealize'));
  expect(mockUnrealizePlannedOperation).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('action-sheet-unrealize'));
  await waitFor(() => expect(mockUnrealizePlannedOperation).toHaveBeenCalledWith('po-1'));
  await waitFor(() => screen.getByText('Paiement annulé'));
});

// ---------------------------------------------------------------------
// §20/§40 — BUG CRITIQUE corrigé : ouvrir/choisir Modifier sur une
// échéance déjà payée ne doit JAMAIS muter quoi que ce soit avant Enregistrer.
// ---------------------------------------------------------------------
describe('Modifier une échéance déjà payée — aucune mutation avant Enregistrer (§20/§40)', () => {
  function realizedVoiture() {
    return depensesWithCell({
      displayAmount: 600,
      budgetAmount: 600,
      pendingAmount: 0,
      realizedAmount: 600,
      status: 'REALIZED',
      singleOccurrence: voitureSingleOccurrence({ expectedAmount: 600, status: 'REALIZED', realizedAmount: 600, realizedOperationId: 'op-1' }),
      items: [{ type: 'PLANNED_REALIZED', plannedOperationId: 'po-1', financialOperationId: 'op-1', label: 'CNSS', amount: 600, date: '2026-09-15', sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null }],
    });
  }

  it("ouvrir le menu puis choisir Modifier n'appelle ni unrealize ni update tant que Enregistrer n'est pas pressé", async () => {
    mockGetPlanning.mockResolvedValue(realizedVoiture());
    mockUpdatePlannedOperation.mockResolvedValue({ status: 'REALIZED', expectedAmount: 600 });

    renderWithSafeArea(<PlanningScreen />);
    await openAccordionAndPressCell();
    await waitFor(() => screen.getByTestId('action-sheet-edit-paid'));
    fireEvent.press(screen.getByTestId('action-sheet-edit-paid'));

    await waitFor(() => screen.getByTestId('planning-edit-submit'));
    // Aucune mutation déclenchée par la seule navigation jusqu'ici.
    expect(mockUnrealizePlannedOperation).not.toHaveBeenCalled();
    expect(mockUpdatePlannedOperation).not.toHaveBeenCalled();
    // Le formulaire affiche explicitement le paiement déjà existant.
    expect(screen.getByTestId('planning-edit-already-paid')).toBeTruthy();

    fireEvent.press(screen.getByTestId('planning-edit-submit'));
    await waitFor(() => expect(mockUpdatePlannedOperation).toHaveBeenCalledWith('po-1', expect.objectContaining({ expectedAmount: '600' })));
    // Jamais de reversal pour un simple "Modifier".
    expect(mockUnrealizePlannedOperation).not.toHaveBeenCalled();
  });

  it("fermer le formulaire (Annuler) sans Enregistrer ne mute rien", async () => {
    mockGetPlanning.mockResolvedValue(realizedVoiture());

    renderWithSafeArea(<PlanningScreen />);
    await openAccordionAndPressCell();
    fireEvent.press(await screen.findByTestId('action-sheet-edit-paid'));
    await waitFor(() => screen.getByTestId('planning-edit-cancel'));
    fireEvent.press(screen.getByTestId('planning-edit-cancel'));

    await waitFor(() => expect(screen.queryByTestId('planning-edit-cancel')).toBeNull());
    expect(mockUnrealizePlannedOperation).not.toHaveBeenCalled();
    expect(mockUpdatePlannedOperation).not.toHaveBeenCalled();
  });

  it('augmenter 600 -> 800 (au-delà du déjà-payé) : le backend rebascule en PENDING, le toast le reflète', async () => {
    mockGetPlanning.mockResolvedValue(realizedVoiture());
    mockUpdatePlannedOperation.mockResolvedValue({ status: 'PENDING', expectedAmount: 800, realizedOperationId: null });

    renderWithSafeArea(<PlanningScreen />);
    await openAccordionAndPressCell();
    fireEvent.press(await screen.findByTestId('action-sheet-edit-paid'));
    await waitFor(() => screen.getByTestId('planning-edit-submit'));

    fireEvent.changeText(screen.getByTestId('planning-edit-amount'), '800');
    await waitFor(() => expect(screen.getByTestId('planning-edit-amount').props.value).toBe('800'));
    fireEvent.press(screen.getByTestId('planning-edit-submit'));

    await waitFor(() => expect(mockUpdatePlannedOperation).toHaveBeenCalledWith('po-1', expect.objectContaining({ expectedAmount: '800' })));
    await waitFor(() => screen.getByText('Échéance modifiée — reste à exécuter'));
  });

  it('tentative 600 -> 500 (sous le déjà-payé) refusée par le backend : erreur affichée, formulaire reste ouvert', async () => {
    mockGetPlanning.mockResolvedValue(realizedVoiture());
    mockUpdatePlannedOperation.mockRejectedValue(
      new api.ApiError(400, "600 DH ont déjà été payés. Annulez ou corrigez d'abord les paiements existants pour réduire l'échéance sous ce montant."),
    );

    renderWithSafeArea(<PlanningScreen />);
    await openAccordionAndPressCell();
    fireEvent.press(await screen.findByTestId('action-sheet-edit-paid'));
    await waitFor(() => screen.getByTestId('planning-edit-submit'));

    fireEvent.changeText(screen.getByTestId('planning-edit-amount'), '500');
    await waitFor(() => expect(screen.getByTestId('planning-edit-amount').props.value).toBe('500'));
    fireEvent.press(screen.getByTestId('planning-edit-submit'));

    await waitFor(() => screen.getByTestId('planning-edit-error'));
    expect(screen.getByTestId('planning-edit-submit')).toBeTruthy();
  });
});

it('"Modifier l\'échéance" sur une échéance ponctuelle ouvre directement le formulaire (jamais de choix de portée)', async () => {
  mockGetPlanning.mockResolvedValue(depensesWithCell(pendingVoitureCell()));
  mockUpdatePlannedOperation.mockResolvedValue({ status: 'PENDING' });

  renderWithSafeArea(<PlanningScreen />);
  await openAccordionAndPressCell();
  fireEvent.press(await screen.findByTestId('action-sheet-edit'));

  expect(screen.queryByTestId('planning-edit-scope-single')).toBeNull();
  await waitFor(() => screen.getByTestId('planning-edit-submit'));
  fireEvent.changeText(screen.getByTestId('planning-edit-amount'), '750');
  await waitFor(() => expect(screen.getByTestId('planning-edit-amount').props.value).toBe('750'));
  fireEvent.press(screen.getByTestId('planning-edit-submit'));

  await waitFor(() => expect(mockUpdatePlannedOperation).toHaveBeenCalledWith('po-1', expect.objectContaining({ expectedAmount: '750' })));
  const call = mockUpdatePlannedOperation.mock.calls[0][1];
  expect(call).not.toHaveProperty('responsibleMemberId');
  expect(call).not.toHaveProperty('responsibleSource');
});

it('"Modifier l\'échéance" — modifier EXPLICITEMENT le Responsable envoie responsibleMemberId + responsibleSource=MANUAL', async () => {
  mockGetPlanning.mockResolvedValue(depensesWithCell(pendingVoitureCell()));
  mockUpdatePlannedOperation.mockResolvedValue({ status: 'PENDING' });

  renderWithSafeArea(<PlanningScreen />);
  await openAccordionAndPressCell();
  fireEvent.press(await screen.findByTestId('action-sheet-edit'));
  await waitFor(() => screen.getByTestId('planning-edit-submit'));

  fireEvent.press(screen.getByTestId('planning-edit-responsible-member'));
  fireEvent.press(await screen.findByTestId('planning-edit-responsible-member-option-m-adil'));
  await waitFor(() => expect(screen.queryByTestId('planning-edit-responsible-member-option-m-adil')).toBeNull());
  fireEvent.press(screen.getByTestId('planning-edit-submit'));

  await waitFor(() => expect(mockUpdatePlannedOperation).toHaveBeenCalledWith('po-1', expect.objectContaining({ responsibleMemberId: 'm-adil', responsibleSource: 'MANUAL' })));
});

it('"Modifier l\'échéance" sur une occurrence récurrente : choix de portée EMBARQUÉ, "et les suivantes" appelle updateRecurrenceRule', async () => {
  mockGetPlanning.mockResolvedValue(depensesWithCell(pendingVoitureCell({ recurrenceRuleId: 'rule-1' })));
  mockListRecurrenceRules.mockResolvedValue([
    { id: 'rule-1', frequency: 'MONTHLY', anchorDate: '2026-09-15', label: 'Voiture', active: true, kind: 'EXPENSE', expectedAmount: 700, categoryId: null, sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null },
  ]);
  mockUpdateRecurrenceRule.mockResolvedValue({});

  renderWithSafeArea(<PlanningScreen />);
  await openAccordionAndPressCell();
  fireEvent.press(await screen.findByTestId('action-sheet-edit'));
  await waitFor(() => screen.getByTestId('planning-edit-scope-series'));

  // Toujours la MÊME sheet, pas d'étape intermédiaire.
  fireEvent.press(screen.getByTestId('planning-edit-scope-series'));
  // Laisse l'appel listRecurrenceRules (chargement de la périodicité) se
  // résoudre PENDANT que le composant est encore monté — sinon son .then()
  // arrive après le démontage et perturbe le test suivant.
  await waitFor(() => expect(mockListRecurrenceRules).toHaveBeenCalled());
  fireEvent.changeText(screen.getByTestId('planning-edit-amount'), '800');
  await waitFor(() => expect(screen.getByTestId('planning-edit-amount').props.value).toBe('800'));
  fireEvent.press(screen.getByTestId('planning-edit-submit'));

  await waitFor(() =>
    expect(mockUpdateRecurrenceRule).toHaveBeenCalledWith('rule-1', expect.objectContaining({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: '2026-09-15', expectedAmount: '800' })),
  );
  await waitFor(() => expect(mockListAccounts.mock.calls.length).toBeGreaterThanOrEqual(2));
});

it('"Annuler l\'échéance" ponctuelle : une seule sheet de confirmation, mutation différée à "Confirmer l\'annulation"', async () => {
  mockGetPlanning.mockResolvedValue(depensesWithCell(pendingVoitureCell()));
  mockCancelPlannedOperation.mockResolvedValue({});

  renderWithSafeArea(<PlanningScreen />);
  await openAccordionAndPressCell();
  fireEvent.press(await screen.findByTestId('action-sheet-cancel'));

  await waitFor(() => screen.getByTestId('cancel-occurrence-sheet'));
  expect(mockCancelPlannedOperation).not.toHaveBeenCalled();
  expect(screen.queryByTestId('cancel-sheet-scope-single')).toBeNull();

  fireEvent.press(screen.getByTestId('cancel-sheet-confirm'));
  await waitFor(() => expect(mockCancelPlannedOperation).toHaveBeenCalledWith('po-1'));
  // Laisse le refresh() post-mutation se terminer avant la fin du test (évite
  // qu'une promesse en vol ne s'achève pendant le test suivant).
  await waitFor(() => expect(mockListAccounts.mock.calls.length).toBeGreaterThanOrEqual(2));
});

it('"Annuler l\'échéance" récurrente : "et les suivantes" arrête la série (active:false) sans toucher au pivot', async () => {
  mockGetPlanning.mockResolvedValue(depensesWithCell(pendingVoitureCell({ recurrenceRuleId: 'rule-1' })));
  mockUpdateRecurrenceRule.mockResolvedValue({});

  renderWithSafeArea(<PlanningScreen />);
  await openAccordionAndPressCell();
  fireEvent.press(await screen.findByTestId('action-sheet-cancel'));
  await waitFor(() => screen.getByTestId('cancel-sheet-scope-series'));
  fireEvent.press(screen.getByTestId('cancel-sheet-scope-series'));
  await waitFor(() => expect(screen.getByTestId('cancel-sheet-scope-series').props.accessibilityState?.selected ?? true).toBeTruthy());
  fireEvent.press(screen.getByTestId('cancel-sheet-confirm'));

  await waitFor(() =>
    expect(mockUpdateRecurrenceRule).toHaveBeenCalledWith('rule-1', expect.objectContaining({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: '2026-09-15', active: false })),
  );
  expect(mockCancelPlannedOperation).not.toHaveBeenCalled();
  await waitFor(() => expect(mockListAccounts.mock.calls.length).toBeGreaterThanOrEqual(2));
});

it('"Annuler l\'échéance" sur une échéance déjà payée (REALIZED) : avertit du paiement, annule le paiement PUIS l\'échéance au confirm', async () => {
  mockGetPlanning.mockResolvedValue(
    depensesWithCell({
      displayAmount: 600,
      budgetAmount: 600,
      pendingAmount: 0,
      realizedAmount: 600,
      status: 'REALIZED',
      singleOccurrence: voitureSingleOccurrence({ expectedAmount: 600, status: 'REALIZED', realizedAmount: 600, realizedOperationId: 'op-1' }),
      items: [{ type: 'PLANNED_REALIZED', plannedOperationId: 'po-1', financialOperationId: 'op-1', label: 'CNSS', amount: 600, date: '2026-09-15', sourceAccountId: 'cih', sourceSubaccountId: 'voiture', destinationAccountId: null, destinationSubaccountId: null }],
    }),
  );
  mockUnrealizePlannedOperation.mockResolvedValue({});
  mockCancelPlannedOperation.mockResolvedValue({});

  renderWithSafeArea(<PlanningScreen />);
  await openAccordionAndPressCell();
  fireEvent.press(await screen.findByTestId('action-sheet-cancel-paid'));

  await waitFor(() => screen.getByTestId('cancel-sheet-payment-warning'));
  expect(mockUnrealizePlannedOperation).not.toHaveBeenCalled();
  expect(mockCancelPlannedOperation).not.toHaveBeenCalled();

  fireEvent.press(screen.getByTestId('cancel-sheet-confirm'));
  await waitFor(() => expect(mockUnrealizePlannedOperation).toHaveBeenCalledWith('po-1'));
  await waitFor(() => expect(mockCancelPlannedOperation).toHaveBeenCalledWith('po-1'));
  await waitFor(() => expect(mockListAccounts.mock.calls.length).toBeGreaterThanOrEqual(2));
});

it('case agrégée (plusieurs éléments) : tap ouvre le détail de catégorie', async () => {
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
  await openAccordionAndPressCell();
  await waitFor(() => screen.getByText('Aspirateur'));
  expect(screen.getByText('Cadeau')).toBeTruthy();
});

it('case MIXTE (200 réalisé + 70 à venir) : split compact, "Payer / Ajuster" rouvre l\'ActionSheet, paiement direct', async () => {
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
                { type: 'PLANNED_PENDING', plannedOperationId: 'po-2', label: 'Poste B', amount: 70, expectedAmount: 70, date: '2026-09-20', sourceAccountId: 'cih', sourceSubaccountId: null, destinationAccountId: null, destinationSubaccountId: null, recurrenceRuleId: null, categoryId: 'cat-divers', kind: 'EXPENSE' },
              ],
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
  await waitFor(() => screen.getByTestId('planning-block-toggle-depenses'));
  fireEvent.press(screen.getByTestId('planning-block-toggle-depenses'));
  await waitFor(() => screen.getByText('200/270 DH'));
  expect(screen.queryByText(/270 DH ✓/)).toBeNull();
  expect(screen.getByText('reste 70 DH')).toBeTruthy();

  fireEvent.press(screen.getAllByTestId(/^planning-cell-/)[0]);
  await waitFor(() => screen.getByTestId('planning-detail-pay-adjust-po-2'));
  fireEvent.press(screen.getByTestId('planning-detail-pay-adjust-po-2'));
  await waitFor(() => screen.getByTestId('action-sheet-pay'));
  fireEvent.press(screen.getByTestId('action-sheet-pay'));
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
  fireEvent.press(screen.getByTestId('planning-plan-plan-1'));
  expect(mockNavigate).toHaveBeenCalledWith('FinancialPlanDetail', { id: 'plan-1' });
});

// ---------------------------------------------------------------------------
// Correctif Planning compact : ordre, cartes une ligne, navigation flèches +
// swipe, 3 mois visibles, synthèse finale (résultat / reste / projection).
// ---------------------------------------------------------------------------

const SIX_MONTHS = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02'];

function sixMonthPlanning(): PlanningTableApi {
  const synthese: PlanningTableApi['synthese'] = {};
  SIX_MONTHS.forEach((m, i) => {
    synthese[m] = { ...emptySynthese(), resultatPrevu: (i + 1) * 100, projectionCumulee: (i + 1) * 1000 };
  });
  synthese['2026-09'] = { ...synthese['2026-09'], resteDepenses: 3600, resteVersements: 0, couverte: false, aProvisionner: 1650 };
  return { months: SIX_MONTHS, revenus: [], depenses: [], epargne: [], synthese };
}

/** Revenu fictif propre à chaque mois ("2027-07" → 2 707), pour reconnaître la période affichée. */
function revenusOf(month: string): number {
  return Number(month.replace('-', '')) % 100000;
}

/**
 * Faux GET /planning?months=N&from=AAAA-MM respectant le contrat backend :
 * plage de N mois à partir de `from` (ou du mois courant), reste à exécuter
 * sur le seul mois courant, projection nulle pour un mois passé.
 */
function planningByRange(current = '2026-09') {
  mockGetPlanning.mockImplementation((n: number, from?: string | null) => {
    const months = Array.from({ length: n }, (_, i) => shiftMonthKey(from ?? current, i));
    const synthese: PlanningTableApi['synthese'] = {};
    for (const m of months) {
      synthese[m] = {
        ...emptySynthese(),
        totalRevenus: revenusOf(m),
        resultatPrevu: revenusOf(m),
        projectionCumulee: m < current ? null : revenusOf(m) * 10,
        ...(m === current ? { resteDepenses: 100, resteVersements: 0, couverte: true, aProvisionner: 0 } : {}),
      };
    }
    const cells = Object.fromEntries(months.map((m) => [m, { ...emptyCell(), displayAmount: revenusOf(m), budgetAmount: revenusOf(m), pendingAmount: revenusOf(m), status: 'PENDING' as const }]));
    return Promise.resolve({ months, currentMonth: current, revenus: [{ key: 'sal', label: 'Salaire', categoryId: 'sal', cells }], depenses: [], epargne: [], synthese });
  });
}

type JsonNode ={ type: string; props: Record<string, any>; children: (JsonNode | string)[] | null };

/** testIDs des composants hôtes, dans l'ordre d'affichage (parcours en profondeur). */
function renderedTestIds(): string[] {
  const out: string[] = [];
  const walk = (node: JsonNode | JsonNode[] | string | null) => {
    if (!node || typeof node === 'string') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node.props?.testID === 'string') out.push(node.props.testID);
    (node.children ?? []).forEach(walk);
  };
  walk(screen.toJSON() as unknown as JsonNode);
  return out;
}

/** Les 3 mois de la barre de navigation (précédent, actif, suivant). */
function visibleMonthLabels(): string[] {
  return ['prev', 'active', 'next'].map((z) => screen.getByTestId(`planning-period-${z}-label`).props.children as string);
}

/** Libellé d'un mois dans la barre ("2026-10" → "OCT. 26"). */
function navLabel(monthKey: string): string {
  return formatMonthShort(monthKey).toUpperCase();
}

async function swipe(dx: number, dy = 0) {
  const area = screen.getByTestId('planning-swipe-area');
  await fireEvent(area, 'touchStart', { nativeEvent: { pageX: 200, pageY: 300 } });
  await fireEvent(area, 'responderRelease', { nativeEvent: { pageX: 200 + dx, pageY: 300 + dy } });
}

/** Texte rendu par un élément Text porteur du testID. */
function textOf(testID: string): string {
  const children = screen.getByTestId(testID).props.children;
  return (Array.isArray(children) ? children : [children]).join('').replace(/\s/g, ' ');
}

it("ordre exact : horizon, mois, cartes compactes, Revenus/Dépenses/Versements, puis résultat / reste / projection", async () => {
  mockGetPlanning.mockResolvedValue(sixMonthPlanning());
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-final-synthese'));

  const wanted = [
    'planning-horizon-3',
    'planning-month-nav',
    'planning-summary-cards',
    'planning-accordion-revenus',
    'planning-accordion-depenses',
    'planning-accordion-epargne-versements',
    'planning-final-synthese',
    'planning-resultat-prevu-row',
    'planning-reste-section',
    'planning-projection-section',
  ];
  const order = renderedTestIds().filter((id) => wanted.includes(id));
  expect(order.filter((id, i) => order.indexOf(id) === i)).toEqual(wanted);
});

it('cartes synthétiques compactes : une seule ligne libellé/montant, "RÉSULTAT", fond corail si négatif, mois actif', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({
      synthese: {
        '2026-09': { totalRevenus: 81400, totalDepenses: 71650, totalEpargne: 11600, resultatPrevu: -1850, projectionCumulee: -1850, resteDepenses: null, resteVersements: null, couverte: null, aProvisionner: null },
        '2026-10': emptySynthese(),
        '2026-11': emptySynthese(),
      },
    }),
  );
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-summary-card-revenus'));

  const cards: [string, string, string][] = [
    ['planning-summary-card-revenus', 'REVENUS', '81 400 DH'],
    ['planning-summary-card-depenses', 'DÉPENSES', '71 650 DH'],
    ['planning-summary-card-versements', 'VERSEMENTS', '11 600 DH'],
    ['planning-summary-card-resultat', 'RÉSULTAT', '-1 850 DH'],
  ];
  for (const [id, label, amount] of cards) {
    const card = screen.getByTestId(id);
    expect(StyleSheet.flatten(card.props.style).flexDirection).toBe('row');
    expect(within(card).getByText(label)).toBeTruthy();
    expect(within(card).getByText(amount)).toBeTruthy();
  }
  expect(within(screen.getByTestId('planning-summary-cards')).queryByText('RÉSULTAT PRÉVU')).toBeNull();
  expect(StyleSheet.flatten(screen.getByTestId('planning-summary-card-resultat').props.style).backgroundColor).toBe(colors.dangerLight);
  expect(StyleSheet.flatten(screen.getByTestId('planning-summary-card-revenus').props.style).backgroundColor).not.toBe(colors.dangerLight);
});

it('barre des mois : 3 mois, actif au centre souligné, aucune ancienne flèche ‹ ›', async () => {
  mockGetPlanning.mockResolvedValue(sixMonthPlanning());
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-period'));

  expect(visibleMonthLabels()).toEqual(SIX_MONTHS.slice(0, 3).map(navLabel));
  expect(screen.queryByTestId('planning-month-prev')).toBeNull();
  expect(screen.queryByTestId('planning-month-next')).toBeNull();
  const nav = screen.getByTestId('planning-month-nav');
  expect(within(nav).queryByText(/[‹›]/)).toBeNull();

  // Mois actif : gras + trait corail ; mois voisins : discrets.
  const active = StyleSheet.flatten(screen.getByTestId('planning-period-active-label').props.style);
  const side = StyleSheet.flatten(screen.getByTestId('planning-period-next-label').props.style);
  expect(active.color).toBe(colors.textPrimary);
  expect(side.color).toBe(colors.textSecondary);
  expect(active.fontSize).toBeGreaterThan(side.fontSize);
  const zone = screen.getByTestId('planning-period-active');
  expect(StyleSheet.flatten(zone.props.style).minHeight).toBeGreaterThanOrEqual(44);
});

it('toucher le mois de droite / de gauche déplace la fenêtre d’un mois, toujours 3 colonnes, au-delà de la plage chargée', async () => {
  planningByRange();
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-period-next'));
  expect(visibleMonthLabels()).toEqual(['SEPT. 26', 'OCT. 26', 'NOV. 26']);

  await fireEvent.press(screen.getByTestId('planning-period-next'));
  await waitFor(() => expect(visibleMonthLabels()).toEqual(['OCT. 26', 'NOV. 26', 'DÉC. 26']));
  await fireEvent.press(screen.getByTestId('planning-period-prev'));
  await waitFor(() => expect(visibleMonthLabels()).toEqual(['SEPT. 26', 'OCT. 26', 'NOV. 26']));

  // Avant le début de la plage : rechargement de la période précédente, jamais bloqué.
  await fireEvent.press(screen.getByTestId('planning-period-prev'));
  await waitFor(() => expect(visibleMonthLabels()).toEqual(['AOÛT 26', 'SEPT. 26', 'OCT. 26']));
  expect(mockGetPlanning).toHaveBeenLastCalledWith(6, '2026-05');

  // Après la fin de la plage : rechargement à partir de la fenêtre ; jamais 2 ni 4 mois.
  for (let i = 0; i < 6; i++) {
    await fireEvent.press(screen.getByTestId('planning-period-next'));
    await waitFor(() => expect(visibleMonthLabels()).toHaveLength(3));
  }
  await waitFor(() => expect(visibleMonthLabels()).toEqual(['FÉVR. 27', 'MARS 27', 'AVR. 27']));
  expect(screen.getAllByTestId(/^planning-resultat-prevu-\d{4}-\d{2}$/)).toHaveLength(3);
});

it('swipe gauche -> période suivante, swipe droite -> période précédente (même logique que le toucher des mois)', async () => {
  mockGetPlanning.mockResolvedValue(sixMonthPlanning());
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-swipe-area'));

  await swipe(-120);
  await waitFor(() => expect(visibleMonthLabels()).toEqual(SIX_MONTHS.slice(1, 4).map(navLabel)));
  await swipe(-120);
  await waitFor(() => expect(visibleMonthLabels()).toEqual(SIX_MONTHS.slice(2, 5).map(navLabel)));
  await swipe(120);
  await waitFor(() => expect(visibleMonthLabels()).toEqual(SIX_MONTHS.slice(1, 4).map(navLabel)));

  // Après un swipe, le toucher part bien de la même fenêtre (état partagé).
  await fireEvent.press(screen.getByTestId('planning-period-next'));
  await waitFor(() => expect(visibleMonthLabels()).toEqual(SIX_MONTHS.slice(2, 5).map(navLabel)));
});

/** Ouvre le sélecteur et choisit `month`/`year`. */
async function pickPeriod(month: number, year: number) {
  await fireEvent.press(screen.getByTestId('planning-period-active'));
  await waitFor(() => screen.getByTestId('planning-period-picker'));
  await fireEvent.press(screen.getByTestId(`planning-period-picker-year-${year}`));
  await fireEvent.press(screen.getByTestId(`planning-period-picker-month-${month}`));
  await fireEvent.press(screen.getByTestId('planning-period-picker-confirm'));
  await waitFor(() => expect(screen.queryByTestId('planning-period-picker')).toBeNull());
}

it('horizon 6 mois + sélection juillet 2027 : acceptée, juillet au centre, données de la période uniquement', async () => {
  planningByRange();
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-period-active'));
  expect(StyleSheet.flatten(screen.getByTestId('planning-horizon-6').props.style).backgroundColor).toBe(colors.primary);

  await fireEvent.press(screen.getByTestId('planning-period-active'));
  await waitFor(() => screen.getByTestId('planning-period-picker'));
  expect(screen.getByText('Choisir une période')).toBeTruthy();
  // Aucun mois grisé par l'horizon.
  for (let m = 1; m <= 12; m++) expect(screen.getByTestId(`planning-period-picker-month-${m}`).props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
  expect(screen.queryByTestId('planning-period-picker-unavailable')).toBeNull();
  await fireEvent.press(screen.getByTestId('planning-period-picker-cancel'));

  await pickPeriod(7, 2027);
  await waitFor(() => expect(visibleMonthLabels()).toEqual(['JUIN 27', 'JUIL. 27', 'AOÛT 27']));
  // L'horizon reste 6 mois ; la plage part de la fenêtre choisie.
  expect(mockGetPlanning).toHaveBeenLastCalledWith(6, '2027-06');

  // Colonnes, accordéon, synthèse et cartes suivent juillet 2027 ; rien d'octobre 2026.
  for (const m of ['2027-06', '2027-07', '2027-08']) {
    expect(screen.getByTestId(`planning-cell-salaire-${m}`)).toBeTruthy();
    expect(screen.getByTestId(`planning-resultat-prevu-${m}`)).toBeTruthy();
  }
  expect(within(screen.getByTestId('planning-accordion-revenus')).getAllByText(/^\S+ \d{2}$/).map((t) => t.props.children)).toEqual(['Juin 27', 'Juil. 27', 'Août 27']);
  expect(within(screen.getByTestId('planning-final-synthese')).getAllByText(/^\S+ \d{2}$/).map((t) => t.props.children)).toEqual(['Juin 27', 'Juil. 27', 'Août 27']);
  expect(screen.queryByTestId('planning-cell-salaire-2026-10')).toBeNull();
  expect(screen.queryByTestId('planning-resultat-prevu-2026-10')).toBeNull();
  expect(screen.queryByTestId('planning-reste-section')).toBeNull();
  // Mois courant hors écran : les cartes montrent le mois central (juillet 2027).
  expect(within(screen.getByTestId('planning-summary-card-revenus')).getByText(formatDh(revenusOf('2027-07')))).toBeTruthy();
  // Total du header d'accordéon (et case de juillet) : valeurs de juillet 2027.
  expect(within(screen.getByTestId('planning-block-toggle-revenus')).getByText(formatDh(revenusOf('2027-07')))).toBeTruthy();
  expect(within(screen.getByTestId('planning-projection-cumulee')).getByText(/Projection fin Août 2027/)).toBeTruthy();
});

it('après repositionnement : swipe suivant/précédent et toucher des mois latéraux continuent normalement', async () => {
  planningByRange();
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-period-active'));
  await pickPeriod(7, 2027);
  await waitFor(() => expect(visibleMonthLabels()).toEqual(['JUIN 27', 'JUIL. 27', 'AOÛT 27']));

  await swipe(-120);
  await waitFor(() => expect(visibleMonthLabels()).toEqual(['JUIL. 27', 'AOÛT 27', 'SEPT. 27']));
  await swipe(120);
  await waitFor(() => expect(visibleMonthLabels()).toEqual(['JUIN 27', 'JUIL. 27', 'AOÛT 27']));
  await swipe(120);
  await waitFor(() => expect(visibleMonthLabels()).toEqual(['MAI 27', 'JUIN 27', 'JUIL. 27']));
  await waitFor(() => expect(screen.getByTestId('planning-resultat-prevu-2027-05')).toBeTruthy());

  await fireEvent.press(screen.getByTestId('planning-period-next'));
  await waitFor(() => expect(visibleMonthLabels()).toEqual(['JUIN 27', 'JUIL. 27', 'AOÛT 27']));
  await fireEvent.press(screen.getByTestId('planning-period-prev'));
  await waitFor(() => expect(visibleMonthLabels()).toEqual(['MAI 27', 'JUIN 27', 'JUIL. 27']));
});

it("changement d'horizon après repositionnement : même période affichée, plage rechargée à partir d'elle", async () => {
  planningByRange();
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-period-active'));
  await pickPeriod(7, 2027);
  await waitFor(() => expect(visibleMonthLabels()).toEqual(['JUIN 27', 'JUIL. 27', 'AOÛT 27']));

  await fireEvent.press(screen.getByTestId('planning-horizon-12'));
  await waitFor(() => expect(mockGetPlanning).toHaveBeenLastCalledWith(12, '2027-06'));
  expect(visibleMonthLabels()).toEqual(['JUIN 27', 'JUIL. 27', 'AOÛT 27']);
  await fireEvent.press(screen.getByTestId('planning-horizon-3'));
  await waitFor(() => expect(mockGetPlanning).toHaveBeenLastCalledWith(3, '2027-06'));
  expect(visibleMonthLabels()).toEqual(['JUIN 27', 'JUIL. 27', 'AOÛT 27']);
});

/** Années actuellement proposées par le sélecteur. */
function pickerYears(): number[] {
  return screen.getAllByTestId(/^planning-period-picker-year-\d{4}$/).map((e) => Number(e.props.testID.slice(-4)));
}

it('années du sélecteur : glissantes et sans limite, navigation vers une année lointaine puis retour à la période actuelle', async () => {
  planningByRange('2026-09');
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-period-active'));
  await fireEvent.press(screen.getByTestId('planning-period-active'));
  await waitFor(() => screen.getByTestId('planning-period-picker'));
  // Centrées sur l'année du mois actif, jamais une liste fixe.
  expect(pickerYears()).toEqual([2025, 2026, 2027]);

  for (const y of [2027, 2028, 2029, 2030]) await fireEvent.press(screen.getByTestId(`planning-period-picker-year-${y}`));
  await waitFor(() => expect(pickerYears()).toEqual([2029, 2030, 2031]));
  await fireEvent.press(screen.getByTestId('planning-period-picker-month-11'));
  await fireEvent.press(screen.getByTestId('planning-period-picker-confirm'));
  await waitFor(() => expect(visibleMonthLabels()).toEqual(['OCT. 30', 'NOV. 30', 'DÉC. 30']));
  expect(mockGetPlanning).toHaveBeenLastCalledWith(6, '2030-10');
  await waitFor(() => expect(screen.getByTestId('planning-resultat-prevu-2030-11')).toBeTruthy());

  // Retour en arrière d'autant d'années, jusqu'à la période actuelle.
  await fireEvent.press(screen.getByTestId('planning-period-active'));
  await waitFor(() => expect(pickerYears()).toEqual([2029, 2030, 2031]));
  for (const y of [2029, 2028, 2027, 2026]) await fireEvent.press(screen.getByTestId(`planning-period-picker-year-${y}`));
  await waitFor(() => expect(pickerYears()).toEqual([2025, 2026, 2027]));
  await fireEvent.press(screen.getByTestId('planning-period-picker-month-9'));
  await fireEvent.press(screen.getByTestId('planning-period-picker-confirm'));
  await waitFor(() => expect(visibleMonthLabels()).toEqual(['AOÛT 26', 'SEPT. 26', 'OCT. 26']));
  // Période actuelle : reste à exécuter et cartes du mois courant comme avant.
  await waitFor(() => expect(screen.getByTestId('planning-reste-section')).toBeTruthy());
  expect(within(screen.getByTestId('planning-summary-card-revenus')).getByText(formatDh(revenusOf('2026-09')))).toBeTruthy();
});

it('accordéons et synthèse suivent la barre ; changer d’horizon conserve la fenêtre affichée', async () => {
  const planning = sixMonthPlanning();
  planning.revenus = [{ key: 'sal', label: 'Salaire', categoryId: 'sal', cells: Object.fromEntries(SIX_MONTHS.map((m) => [m, emptyCell()])) }];
  mockGetPlanning.mockResolvedValue(planning);
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-accordion-revenus'));

  await fireEvent.press(screen.getByTestId('planning-period-next'));
  await waitFor(() => expect(visibleMonthLabels()).toEqual(SIX_MONTHS.slice(1, 4).map(navLabel)));
  const shown = SIX_MONTHS.slice(1, 4).map(formatMonthShort);
  const accordionHeaders = within(screen.getByTestId('planning-accordion-revenus')).getAllByText(/^\S+ \d{2}$/).map((t) => t.props.children);
  expect(accordionHeaders).toEqual(shown);
  for (const m of SIX_MONTHS.slice(1, 4)) expect(screen.getByTestId(`planning-cell-salaire-${m}`)).toBeTruthy();
  expect(screen.queryByTestId('planning-cell-salaire-2026-09')).toBeNull();
  // Les en-têtes de colonnes ne sont pas des boutons de navigation.
  expect(within(screen.getByTestId('planning-accordion-revenus')).queryByTestId(/planning-period/)).toBeNull();

  await fireEvent.press(screen.getByTestId('planning-horizon-12'));
  await waitFor(() => expect(mockGetPlanning).toHaveBeenLastCalledWith(12, SIX_MONTHS[1]));
});

it('swipe : un petit mouvement ou un geste surtout vertical ne change jamais de mois, et ne capte pas le scroll vertical', async () => {
  mockGetPlanning.mockResolvedValue(sixMonthPlanning());
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-swipe-area'));
  const initial = SIX_MONTHS.slice(0, 3).map(navLabel);

  await swipe(-30);
  expect(visibleMonthLabels()).toEqual(initial);
  await swipe(-90, 120);
  expect(visibleMonthLabels()).toEqual(initial);

  const area = screen.getByTestId('planning-swipe-area');
  await fireEvent(area, 'touchStart', { nativeEvent: { pageX: 200, pageY: 300 } });
  expect(area.props.onMoveShouldSetResponderCapture({ nativeEvent: { pageX: 205, pageY: 360 } })).toBe(false);
  expect(area.props.onMoveShouldSetResponderCapture({ nativeEvent: { pageX: 170, pageY: 304 } })).toBe(true);
});

it('3 mois visibles partout : navigation, accordéon ouvert et synthèse finale partagent la même fenêtre', async () => {
  mockGetPlanning.mockResolvedValue(sixMonthPlanning());
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-final-synthese'));

  await swipe(-120);
  await waitFor(() => expect(visibleMonthLabels()).toEqual(SIX_MONTHS.slice(1, 4).map(navLabel)));
  const shown = SIX_MONTHS.slice(1, 4);
  for (const m of shown) expect(screen.getByTestId(`planning-resultat-prevu-${m}`)).toBeTruthy();
  expect(screen.queryByTestId('planning-resultat-prevu-2026-09')).toBeNull();
  expect(screen.queryByTestId('planning-resultat-prevu-2027-01')).toBeNull();
  const finalHeaders = within(screen.getByTestId('planning-final-synthese')).getAllByText(/^\S+ \d{2}$/);
  expect(finalHeaders.map((t) => t.props.children)).toEqual(shown.map(formatMonthShort));
});

it('projection uniquement en bas : sous le dernier mois visible, libellé "Projection fin …", recalculée à la navigation', async () => {
  mockGetPlanning.mockResolvedValue(sixMonthPlanning());
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-final-synthese'));

  expect(screen.getAllByTestId('planning-projection-cumulee')).toHaveLength(1);
  const finalCard = screen.getByTestId('planning-final-synthese');
  const projection = within(finalCard).getByTestId('planning-projection-cumulee');
  expect(within(projection).getByText('3 000 DH')).toBeTruthy();
  expect(within(projection).getByText(/^Projection fin Nov\. 2026$/)).toBeTruthy();

  const ids = renderedTestIds();
  expect(ids.indexOf('planning-projection-cumulee')).toBeGreaterThan(ids.indexOf('planning-accordion-epargne-versements'));
  expect(ids.indexOf('planning-projection-cumulee')).toBeGreaterThan(ids.indexOf('planning-summary-cards'));

  // Colonne : la projection est le 3e et dernier mois de la ligne.
  const row = screen.getByTestId('planning-projection-section');
  const columns = (row.children as any[]).filter((c) => typeof c !== 'string');
  expect(columns).toHaveLength(4);
  expect(within(columns[3]).getByText('3 000 DH')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('planning-period-next'));
  await waitFor(() => expect(within(screen.getByTestId('planning-projection-cumulee')).getByText('4 000 DH')).toBeTruthy());
  expect(within(screen.getByTestId('planning-projection-cumulee')).getByText(/^Projection fin Déc\. 2026$/)).toBeTruthy();
});

it('reste à exécuter uniquement en bas : valeurs dans la colonne du mois courant seulement', async () => {
  mockGetPlanning.mockResolvedValue(sixMonthPlanning());
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-reste-section'));

  expect(screen.queryByTestId('planning-reste-card')).toBeNull();
  const section = within(screen.getByTestId('planning-final-synthese')).getByTestId('planning-reste-section');
  expect(within(section).getByText('RESTE À EXÉCUTER')).toBeTruthy();
  expect(textOf('planning-reste-depenses-2026-09')).toBe('3 600 DH');
  expect(textOf('planning-reste-versements-2026-09')).toBe('0 DH');
  expect(textOf('planning-reste-a-provisionner')).toBe('1 650 DH');
  expect(screen.queryByTestId('planning-reste-depenses-2026-10')).toBeNull();
  expect(screen.queryByTestId('planning-reste-depenses-2026-11')).toBeNull();

  const ids = renderedTestIds();
  expect(ids.indexOf('planning-reste-section')).toBeGreaterThan(ids.indexOf('planning-accordion-epargne-versements'));

  // Mois courant hors de la fenêtre : aucune valeur placée sous un autre mois.
  await fireEvent.press(screen.getByTestId('planning-period-next'));
  await waitFor(() => expect(screen.queryByTestId('planning-reste-section')).toBeNull());
});

it('reste à exécuter : "✓ Couvert" quand couverte=true, section absente si resteDepenses est null partout', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({ synthese: { '2026-09': { ...emptySynthese(), resteDepenses: 1200, resteVersements: 0, couverte: true, aProvisionner: 0 }, '2026-10': emptySynthese(), '2026-11': emptySynthese() } }),
  );
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-reste-section'));
  expect(within(screen.getByTestId('planning-reste-section')).getByTestId('planning-reste-couvert')).toBeTruthy();
  expect(screen.queryByTestId('planning-reste-a-provisionner')).toBeNull();
  screen.unmount();

  mockGetPlanning.mockResolvedValue(basePlanning());
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-final-synthese'));
  expect(screen.queryByTestId('planning-reste-section')).toBeNull();
});

it('résultat prévu par mois en bas + total du mois actif dans le header de l’accordéon (aucun second calcul)', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({
      synthese: {
        '2026-09': { ...emptySynthese(), totalDepenses: 7300, resultatPrevu: -1850 },
        '2026-10': { ...emptySynthese(), resultatPrevu: 13800 },
        '2026-11': { ...emptySynthese(), resultatPrevu: 13700 },
      },
    }),
  );
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-resultat-prevu-row'));
  expect(textOf('planning-resultat-prevu-2026-09')).toBe('-1 850 DH');
  expect(textOf('planning-resultat-prevu-2026-10')).toBe('13 800 DH');
  expect(textOf('planning-resultat-prevu-2026-11')).toBe('13 700 DH');
  expect(within(screen.getByTestId('planning-accordion-depenses')).getByText('7 300 DH')).toBeTruthy();
});
