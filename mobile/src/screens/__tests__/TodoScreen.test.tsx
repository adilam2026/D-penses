import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TodoScreen } from '../TodoScreen';
import { formatDh } from '../../ui/formatMoney';

/**
 * Lot "À faire" — écran dédié (compact, filtres, synthèse, validation rapide
 * / paiement partiel réutilisant l'AdjustModal de Planning, section Effectué).
 * Un seul fichier (comme PlanningScreen.test.tsx, qui enchaîne 19 montages
 * sans souci) : le problème de désynchronisation RNTL rencontré sur
 * AjouterScreen tenait à ce scénario précis (DateField jamais complété dans
 * une soumission de bout en bout), pas à un plafond général de montages.
 */

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    // Réagit aux changements de dépendances du callback (ex. monthsOffset) —
    // contrairement au vrai useFocusEffect, pour re-déclencher `load` quand le
    // mois demandé change (même convention que PlanningScreen.test.tsx).
    React.useEffect(cb, [cb]);
  },
}));

const mockGetTodo = jest.fn();
const mockListAccounts = jest.fn();
const mockGetMyHousehold = jest.fn();
const mockRealizePlannedOperation = jest.fn();
const mockPartialRealizePlannedOperation = jest.fn();

jest.mock('../../api/client', () => ({
  ApiError: class FakeApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  getTodo: (...args: unknown[]) => mockGetTodo(...args),
  listAccounts: () => mockListAccounts(),
  getMyHousehold: () => mockGetMyHousehold(),
  realizePlannedOperation: (...args: unknown[]) => mockRealizePlannedOperation(...args),
  partialRealizePlannedOperation: (...args: unknown[]) => mockPartialRealizePlannedOperation(...args),
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

beforeEach(() => {
  jest.clearAllMocks();
  mockListAccounts.mockResolvedValue(ACCOUNTS);
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

it('affiche une dépense (source → Dépense) et un versement (source → destination), nature, responsable et retard discret', async () => {
  renderWithSafeArea(<TodoScreen />);

  await waitFor(() => screen.getByText('Carburant'));
  expect(screen.getByText('DÉPENSE')).toBeTruthy();
  expect(screen.getByText('BP Adil → Dépense')).toBeTruthy();
  expect(screen.getByTestId('todo-row-po-carburant-late')).toBeTruthy();
  expect(screen.getByTestId('todo-row-po-carburant-late').props.children).toContain('En retard');
  // Partiellement payée (300/800) -> "Reste sur 800 DH" visible dans la ligne.
  expect(screen.getByTestId('todo-row-po-carburant-reste')).toBeTruthy();

  expect(screen.getByText('Épargne voyage')).toBeTruthy();
  expect(screen.getByText('VERSEMENT')).toBeTruthy();
  expect(screen.getByText('BP Adil → CIH — Voyage')).toBeTruthy();
  // RESPONSABLE ≠ SOURCE : aucun responsable défini -> jamais masqué, état discret.
  expect(screen.getByText(/Responsable à définir/)).toBeTruthy();
});

it('filtres Tous/Adil/Lamiaa : filtre aussi la synthèse (actions restantes + montant)', async () => {
  mockGetTodo.mockResolvedValue({
    month: '2026-10',
    pending: [actionDepensePartielleRetard, actionVersementSansResponsable, { ...actionVersementSansResponsable, plannedOperationId: 'po-epargne-2', responsibleMemberId: 'm-adil', remaining: 300 }],
    done: [],
    pendingCount: 3,
    totalRemaining: 1800,
  });
  renderWithSafeArea(<TodoScreen />);

  await waitFor(() => screen.getByTestId('todo-filter-m-adil'));
  expect(screen.getByText('3 actions restantes')).toBeTruthy();
  expect(screen.getByText(`${formatDh(1800)} à exécuter`)).toBeTruthy();

  await fireEvent.press(screen.getByTestId('todo-filter-m-adil'));
  expect(screen.getByText('1 action restante')).toBeTruthy();
  expect(screen.getByText(`${formatDh(300)} à exécuter`)).toBeTruthy();
});

it('validation rapide (cercle) : règle le RESTE (jamais le prévu), via le moteur existant', async () => {
  renderWithSafeArea(<TodoScreen />);

  await waitFor(() => screen.getByTestId('todo-row-po-carburant-circle'));
  await fireEvent.press(screen.getByTestId('todo-row-po-carburant-circle'));

  await waitFor(() => screen.getByTestId('todo-confirm-sheet'));
  const confirmSheet = within(screen.getByTestId('todo-confirm-sheet'));
  expect(confirmSheet.getByText('Confirmer le paiement ?')).toBeTruthy();
  expect(confirmSheet.getByText(formatDh(500))).toBeTruthy();

  await fireEvent.press(screen.getByTestId('todo-confirm-submit'));
  await waitFor(() => expect(mockRealizePlannedOperation).toHaveBeenCalledWith('po-carburant', { actualAmount: '500' }));
});

it('ouvrir la ligne : paiement partiel réutilise strictement l\'AdjustModal de Planning (Prévu/Déjà payé/Reste)', async () => {
  renderWithSafeArea(<TodoScreen />);

  await waitFor(() => screen.getByTestId('todo-row-po-carburant'));
  await fireEvent.press(screen.getByTestId('todo-row-po-carburant'));

  await waitFor(() => screen.getByTestId('planning-adjust-deja-paye'));
  expect(screen.getByTestId('planning-adjust-deja-paye').props.children.join('')).toContain(formatDh(300));
  expect(screen.getByTestId('planning-adjust-reste').props.children.join('')).toContain(formatDh(500));

  await fireEvent.changeText(screen.getByTestId('planning-adjust-partial-amount'), '200');
  await fireEvent.press(screen.getByTestId('planning-adjust-partial-submit'));
  await waitFor(() => expect(mockPartialRealizePlannedOperation).toHaveBeenCalledWith('po-carburant', expect.objectContaining({ actualAmount: '200' })));
});

it('navigation mois ‹ › recharge "À faire" sur le mois demandé', async () => {
  renderWithSafeArea(<TodoScreen />);

  await waitFor(() => expect(mockGetTodo).toHaveBeenCalledWith(0));
  await fireEvent.press(screen.getByTestId('todo-month-next'));
  await waitFor(() => expect(mockGetTodo).toHaveBeenCalledWith(1));
  await fireEvent.press(screen.getByTestId('todo-month-prev'));
  await fireEvent.press(screen.getByTestId('todo-month-prev'));
  await waitFor(() => expect(mockGetTodo).toHaveBeenCalledWith(-1));
});

it('section EFFECTUÉ : repliée par défaut, dépliable sur demande', async () => {
  mockGetTodo.mockResolvedValue({
    month: '2026-10',
    pending: [],
    done: [{ ...actionDepensePartielleRetard, status: 'REALIZED' as const, realizedAmount: 800, remaining: 0 }],
    pendingCount: 0,
    totalRemaining: 0,
  });
  renderWithSafeArea(<TodoScreen />);

  await waitFor(() => screen.getByTestId('todo-done-toggle'));
  expect(screen.getByText('✓ EFFECTUÉ (1)')).toBeTruthy();
  expect(screen.queryByTestId('todo-done-row-po-carburant')).toBeNull();

  await fireEvent.press(screen.getByTestId('todo-done-toggle'));
  expect(screen.getByTestId('todo-done-row-po-carburant')).toBeTruthy();
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
  expect(screen.getByText('✓ EFFECTUÉ (1)')).toBeTruthy();
});
