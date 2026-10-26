import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PlanningScreen } from '../PlanningScreen';
import { clearCache } from '../../state/cache';
import * as api from '../../api/client';
import type { PlanningTableApi } from '../../api/client';

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
  await waitFor(() => expect(mockGetPlanning).toHaveBeenCalledWith(6));
  expect(screen.getByTestId('planning-horizon-3')).toBeTruthy();
  expect(screen.getByTestId('planning-horizon-12')).toBeTruthy();
});

it("changer d'horizon relance getPlanning avec le nouveau nombre de mois", async () => {
  mockGetPlanning.mockResolvedValue(basePlanning());
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => expect(mockGetPlanning).toHaveBeenCalledWith(6));
  fireEvent.press(screen.getByTestId('planning-horizon-12'));
  await waitFor(() => expect(mockGetPlanning).toHaveBeenCalledWith(12));
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

it('cartes de synthèse (§4) + projection (§5) + reste à exécuter (§12) : mois actif, aucun second calcul', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({
      synthese: {
        '2026-09': { totalRevenus: 2000, totalDepenses: 7300, totalEpargne: 1000, resultatPrevu: -6300, projectionCumulee: -6300, resteDepenses: 6100, resteVersements: 0, couverte: false, aProvisionner: 600 },
        '2026-10': emptySynthese(),
        '2026-11': { ...emptySynthese(), projectionCumulee: -5000 },
      },
    }),
  );

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-summary-card-revenus'));

  expect(within(screen.getByTestId('planning-summary-card-revenus')).getByText('2 000 DH')).toBeTruthy();
  expect(within(screen.getByTestId('planning-summary-card-depenses')).getByText('7 300 DH')).toBeTruthy();
  expect(within(screen.getByTestId('planning-summary-card-versements')).getByText('1 000 DH')).toBeTruthy();
  expect(within(screen.getByTestId('planning-summary-card-resultat')).getByText('-6 300 DH')).toBeTruthy();

  const projection = screen.getByTestId('planning-projection-cumulee');
  expect(within(projection).getByText(/Projection à fin Novembre 2026/)).toBeTruthy();
  expect(within(projection).getByText('-5 000 DH')).toBeTruthy();

  const reste = screen.getByTestId('planning-reste-card');
  expect(within(reste).getByText('6 100 DH')).toBeTruthy();
  expect(within(reste).getByTestId('planning-reste-a-provisionner')).toBeTruthy();

  // Accordéon DÉPENSES affiche aussi le total du mois actif dans son header.
  expect(within(screen.getByTestId('planning-accordion-depenses')).getByText('7 300 DH')).toBeTruthy();
});

it('"reste à exécuter" : "✓ Tout est couvert" quand couverte=true, pas de carte si resteDepenses est null', async () => {
  mockGetPlanning.mockResolvedValue(
    basePlanning({ synthese: { '2026-09': { ...emptySynthese(), resteDepenses: 1200, resteVersements: 0, couverte: true, aProvisionner: 0 }, '2026-10': emptySynthese(), '2026-11': emptySynthese() } }),
  );

  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-reste-card'));
  expect(within(screen.getByTestId('planning-reste-card')).getByTestId('planning-reste-couvert')).toBeTruthy();
  expect(within(screen.getByTestId('planning-reste-card')).queryByText(/provisionner/i)).toBeNull();
});

it('"reste à exécuter" : aucune carte quand resteDepenses est null (mois futur)', async () => {
  mockGetPlanning.mockResolvedValue(basePlanning());
  renderWithSafeArea(<PlanningScreen />);
  await waitFor(() => screen.getByTestId('planning-summary-card-revenus'));
  expect(screen.queryByTestId('planning-reste-card')).toBeNull();
});
