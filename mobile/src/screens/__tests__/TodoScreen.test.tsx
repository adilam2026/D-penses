import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TodoScreen } from '../TodoScreen';
import { formatDh } from '../../ui/formatMoney';
import { colors } from '../../ui/theme';

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

type HostNode = { children: (HostNode | string)[]; props: Record<string, any>; parent: HostNode | null };

/** Texte complet d'un élément, Text imbriqués compris, espaces normalisées. */
function textContent(node: HostNode): string {
  return node.children.map((c) => (typeof c === 'string' ? c : textContent(c))).join('').replace(/\s+/g, ' ');
}

function rowText(id: string, part: 'label' | 'amount'): string {
  return textContent(screen.getByTestId(`todo-row-${id}-${part}`) as unknown as HostNode);
}

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
  expect(within(screen.getByTestId('todo-section-m-lamiaa')).getByTestId('todo-row-po-carburant-label')).toBeTruthy();
  expect(rowText('po-carburant', 'label')).toMatch(/^Carburant/);
  expect(screen.queryByTestId('todo-section-m-adil')).toBeNull();

  // Non attribué : affiché puisqu'une échéance (Épargne voyage) n'a pas de responsable.
  expect(within(screen.getByTestId('todo-section-__unassigned__')).getByTestId('todo-row-po-epargne-label')).toBeTruthy();
  expect(rowText('po-epargne', 'label')).toMatch(/^Épargne voyage/);
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
  expect(within(screen.getByTestId('todo-section-m-adil')).getByTestId('todo-row-po-courses-label')).toBeTruthy();
  expect(rowText('po-courses', 'label')).toMatch(/^Courses/);
  expect(screen.queryByTestId('todo-section-m-adil-toggle')).toBeTruthy();
  const unassigned = screen.getByTestId('todo-section-__unassigned__');
  expect(within(unassigned).queryByTestId('todo-row-po-courses')).toBeNull();
});

it('section responsable : header affiche nombre d\'échéances + montant restant total, ligne compacte (§35)', async () => {
  renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-m-lamiaa'));

  const section = screen.getByTestId('todo-section-m-lamiaa');
  expect(within(section).getByText('Lamiaa')).toBeTruthy();
  expect(within(section).getByText(/1 échéance · 500 DH/)).toBeTruthy();

  expect(screen.queryByText('DÉPENSE')).toBeNull();
});

// ---------------------------------------------------------------------------
// Vue synthétique : une échéance = une ligne "Libellé … Montant".
// ---------------------------------------------------------------------------

/** Tous les textes affichés dans une ligne, dans l'ordre. */
function rowTexts(id: string): string[] {
  const out: string[] = [];
  const walk = (node: HostNode) => {
    if (node.children.every((c) => typeof c === 'string') && node.children.length > 0) {
      out.push(textContent(node));
      return;
    }
    node.children.forEach((c) => typeof c !== 'string' && walk(c));
  };
  walk(screen.getByTestId(`todo-row-${id}`) as unknown as HostNode);
  return out;
}

it('une échéance affiche uniquement son libellé et son montant (ni statut, ni date, ni comptes)', async () => {
  const partielNonRetard = { ...actionDepensePartielleRetard, plannedOperationId: 'po-partiel', label: 'LYDEC', late: false, responsibleMemberId: 'm-adil' };
  mockGetTodo.mockResolvedValue({
    month: '2026-10',
    pending: [actionAdil, actionDepensePartielleRetard, partielNonRetard, actionVersementSansResponsable],
    done: [],
    pendingCount: 4,
    totalRemaining: 2300,
  });
  renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-row-po-courses'));

  expect(rowTexts('po-courses')).toEqual(['Courses', '300 DH']);
  expect(rowTexts('po-carburant')).toEqual(['Carburant', '500 DH']);
  expect(rowTexts('po-partiel')).toEqual(['LYDEC', '500 DH']);
  expect(rowTexts('po-epargne')).toEqual(['Épargne voyage', '1 000 DH']);

  for (const hidden of [/À faire/, /En retard/, /Partiel/, /oct\./, /BP Adil/, /→/, /Reste sur/]) {
    for (const id of ['po-courses', 'po-carburant', 'po-partiel', 'po-epargne']) {
      expect(within(screen.getByTestId(`todo-row-${id}`)).queryByText(hidden)).toBeNull();
    }
  }
  for (const id of ['po-courses', 'po-carburant']) {
    expect(screen.queryByTestId(`todo-row-${id}-status`)).toBeNull();
    expect(screen.queryByTestId(`todo-row-${id}-meta`)).toBeNull();
    expect(screen.queryByTestId(`todo-row-${id}-badge`)).toBeNull();
  }
});

