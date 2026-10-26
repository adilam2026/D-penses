import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TodoScreen } from '../TodoScreen';
import { formatDh } from '../../ui/formatMoney';

/**
 * Lot "refonte Planning/À faire" §28-39 — "À faire" structuré en accordéons
 * PAR RESPONSABLE (plus de filtres Tous/Adil/Lamiaa) : un bucket par membre
 * du foyer, "Non attribué" uniquement si nécessaire, "Effectué" en dernier.
 */

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, [cb]);
  },
}));

const mockGetTodo = jest.fn();
const mockListAccounts = jest.fn();
const mockListCategories = jest.fn();
const mockGetMyHousehold = jest.fn();
const mockRealizePlannedOperation = jest.fn();
const mockPartialRealizePlannedOperation = jest.fn();
const mockUnrealizePlannedOperation = jest.fn();
const mockUpdatePlannedOperation = jest.fn();
const mockCancelPlannedOperation = jest.fn();
const mockListRecurrenceRules = jest.fn();
const mockUpdateRecurrenceRule = jest.fn();

jest.mock('../../api/client', () => ({
  ApiError: class FakeApiError extends Error {},
  getTodo: (...args: unknown[]) => mockGetTodo(...args),
  listAccounts: () => mockListAccounts(),
  listCategories: () => mockListCategories(),
  getMyHousehold: () => mockGetMyHousehold(),
  realizePlannedOperation: (...args: unknown[]) => mockRealizePlannedOperation(...args),
  partialRealizePlannedOperation: (...args: unknown[]) => mockPartialRealizePlannedOperation(...args),
  unrealizePlannedOperation: (...args: unknown[]) => mockUnrealizePlannedOperation(...args),
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

const ACCOUNTS = [
  { id: 'bp', name: 'BP Adil', bank: 'BP', type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 10000, nonAffecte: 10000, subaccounts: [] },
  {
    id: 'cih',
    name: 'CIH',
    bank: 'CIH',
    type: 'EPARGNE',
    ownerMemberId: null,
    ownerLabel: null,
    balance: 5000,
    nonAffecte: 5000,
    subaccounts: [{ id: 'sub-epargne', accountId: 'cih', name: 'Voyage', balance: 2000, active: true }],
  },
];

const MEMBERS = [
  { id: 'm-adil', role: 'admin', user: { id: 'u-adil', firstName: 'Adil', lastName: 'A', email: 'adil@test.local', color: null } },
  { id: 'm-lamiaa', role: 'member', user: { id: 'u-lamiaa', firstName: 'Lamiaa', lastName: 'L', email: 'lamiaa@test.local', color: null } },
];

const actionDepensePartielleRetard = {
  plannedOperationId: 'po-carburant',
  kind: 'EXPENSE' as const,
  label: 'Carburant',
  expectedAmount: 800,
  realizedAmount: 300,
  remaining: 500,
  expectedDate: '2026-10-05',
  sourceAccountId: 'bp',
  sourceSubaccountId: null,
  destinationAccountId: null,
  destinationSubaccountId: null,
  recurrenceRuleId: null,
  categoryId: null,
  responsibleMemberId: 'm-lamiaa',
  status: 'PENDING' as const,
  late: true,
};

const actionVersementSansResponsable = {
  plannedOperationId: 'po-epargne',
  kind: 'SAVINGS_CONTRIBUTION' as const,
  label: 'Épargne voyage',
  expectedAmount: 1000,
  realizedAmount: null,
  remaining: 1000,
  expectedDate: '2026-10-20',
  sourceAccountId: 'bp',
  sourceSubaccountId: null,
  destinationAccountId: 'cih',
  destinationSubaccountId: 'sub-epargne',
  recurrenceRuleId: null,
  categoryId: null,
  responsibleMemberId: null,
  status: 'PENDING' as const,
  late: false,
};

const actionAdil = {
  plannedOperationId: 'po-courses',
  kind: 'EXPENSE' as const,
  label: 'Courses',
  expectedAmount: 300,
  realizedAmount: null,
  remaining: 300,
  expectedDate: '2026-10-04',
  sourceAccountId: 'bp',
  sourceSubaccountId: null,
  destinationAccountId: null,
  destinationSubaccountId: null,
  recurrenceRuleId: null,
  categoryId: null,
  responsibleMemberId: 'm-adil',
  status: 'PENDING' as const,
  late: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockListAccounts.mockResolvedValue(ACCOUNTS);
  mockListCategories.mockResolvedValue([]);
  mockListRecurrenceRules.mockResolvedValue([]);
  mockGetMyHousehold.mockResolvedValue({ id: 'h1', name: 'Foyer', currency: 'MAD', monthStartDay: 1, memberships: MEMBERS });
  mockGetTodo.mockResolvedValue({
    month: '2026-10',
    pending: [actionDepensePartielleRetard, actionVersementSansResponsable],
    done: [],
    pendingCount: 2,
    totalRemaining: 1500,
  });
  mockRealizePlannedOperation.mockResolvedValue({});
  mockPartialRealizePlannedOperation.mockResolvedValue({});
});

it('regroupe les échéances par responsable (§29-33) : un accordéon par membre, "Non attribué" si nécessaire, sans filtres', async () => {
  renderWithSafeArea(<TodoScreen />);

  await waitFor(() => screen.getByTestId('todo-section-m-lamiaa'));
  expect(screen.queryByTestId('todo-filter-tous')).toBeNull();
  expect(screen.queryByTestId('todo-filter-m-adil')).toBeNull();

  // Lamiaa : 1 échéance (Carburant), Adil : aucune -> pas de section Adil.
  expect(within(screen.getByTestId('todo-section-m-lamiaa')).getByText('Carburant')).toBeTruthy();
  expect(screen.queryByTestId('todo-section-m-adil')).toBeNull();

  // Non attribué : affiché puisqu'une échéance (Épargne voyage) n'a pas de responsable.
  expect(within(screen.getByTestId('todo-section-__unassigned__')).getByText('Épargne voyage')).toBeTruthy();
});

it("le cas documenté « Courses » responsable Adil apparaît bien sous la section Adil, jamais sous Non attribué (§39)", async () => {
  mockGetTodo.mockResolvedValue({
    month: '2026-10',
    pending: [actionAdil, actionVersementSansResponsable],
    done: [],
    pendingCount: 2,
    totalRemaining: 1300,
  });
  renderWithSafeArea(<TodoScreen />);

  await waitFor(() => screen.getByTestId('todo-section-m-adil'));
  expect(within(screen.getByTestId('todo-section-m-adil')).getByText('Courses')).toBeTruthy();
  expect(screen.queryByTestId('todo-section-m-adil-toggle')).toBeTruthy();
  const unassigned = screen.getByTestId('todo-section-__unassigned__');
  expect(within(unassigned).queryByText('Courses')).toBeNull();
});

it('section responsable : header affiche nombre d\'échéances + montant restant total, ligne compacte (§35)', async () => {
  renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-m-lamiaa'));

  const section = screen.getByTestId('todo-section-m-lamiaa');
  expect(within(section).getByText('Lamiaa')).toBeTruthy();
  expect(within(section).getByText(/1 échéance · 500 DH/)).toBeTruthy();

  // Plus de libellé nature séparé (DÉPENSE/VERSEMENT) ni de responsable dans
  // la ligne (§35) — le responsable est déjà porté par la section elle-même.
  expect(screen.queryByText('DÉPENSE')).toBeNull();
  expect(screen.getByText(/05 oct\. · BP Adil → Dépense/)).toBeTruthy();
  expect(within(screen.getByTestId('todo-row-po-carburant-badge')).getByText('En retard')).toBeTruthy();
  expect(screen.getByTestId('todo-row-po-carburant-reste')).toBeTruthy();
});

it('ouvrir une ligne ouvre EXACTEMENT le même ActionSheet que Planning, paiement total direct (§36)', async () => {
  renderWithSafeArea(<TodoScreen />);

  await waitFor(() => screen.getByTestId('todo-row-po-carburant'));
  fireEvent.press(screen.getByTestId('todo-row-po-carburant'));

  await waitFor(() => screen.getByTestId('action-sheet-pay'));
  expect(screen.getByText('Payer 500 DH')).toBeTruthy();
  fireEvent.press(screen.getByTestId('action-sheet-pay'));

  await waitFor(() => expect(mockRealizePlannedOperation).toHaveBeenCalledWith('po-carburant', expect.objectContaining({ actualAmount: '500' })));
  await waitFor(() => expect(mockListAccounts.mock.calls.length).toBeGreaterThanOrEqual(2));
});

it('paiement partiel depuis À faire : réutilise strictement le même ActionSheet que Planning (Prévu/Déjà payé/Reste)', async () => {
  renderWithSafeArea(<TodoScreen />);

  await waitFor(() => screen.getByTestId('todo-row-po-carburant'));
  fireEvent.press(screen.getByTestId('todo-row-po-carburant'));

  await waitFor(() => screen.getByTestId('action-sheet-deja-paye'));
  expect(screen.getByTestId('action-sheet-deja-paye').props.children).toBe(formatDh(300));
  expect(screen.getByTestId('action-sheet-reste').props.children).toBe(formatDh(500));

  fireEvent.press(screen.getByTestId('action-sheet-partial'));
  await waitFor(() => screen.getByTestId('action-sheet-partial-submit'));
  fireEvent.changeText(screen.getByTestId('action-sheet-partial-amount'), '200');
  await waitFor(() => expect(screen.getByTestId('action-sheet-partial-amount').props.value).toBe('200'));
  fireEvent.press(screen.getByTestId('action-sheet-partial-submit'));
  await waitFor(() => expect(mockPartialRealizePlannedOperation).toHaveBeenCalledWith('po-carburant', expect.objectContaining({ actualAmount: '200' })));
  await waitFor(() => expect(mockListAccounts.mock.calls.length).toBeGreaterThanOrEqual(2));
});

it('navigation mois ‹ › recharge "À faire" sur le mois demandé', async () => {
  renderWithSafeArea(<TodoScreen />);

  // Chaque pression attend que son propre cycle de chargement se termine
  // AVANT la suivante — jamais plusieurs presses enchaînées sans laisser le
  // précédent chargement se stabiliser, qui laisserait une promesse en vol
  // se résoudre pendant le test suivant.
  await waitFor(() => expect(mockGetTodo).toHaveBeenCalledWith(0));
  await waitFor(() => expect(mockListAccounts.mock.calls.length).toBeGreaterThanOrEqual(1));

  fireEvent.press(screen.getByTestId('todo-month-next'));
  await waitFor(() => expect(mockGetTodo).toHaveBeenCalledWith(1));
  await waitFor(() => expect(mockListAccounts.mock.calls.length).toBeGreaterThanOrEqual(2));

  fireEvent.press(screen.getByTestId('todo-month-prev'));
  await waitFor(() => expect(mockGetTodo).toHaveBeenCalledWith(0));
  await waitFor(() => expect(mockListAccounts.mock.calls.length).toBeGreaterThanOrEqual(3));

  fireEvent.press(screen.getByTestId('todo-month-prev'));
  await waitFor(() => expect(mockGetTodo).toHaveBeenCalledWith(-1));
  await waitFor(() => expect(mockListAccounts.mock.calls.length).toBeGreaterThanOrEqual(4));
});

it('section Effectué (§34) : repliée par défaut, affiche nombre + montant total, dépliable sur demande', async () => {
  mockGetTodo.mockResolvedValue({
    month: '2026-10',
    pending: [],
    done: [{ ...actionDepensePartielleRetard, status: 'REALIZED' as const, realizedAmount: 800, remaining: 0 }],
    pendingCount: 0,
    totalRemaining: 0,
  });
  renderWithSafeArea(<TodoScreen />);

  await waitFor(() => screen.getByTestId('todo-done-toggle'));
  expect(within(screen.getByTestId('todo-section-done')).getByText(/1 échéance · 800 DH/)).toBeTruthy();
  expect(screen.queryByTestId('todo-done-row-po-carburant')).toBeNull();

  fireEvent.press(screen.getByTestId('todo-done-toggle'));
  await waitFor(() => expect(screen.getByTestId('todo-done-row-po-carburant')).toBeTruthy());
});

it('états vides : "aucune action prévue" vs "tout est fait pour octobre"', async () => {
  mockGetTodo.mockResolvedValue({ month: '2026-10', pending: [], done: [], pendingCount: 0, totalRemaining: 0 });
  renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-empty'));
  expect(screen.getByText('Aucune action prévue ce mois-ci.')).toBeTruthy();
});

it('tout est fait : section vide affiche "✓ Tout est fait pour octobre", Effectué reste consultable', async () => {
  mockGetTodo.mockResolvedValue({
    month: '2026-10',
    pending: [],
    done: [{ ...actionDepensePartielleRetard, status: 'REALIZED' as const, realizedAmount: 800, remaining: 0 }],
    pendingCount: 0,
    totalRemaining: 0,
  });
  renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-all-done'));
  expect(screen.getByText('✓ Tout est fait pour octobre')).toBeTruthy();
  expect(within(screen.getByTestId('todo-section-done')).getByText(/1 échéance/)).toBeTruthy();
});