it('libellé long : jusqu\'à 2 lignes, le montant garde toujours sa place et n\'est jamais tronqué', async () => {
  const longLabel = { ...actionAdil, label: 'LYDEC — électricité et eau de la résidence principale et du garage' };
  mockGetTodo.mockResolvedValue({ month: '2026-10', pending: [longLabel], done: [], pendingCount: 1, totalRemaining: 300 });
  renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-row-po-courses'));

  const label = screen.getByTestId('todo-row-po-courses-label');
  const amount = screen.getByTestId('todo-row-po-courses-amount');
  expect(textContent(label as unknown as HostNode)).toBe(longLabel.label);
  expect(label.props.numberOfLines).toBe(2);
  expect(amount.props.numberOfLines).toBeUndefined();
  expect(StyleSheet.flatten(amount.props.style).flexShrink).toBe(0);
  expect(StyleSheet.flatten(screen.getByTestId('todo-row-po-courses').props.style).flexDirection).toBe('row');
});

it('toucher une ligne simplifiée ouvre toujours le même flux, avec prévu / déjà payé / reste', async () => {
  renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-row-po-epargne'));

  fireEvent.press(screen.getByTestId('todo-row-po-epargne'));
  await waitFor(() => screen.getByTestId('action-sheet'));
  expect(screen.getByTestId('action-sheet-pay')).toBeTruthy();
  fireEvent.press(screen.getByTestId('action-sheet-close'));
  await waitFor(() => expect(screen.queryByTestId('action-sheet')).toBeNull());

  fireEvent.press(screen.getByTestId('todo-row-po-carburant'));
  await waitFor(() => screen.getByTestId('action-sheet-deja-paye'));
  expect(screen.getByTestId('action-sheet-deja-paye').props.children).toBe(formatDh(300));
  expect(screen.getByTestId('action-sheet-reste').props.children).toBe(formatDh(500));
});

it('regroupement Adil / Lamiaa inchangé : chaque échéance sous son responsable, totaux = somme des restes', async () => {
  const lamiaaCourses = { ...actionAdil, plannedOperationId: 'po-courses-l', responsibleMemberId: 'm-lamiaa', remaining: 200, expectedAmount: 200 };
  mockGetTodo.mockResolvedValue({ month: '2026-10', pending: [actionAdil, actionDepensePartielleRetard, lamiaaCourses], done: [], pendingCount: 3, totalRemaining: 1000 });
  renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-m-adil'));

  const adil = screen.getByTestId('todo-section-m-adil');
  const lamiaa = screen.getByTestId('todo-section-m-lamiaa');
  expect(within(adil).getByTestId('todo-row-po-courses')).toBeTruthy();
  expect(within(adil).queryByTestId('todo-row-po-carburant')).toBeNull();
  expect(within(lamiaa).getByTestId('todo-row-po-carburant')).toBeTruthy();
  expect(within(lamiaa).getByTestId('todo-row-po-courses-l')).toBeTruthy();
  expect(within(adil).getByText(/1 échéance · 300 DH/)).toBeTruthy();
  expect(within(lamiaa).getByText(/2 échéances · 700 DH/)).toBeTruthy();
  expect(mockGetTodo).toHaveBeenCalledWith(0);
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
