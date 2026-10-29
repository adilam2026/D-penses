import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TodoScreen } from '../TodoScreen';
import { formatDh } from '../../ui/formatMoney';
import { colors } from '../../ui/theme';
import { shiftMonthKey } from '../../ui/monthKey';

/**
 * Lot "refonte Planning/À faire" §28-39 — "À faire" structuré en accordéons
 * PAR RESPONSABLE (plus de filtres Tous/Adil/Lamiaa) : un bucket par membre
 * du foyer, "Non attribué" uniquement si nécessaire ; chaque carte porte son
 * À FAIRE et son PAYÉ (plus de bloc global "Effectué").
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

/** En-tête de carte : « payé / total du mois DH ». */
function headerAmount(paid: number, total: number): string {
  return `${Math.round(paid).toLocaleString('fr-FR')} / ${formatDh(total)}`.replace(/\s+/g, ' ');
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
  await renderWithSafeArea(<TodoScreen />);

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
  await renderWithSafeArea(<TodoScreen />);

  await waitFor(() => screen.getByTestId('todo-section-m-adil'));
  expect(within(screen.getByTestId('todo-section-m-adil')).getByTestId('todo-row-po-courses-label')).toBeTruthy();
  expect(rowText('po-courses', 'label')).toMatch(/^Courses/);
  expect(screen.queryByTestId('todo-section-m-adil-toggle')).toBeTruthy();
  const unassigned = screen.getByTestId('todo-section-__unassigned__');
  expect(within(unassigned).queryByTestId('todo-row-po-courses')).toBeNull();
});

it('carte responsable : prénom + total du mois (À FAIRE + PAYÉ), bandeaux À FAIRE et PAYÉ', async () => {
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-m-lamiaa'));

  const section = screen.getByTestId('todo-section-m-lamiaa');
  expect(within(section).getByText('Lamiaa')).toBeTruthy();
  // Carburant : 800 prévus, 300 déjà payés -> À FAIRE 500 + PAYÉ 300 = 800.
  expect(textContent(screen.getByTestId('todo-section-m-lamiaa-total') as unknown as HostNode)).toBe(headerAmount(300, 800));
  expect(textContent(screen.getByTestId('todo-section-m-lamiaa-todo-band') as unknown as HostNode)).toBe(`À FAIRE · ${formatDh(500)}`.replace(/\s+/g, ' '));
  expect(textContent(screen.getByTestId('todo-section-m-lamiaa-paid-band') as unknown as HostNode)).toBe(`PAYÉ · ${formatDh(300)}`.replace(/\s+/g, ' '));

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
  await renderWithSafeArea(<TodoScreen />);
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
  await renderWithSafeArea(<TodoScreen />);
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
  await renderWithSafeArea(<TodoScreen />);
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
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-m-adil'));

  const adil = screen.getByTestId('todo-section-m-adil');
  const lamiaa = screen.getByTestId('todo-section-m-lamiaa');
  expect(within(adil).getByTestId('todo-row-po-courses')).toBeTruthy();
  expect(within(adil).queryByTestId('todo-row-po-carburant')).toBeNull();
  expect(within(lamiaa).getByTestId('todo-row-po-carburant')).toBeTruthy();
  expect(within(lamiaa).getByTestId('todo-row-po-courses-l')).toBeTruthy();
  const text = (id: string) => textContent(screen.getByTestId(id) as unknown as HostNode);
  expect(text('todo-section-m-adil-total')).toBe(headerAmount(0, 300));
  expect(text('todo-section-m-adil-todo-band')).toBe(`À FAIRE · ${formatDh(300)}`.replace(/\s+/g, ' '));
  expect(text('todo-section-m-lamiaa-todo-band')).toBe(`À FAIRE · ${formatDh(700)}`.replace(/\s+/g, ' '));
  expect(text('todo-section-m-lamiaa-total')).toBe(headerAmount(300, 1000));
  expect(mockGetTodo).toHaveBeenCalledWith(0);
});

it('ouvrir une ligne ouvre EXACTEMENT le même ActionSheet que Planning, paiement total direct (§36)', async () => {
  await renderWithSafeArea(<TodoScreen />);

  await waitFor(() => screen.getByTestId('todo-row-po-carburant'));
  fireEvent.press(screen.getByTestId('todo-row-po-carburant'));

  await waitFor(() => screen.getByTestId('action-sheet-pay'));
  expect(screen.getByText('Payer 500 DH')).toBeTruthy();
  fireEvent.press(screen.getByTestId('action-sheet-pay'));

  await waitFor(() => expect(mockRealizePlannedOperation).toHaveBeenCalledWith('po-carburant', expect.objectContaining({ actualAmount: '500' })));
  await waitFor(() => expect(mockListAccounts.mock.calls.length).toBeGreaterThanOrEqual(2));
});

it('paiement partiel depuis À faire : réutilise strictement le même ActionSheet que Planning (Prévu/Déjà payé/Reste)', async () => {
  await renderWithSafeArea(<TodoScreen />);

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

// ---------------------------------------------------------------------------
// ActionSheet : dépense (simple, « Payer ») vs versement (source → destination, « Virer »).
// ---------------------------------------------------------------------------

it('dépense : ActionSheet simple — libellé, montant, « Payer », sans compte ni bloc de virement', async () => {
  mockGetTodo.mockResolvedValue({
    month: '2026-10',
    pending: [{ ...actionDepensePartielleRetard, realizedAmount: null, remaining: 800 }],
    done: [],
    pendingCount: 1,
    totalRemaining: 800,
  });
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-row-po-carburant'));
  fireEvent.press(screen.getByTestId('todo-row-po-carburant'));
  await waitFor(() => screen.getByTestId('action-sheet-pay'));
  const sheet = screen.getByTestId('action-sheet');
  expect(within(sheet).getByText('Carburant')).toBeTruthy();
  expect(textContent(screen.getByTestId('action-sheet-pay') as unknown as HostNode)).toBe(`Payer ${formatDh(800)}`.replace(/\s+/g, ' '));
  expect(screen.queryByTestId('action-sheet-transfer')).toBeNull();
  expect(within(sheet).queryByText(/BP Adil/)).toBeNull();
  expect(within(sheet).queryByText(/Virer/)).toBeNull();
});

it('versement : ActionSheet affiche le virement exact (source → enveloppe de destination, compte parent inclus) et « Virer X DH »', async () => {
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-row-po-epargne'));
  fireEvent.press(screen.getByTestId('todo-row-po-epargne'));
  await waitFor(() => screen.getByTestId('action-sheet-transfer'));
  expect(textContent(screen.getByTestId('action-sheet-transfer-from') as unknown as HostNode)).toBe('BP Adil');
  expect(textContent(screen.getByTestId('action-sheet-transfer-to') as unknown as HostNode)).toBe('→ CIH / Voyage');
  expect(textContent(screen.getByTestId('action-sheet-pay') as unknown as HostNode)).toBe(`Virer ${formatDh(1000)}`.replace(/\s+/g, ' '));
  expect(within(screen.getByTestId('action-sheet')).queryByText(/^Payer \d/)).toBeNull();
  // Actions secondaires inchangées.
  expect(screen.getByText('Payer partiellement')).toBeTruthy();
  expect(screen.getByText("Modifier l'échéance")).toBeTruthy();
  expect(screen.getByText("Annuler l'échéance")).toBeTruthy();
});

it('versement : « Virer X DH » valide directement (même moteur que Payer, aucune étape intermédiaire)', async () => {
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-row-po-epargne'));
  fireEvent.press(screen.getByTestId('todo-row-po-epargne'));
  await waitFor(() => screen.getByTestId('action-sheet-pay'));
  fireEvent.press(screen.getByTestId('action-sheet-pay'));
  await waitFor(() => expect(mockRealizePlannedOperation).toHaveBeenCalledWith('po-epargne', expect.objectContaining({ actualAmount: '1000' })));
  expect(mockRealizePlannedOperation).toHaveBeenCalledTimes(1);
  expect(mockPartialRealizePlannedOperation).not.toHaveBeenCalled();
});

it('versement : paiement partiel = exactement le même moteur (partialRealize)', async () => {
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-row-po-epargne'));
  fireEvent.press(screen.getByTestId('todo-row-po-epargne'));
  await waitFor(() => screen.getByTestId('action-sheet-partial'));
  fireEvent.press(screen.getByTestId('action-sheet-partial'));
  await waitFor(() => screen.getByTestId('action-sheet-partial-amount'));
  fireEvent.changeText(screen.getByTestId('action-sheet-partial-amount'), '400');
  await waitFor(() => expect(screen.getByTestId('action-sheet-partial-amount').props.value).toBe('400'));
  fireEvent.press(screen.getByTestId('action-sheet-partial-submit'));
  await waitFor(() => expect(mockPartialRealizePlannedOperation).toHaveBeenCalledWith('po-epargne', expect.objectContaining({ actualAmount: '400' })));
  expect(mockRealizePlannedOperation).not.toHaveBeenCalled();
});

it('versement vers une enveloppe dont le compte parent a un homonyme : la banque est ajoutée pour lever l\'ambiguïté', async () => {
  mockListAccounts.mockResolvedValue([
    { ...ACCOUNTS[0], id: 'adil', name: 'Adil Compte Principal', bank: 'SG' },
    { ...ACCOUNTS[1], id: 'bcp', name: 'Épargne', bank: 'BCP', subaccounts: [{ id: 'voyage', accountId: 'bcp', name: 'Voyage', balance: 0, active: true }] },
    { ...ACCOUNTS[1], id: 'cih-ep', name: 'Épargne', bank: 'CIH', subaccounts: [] },
  ]);
  mockGetTodo.mockResolvedValue({
    month: '2026-10',
    pending: [{ ...actionVersementSansResponsable, sourceAccountId: 'adil', destinationAccountId: 'bcp', destinationSubaccountId: 'voyage' }],
    done: [],
    pendingCount: 1,
    totalRemaining: 1000,
  });
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-row-po-epargne'));
  fireEvent.press(screen.getByTestId('todo-row-po-epargne'));
  await waitFor(() => screen.getByTestId('action-sheet-transfer'));
  expect(textContent(screen.getByTestId('action-sheet-transfer-from') as unknown as HostNode)).toBe('Adil Compte Principal');
  expect(textContent(screen.getByTestId('action-sheet-transfer-to') as unknown as HostNode)).toBe('→ Épargne BCP / Voyage');
});

// ---------------------------------------------------------------------------
// Navigation temporelle : "OCT. 26 | NOVEMBRE 2026 | DÉC. 26".
// ---------------------------------------------------------------------------

/** /todo renvoie le mois correspondant au décalage demandé (mois courant = octobre 2026). */
function todoByOffset() {
  mockGetTodo.mockImplementation((offset = 0) =>
    Promise.resolve({ month: shiftMonthKey('2026-10', offset), pending: [actionAdil], done: [], pendingCount: 1, totalRemaining: 300 }),
  );
}

function periodLabels(): string[] {
  return ['prev', 'active', 'next'].map((z) => screen.getByTestId(`todo-period-${z}-label`).props.children as string);
}

async function swipeBar(dx: number, dy = 0) {
  const bar = screen.getByTestId('todo-period');
  await fireEvent(bar, 'touchStart', { nativeEvent: { pageX: 200, pageY: 100 } });
  await fireEvent(bar, 'responderRelease', { nativeEvent: { pageX: 200 + dx, pageY: 100 + dy } });
}

it('barre des mois : précédent / ACTIF / suivant, actif mis en avant, aucune ancienne flèche', async () => {
  todoByOffset();
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-period'));

  expect(periodLabels()).toEqual(['SEPT. 26', 'OCTOBRE 2026', 'NOV. 26']);
  expect(screen.queryByTestId('todo-month-prev')).toBeNull();
  expect(screen.queryByTestId('todo-month-next')).toBeNull();
  expect(within(screen.getByTestId('todo-period')).queryByText(/[‹›]/)).toBeNull();

  const active = StyleSheet.flatten(screen.getByTestId('todo-period-active-label').props.style);
  const side = StyleSheet.flatten(screen.getByTestId('todo-period-prev-label').props.style);
  expect(active.color).toBe(colors.textPrimary);
  expect(side.color).toBe(colors.textSecondary);
  expect(active.fontSize).toBeGreaterThan(side.fontSize);
  for (const z of ['prev', 'active', 'next']) {
    expect(StyleSheet.flatten(screen.getByTestId(`todo-period-${z}`).props.style).minHeight).toBeGreaterThanOrEqual(44);
  }
});

it('toucher le mois précédent / suivant recharge "À faire" sur ce mois', async () => {
  todoByOffset();
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => expect(periodLabels()[1]).toBe('OCTOBRE 2026'));

  await fireEvent.press(screen.getByTestId('todo-period-next'));
  await waitFor(() => expect(periodLabels()).toEqual(['OCT. 26', 'NOVEMBRE 2026', 'DÉC. 26']));
  expect(mockGetTodo).toHaveBeenLastCalledWith(1);

  await fireEvent.press(screen.getByTestId('todo-period-prev'));
  await waitFor(() => expect(periodLabels()[1]).toBe('OCTOBRE 2026'));
  await fireEvent.press(screen.getByTestId('todo-period-prev'));
  await waitFor(() => expect(periodLabels()).toEqual(['AOÛT 26', 'SEPTEMBRE 2026', 'OCT. 26']));
  expect(mockGetTodo).toHaveBeenLastCalledWith(-1);
});

it('swipe gauche -> mois suivant, swipe droite -> mois précédent ; geste vertical ou trop court ignoré', async () => {
  todoByOffset();
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => expect(periodLabels()[1]).toBe('OCTOBRE 2026'));

  await swipeBar(-120);
  await waitFor(() => expect(periodLabels()[1]).toBe('NOVEMBRE 2026'));
  await swipeBar(120);
  await waitFor(() => expect(periodLabels()[1]).toBe('OCTOBRE 2026'));
  await swipeBar(120);
  await waitFor(() => expect(periodLabels()).toEqual(['AOÛT 26', 'SEPTEMBRE 2026', 'OCT. 26']));

  const calls = mockGetTodo.mock.calls.length;
  await swipeBar(-30);
  await swipeBar(-90, 140);
  expect(periodLabels()[1]).toBe('SEPTEMBRE 2026');
  expect(mockGetTodo.mock.calls.length).toBe(calls);

  const bar = screen.getByTestId('todo-period');
  await fireEvent(bar, 'touchStart', { nativeEvent: { pageX: 200, pageY: 100 } });
  expect(bar.props.onMoveShouldSetResponderCapture({ nativeEvent: { pageX: 210, pageY: 170 } })).toBe(false);
  expect(bar.props.onMoveShouldSetResponderCapture({ nativeEvent: { pageX: 170, pageY: 104 } })).toBe(true);
});

it('sélecteur : années glissantes sans limite, novembre 2030 puis retour au mois courant', async () => {
  todoByOffset();
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => expect(periodLabels()[1]).toBe('OCTOBRE 2026'));
  const years = () => screen.getAllByTestId(/^todo-period-picker-year-\d{4}$/).map((e) => Number(e.props.testID.slice(-4)));

  await fireEvent.press(screen.getByTestId('todo-period-active'));
  await waitFor(() => expect(years()).toEqual([2025, 2026, 2027]));
  for (const y of [2027, 2028, 2029, 2030]) await fireEvent.press(screen.getByTestId(`todo-period-picker-year-${y}`));
  await waitFor(() => expect(years()).toEqual([2029, 2030, 2031]));
  await fireEvent.press(screen.getByTestId('todo-period-picker-month-11'));
  await fireEvent.press(screen.getByTestId('todo-period-picker-confirm'));
  await waitFor(() => expect(periodLabels()).toEqual(['OCT. 30', 'NOVEMBRE 2030', 'DÉC. 30']));
  expect(mockGetTodo).toHaveBeenLastCalledWith(49);

  await fireEvent.press(screen.getByTestId('todo-period-active'));
  for (const y of [2029, 2028, 2027, 2026]) await fireEvent.press(screen.getByTestId(`todo-period-picker-year-${y}`));
  await waitFor(() => expect(years()).toEqual([2025, 2026, 2027]));
  await fireEvent.press(screen.getByTestId('todo-period-picker-month-10'));
  await fireEvent.press(screen.getByTestId('todo-period-picker-confirm'));
  await waitFor(() => expect(periodLabels()).toEqual(['SEPT. 26', 'OCTOBRE 2026', 'NOV. 26']));
  expect(mockGetTodo).toHaveBeenLastCalledWith(0);
  // Liste inchangée : libellé + montant uniquement.
  await waitFor(() => expect(screen.getByTestId('todo-row-po-courses-label')).toBeTruthy());
});

it('toucher le mois central ouvre "Choisir une période" ; juillet 2027 affiche directement juillet 2027', async () => {
  todoByOffset();
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => expect(periodLabels()[1]).toBe('OCTOBRE 2026'));

  await fireEvent.press(screen.getByTestId('todo-period-active'));
  await waitFor(() => screen.getByTestId('todo-period-picker'));
  expect(screen.getByText('Choisir une période')).toBeTruthy();

  // Annuler ne change rien.
  await fireEvent.press(screen.getByTestId('todo-period-picker-cancel'));
  await waitFor(() => expect(screen.queryByTestId('todo-period-picker')).toBeNull());
  expect(periodLabels()[1]).toBe('OCTOBRE 2026');

  await fireEvent.press(screen.getByTestId('todo-period-active'));
  await waitFor(() => screen.getByTestId('todo-period-picker'));
  await fireEvent.press(screen.getByTestId('todo-period-picker-month-7'));
  await fireEvent.press(screen.getByTestId('todo-period-picker-year-2027'));
  await fireEvent.press(screen.getByTestId('todo-period-picker-confirm'));

  await waitFor(() => expect(periodLabels()).toEqual(['JUIN 27', 'JUILLET 2027', 'AOÛT 27']));
  expect(mockGetTodo).toHaveBeenLastCalledWith(9);
  // Depuis juillet 2027, le mois suivant reste relatif au mois courant réel.
  await fireEvent.press(screen.getByTestId('todo-period-next'));
  await waitFor(() => expect(mockGetTodo).toHaveBeenLastCalledWith(10));
});

it('plus de bloc global « Effectué » : une échéance réalisée est dans le PAYÉ de son responsable, visible par défaut', async () => {
  mockGetTodo.mockResolvedValue({
    month: '2026-10',
    pending: [actionAdil],
    done: [{ ...actionDepensePartielleRetard, status: 'REALIZED' as const, realizedAmount: 800, remaining: 0 }],
    pendingCount: 1,
    totalRemaining: 300,
  });
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-m-lamiaa'));

  expect(screen.queryByTestId('todo-section-done')).toBeNull();
  expect(screen.queryByText('Effectué')).toBeNull();
  const lamiaa = screen.getByTestId('todo-section-m-lamiaa');
  // Ouvert sans action : rien à replier séparément.
  expect(within(lamiaa).getByTestId('todo-paid-row-po-carburant')).toBeTruthy();
  expect(within(lamiaa).getByTestId('todo-paid-row-po-carburant-full')).toBeTruthy();
  expect(textContent(screen.getByTestId('todo-paid-row-po-carburant-amount') as unknown as HostNode)).toBe(formatDh(800).replace(/\s+/g, ' '));
  // Rien à faire pour Lamiaa : pas de bandeau À FAIRE vide.
  expect(within(lamiaa).queryByTestId('todo-section-m-lamiaa-todo-band')).toBeNull();
  // Jamais rangée chez un autre responsable.
  expect(within(screen.getByTestId('todo-section-m-adil')).queryByTestId('todo-paid-row-po-carburant')).toBeNull();
});

it('ligne PAYÉ cliquable : ouvre l’ActionSheet existant d’une échéance réalisée (Annuler le paiement…)', async () => {
  mockUnrealizePlannedOperation.mockResolvedValue({});
  mockGetTodo.mockResolvedValue({
    month: '2026-10',
    pending: [],
    done: [{ ...actionDepensePartielleRetard, status: 'REALIZED' as const, realizedAmount: 800, remaining: 0 }],
    pendingCount: 0,
    totalRemaining: 0,
  });
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-paid-row-po-carburant'));
  await fireEvent.press(screen.getByTestId('todo-paid-row-po-carburant'));

  await waitFor(() => screen.getByTestId('action-sheet-paid-full'));
  expect(screen.queryByTestId('action-sheet-pay')).toBeNull();
  expect(screen.getByTestId('action-sheet-edit-paid')).toBeTruthy();
  expect(screen.getByTestId('action-sheet-cancel-paid')).toBeTruthy();
  // /todo ne fournit pas l'opération réelle liée : règle existante, pas de « Voir la transaction ».
  expect(screen.queryByTestId('action-sheet-view-transaction')).toBeNull();

  await fireEvent.press(screen.getByTestId('action-sheet-unrealize'));
  await waitFor(() => expect(mockUnrealizePlannedOperation).toHaveBeenCalledWith('po-carburant'));
});

it('ligne PAYÉ ◐ d’un partiel : ouvre le même ActionSheet que sa ligne À FAIRE (déjà payé / reste)', async () => {
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-paid-row-po-carburant'));
  await fireEvent.press(screen.getByTestId('todo-paid-row-po-carburant'));
  await waitFor(() => screen.getByTestId('action-sheet-deja-paye'));
  expect(textContent(screen.getByTestId('action-sheet-deja-paye') as unknown as HostNode)).toBe(formatDh(300).replace(/\s+/g, ' '));
  expect(textContent(screen.getByTestId('action-sheet-reste') as unknown as HostNode)).toBe(formatDh(500).replace(/\s+/g, ' '));
});

it('états vides : "aucune action prévue" vs "tout est fait pour octobre"', async () => {
  mockGetTodo.mockResolvedValue({ month: '2026-10', pending: [], done: [], pendingCount: 0, totalRemaining: 0 });
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-empty'));
  expect(screen.getByText('Aucune action prévue ce mois-ci.')).toBeTruthy();
});

it('tout est fait : "✓ Tout est fait pour octobre", le PAYÉ de chacun reste consultable', async () => {
  mockGetTodo.mockResolvedValue({
    month: '2026-10',
    pending: [],
    done: [{ ...actionDepensePartielleRetard, status: 'REALIZED' as const, realizedAmount: 800, remaining: 0 }],
    pendingCount: 0,
    totalRemaining: 0,
  });
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-all-done'));
  expect(screen.getByText('✓ Tout est fait pour octobre')).toBeTruthy();
  expect(within(screen.getByTestId('todo-section-m-lamiaa')).getByTestId('todo-paid-row-po-carburant')).toBeTruthy();
  expect(textContent(screen.getByTestId('todo-section-m-lamiaa-paid-band') as unknown as HostNode)).toBe(`PAYÉ · ${formatDh(800)}`.replace(/\s+/g, ' '));
});

// ---------------------------------------------------------------------------
// Dans chaque responsable : DÉPENSES puis VERSEMENTS, séparés discrètement.
// ---------------------------------------------------------------------------

const versementAdil = { ...actionVersementSansResponsable, plannedOperationId: 'po-voyage', label: 'Voyage', remaining: 1500, expectedAmount: 1500, responsibleMemberId: 'm-adil' };
const versementAdil2 = { ...actionVersementSansResponsable, plannedOperationId: 'po-voiture', label: 'Voiture', remaining: 400, expectedAmount: 400, responsibleMemberId: 'm-adil' };
const depenseAdil2 = { ...actionAdil, plannedOperationId: 'po-gsm', label: 'GSM Adil', remaining: 350, expectedAmount: 350 };

function groupLabels(sectionKey: string): string[] {
  return within(screen.getByTestId(`todo-section-${sectionKey}`))
    .queryAllByText(/^(DÉPENSES|VERSEMENTS)$/)
    .map((t) => t.props.children as string);
}

function rowIdsIn(testID: string): string[] {
  return within(screen.getByTestId(testID))
    .getAllByTestId(/^todo-row-po-[a-z-]+$/)
    .filter((r) => !/-(label|amount)$/.test(r.props.testID))
    .map((r) => r.props.testID.replace('todo-row-', ''));
}

it('par responsable : DÉPENSES puis VERSEMENTS, chaque échéance dans son groupe, totaux inchangés', async () => {
  // Ordre d'arrivée volontairement mélangé.
  mockGetTodo.mockResolvedValue({ month: '2026-10', pending: [versementAdil, actionAdil, versementAdil2, depenseAdil2], done: [], pendingCount: 4, totalRemaining: 2550 });
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-m-adil'));

  expect(groupLabels('m-adil')).toEqual(['DÉPENSES', 'VERSEMENTS']);
  expect(rowIdsIn('todo-section-m-adil-group-depenses')).toEqual(['po-courses', 'po-gsm']);
  expect(rowIdsIn('todo-section-m-adil-group-versements')).toEqual(['po-voyage', 'po-voiture']);
  // À FAIRE = somme des restes ; ni DÉPENSES ni VERSEMENTS n'affichent de sous-total.
  expect(textContent(screen.getByTestId('todo-section-m-adil-todo-band') as unknown as HostNode)).toBe(`À FAIRE · ${formatDh(2550)}`.replace(/\s+/g, ' '));
  expect(textContent(screen.getByTestId('todo-section-m-adil-group-depenses-label') as unknown as HostNode)).toBe('DÉPENSES');
  expect(textContent(screen.getByTestId('todo-section-m-adil-group-versements-label') as unknown as HostNode)).toBe('VERSEMENTS');
  // Lignes compactes inchangées : libellé + montant.
  expect(rowText('po-voyage', 'label')).toBe('Voyage');
  expect(rowText('po-voyage', 'amount')).toBe(formatDh(1500).replace(/\s+/g, ' '));
});

it('aucun groupe vide : un responsable sans versement n’affiche que DÉPENSES, et inversement', async () => {
  mockGetTodo.mockResolvedValue({ month: '2026-10', pending: [actionAdil, depenseAdil2, actionDepensePartielleRetard, { ...versementAdil, responsibleMemberId: 'm-lamiaa' }].filter((a) => a.responsibleMemberId !== 'm-lamiaa' || a.kind === 'SAVINGS_CONTRIBUTION'), done: [], pendingCount: 3, totalRemaining: 2150 });
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-m-adil'));
  expect(groupLabels('m-adil')).toEqual(['DÉPENSES']);
  expect(screen.queryByTestId('todo-section-m-adil-group-versements')).toBeNull();
  expect(groupLabels('m-lamiaa')).toEqual(['VERSEMENTS']);
  expect(screen.queryByTestId('todo-section-m-lamiaa-group-depenses')).toBeNull();
});

it('hiérarchie validée : bandeaux à peine teintés sans bordure, sous-catégories sur fond blanc séparées par un filet fin', async () => {
  mockGetTodo.mockResolvedValue({ month: '2026-10', pending: [actionAdil, versementAdil], done: [{ ...depenseAdil2, status: 'REALIZED' as const, realizedAmount: 350, remaining: 0 }], pendingCount: 2, totalRemaining: 1800 });
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-m-adil'));
  const style = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style) ?? {};

  const todoBand = style('todo-section-m-adil-todo-band');
  const paidBand = style('todo-section-m-adil-paid-band');
  expect(todoBand.backgroundColor).toBe(colors.surfaceMuted);
  expect(paidBand.backgroundColor).toBe(colors.successSoft);
  for (const band of [todoBand, paidBand]) {
    expect(band.borderWidth).toBeUndefined();
    expect(band.borderRadius).toBeUndefined();
  }
  // Sous-catégories : petit titre coloré, fond blanc, filet fin uniquement entre DÉPENSES et VERSEMENTS.
  expect(style('todo-section-m-adil-group-depenses-label').fontSize).toBeLessThan(12);
  expect(style('todo-section-m-adil-group-depenses').backgroundColor).toBeUndefined();
  expect(style('todo-section-m-adil-group-depenses').borderTopWidth).toBeUndefined();
  expect(style('todo-section-m-adil-group-versements').borderTopWidth).toBe(StyleSheet.hairlineWidth);
  // Aucun filet entre les opérations.
  expect(style('todo-row-po-courses').borderBottomWidth).toBeUndefined();
  expect(style('todo-paid-row-po-gsm').borderBottomWidth).toBeUndefined();
  // Montants des opérations : noirs, même taille, À FAIRE comme PAYÉ.
  const todoAmount = style('todo-row-po-courses-amount');
  const paidAmount = style('todo-paid-row-po-gsm-amount');
  expect(todoAmount.color).toBe(colors.textPrimary);
  expect(paidAmount.color).toBe(colors.textPrimary);
  expect(paidAmount.fontSize).toBe(todoAmount.fontSize);
  expect(style('todo-row-po-voyage-amount').fontSize).toBe(todoAmount.fontSize);
  // Total de la carte : taille raisonnable, à peine plus grand que les lignes.
  expect(style('todo-section-m-adil-total').fontSize).toBeLessThanOrEqual((todoAmount.fontSize as number) + 1);
});

it('tap sur une ligne d’un groupe : même ActionSheet qu’avant (versement → « Virer »)', async () => {
  mockGetTodo.mockResolvedValue({ month: '2026-10', pending: [actionAdil, versementAdil], done: [], pendingCount: 2, totalRemaining: 1800 });
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-row-po-voyage'));
  await fireEvent.press(screen.getByTestId('todo-row-po-voyage'));
  await waitFor(() => screen.getByTestId('action-sheet-pay'));
  expect(textContent(screen.getByTestId('action-sheet-pay') as unknown as HostNode)).toBe(`Virer ${formatDh(1500)}`.replace(/\s+/g, ' '));
});

it('titres de groupe colorés dans TOUS les accordéons : DÉPENSES = identité Dépenses, VERSEMENTS = identité Épargne/Versements', async () => {
  const depenseLamiaa = { ...depenseAdil2, plannedOperationId: 'po-pharma', label: 'Pharmacie', responsibleMemberId: 'm-lamiaa' };
  const versementLamiaa = { ...versementAdil, plannedOperationId: 'po-epargne-l', label: 'Épargne L', responsibleMemberId: 'm-lamiaa' };
  mockGetTodo.mockResolvedValue({
    month: '2026-10',
    pending: [actionAdil, versementAdil, depenseLamiaa, versementLamiaa, actionVersementSansResponsable],
    done: [],
    pendingCount: 5,
    totalRemaining: 0,
  });
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-m-lamiaa'));
  const labelColor = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style).color;
  for (const section of ['m-adil', 'm-lamiaa']) {
    expect(labelColor(`todo-section-${section}-group-depenses-label`)).toBe(colors.danger);
    expect(labelColor(`todo-section-${section}-group-versements-label`)).toBe(colors.secondary);
  }
  // Accordéon « Non attribué » : même règle.
  const unassignedVersement = screen.getAllByTestId(/-group-versements-label$/).filter((n) => !/m-(adil|lamiaa)/.test(n.props.testID));
  expect(unassignedVersement).toHaveLength(1);
  expect(StyleSheet.flatten(unassignedVersement[0].props.style).color).toBe(colors.secondary);
  // Présentation inchangée : ni fond, ni icône ajoutée.
  expect(StyleSheet.flatten(screen.getByTestId('todo-section-m-adil-group-depenses-label').props.style).backgroundColor).toBeUndefined();
});

it('paiement partiel : solde dans À FAIRE, part payée dans PAYÉ (◐), total = prévu, jamais compté deux fois', async () => {
  const coursesPartielle = { ...actionAdil, expectedAmount: 1000, realizedAmount: 400, remaining: 600 };
  mockGetTodo.mockResolvedValue({ month: '2026-10', pending: [coursesPartielle], done: [], pendingCount: 1, totalRemaining: 600 });
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-m-adil'));
  const text = (id: string) => textContent(screen.getByTestId(id) as unknown as HostNode);

  expect(text('todo-row-po-courses-amount')).toBe(formatDh(600).replace(/\s+/g, ' '));
  expect(text('todo-paid-row-po-courses-amount')).toBe(formatDh(400).replace(/\s+/g, ' '));
  expect(screen.getByTestId('todo-paid-row-po-courses-partial')).toBeTruthy();
  expect(text('todo-section-m-adil-todo-band')).toBe(`À FAIRE · ${formatDh(600)}`.replace(/\s+/g, ' '));
  expect(text('todo-section-m-adil-paid-band')).toBe(`PAYÉ · ${formatDh(400)}`.replace(/\s+/g, ' '));
  expect(text('todo-section-m-adil-total')).toBe(headerAmount(400, 1000));
  // Résumé du haut inchangé : uniquement ce qui reste à exécuter.
  expect(text('todo-synthese-count')).toBe('1 action restante');
  expect(text('todo-synthese-amount')).toBe(`${formatDh(600)} à exécuter`.replace(/\s+/g, ' '));
});

it('le total du responsable ne baisse pas quand une échéance est payée : il passe de À FAIRE à PAYÉ', async () => {
  mockGetTodo.mockResolvedValue({ month: '2026-10', pending: [actionAdil, depenseAdil2], done: [], pendingCount: 2, totalRemaining: 650 });
  const before = await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-m-adil'));
  expect(textContent(screen.getByTestId('todo-section-m-adil-total') as unknown as HostNode)).toBe(headerAmount(0, 650));
  expect(screen.queryByTestId('todo-section-m-adil-paid-band')).toBeNull();
  await before.unmount();

  mockGetTodo.mockResolvedValue({ month: '2026-10', pending: [actionAdil], done: [{ ...depenseAdil2, status: 'REALIZED' as const, realizedAmount: 350, remaining: 0 }], pendingCount: 1, totalRemaining: 300 });
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-m-adil-paid-band'));
  expect(textContent(screen.getByTestId('todo-section-m-adil-total') as unknown as HostNode)).toBe(headerAmount(350, 650));
  expect(textContent(screen.getByTestId('todo-section-m-adil-todo-band') as unknown as HostNode)).toBe(`À FAIRE · ${formatDh(300)}`.replace(/\s+/g, ' '));
  expect(textContent(screen.getByTestId('todo-section-m-adil-paid-band') as unknown as HostNode)).toBe(`PAYÉ · ${formatDh(350)}`.replace(/\s+/g, ' '));
});

it('« Non attribué » : même structure (total, À FAIRE, PAYÉ), affiché uniquement s’il contient des opérations', async () => {
  const payeeSansResponsable = { ...actionVersementSansResponsable, plannedOperationId: 'po-epargne-2', label: 'Épargne auto', status: 'REALIZED' as const, realizedAmount: 500, remaining: 0 };
  mockGetTodo.mockResolvedValue({ month: '2026-10', pending: [actionVersementSansResponsable], done: [payeeSansResponsable], pendingCount: 1, totalRemaining: 1000 });
  const first = await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-__unassigned__'));
  const text = (id: string) => textContent(screen.getByTestId(id) as unknown as HostNode);
  expect(text('todo-section-__unassigned__-total')).toBe(headerAmount(500, 1500));
  expect(text('todo-section-__unassigned__-todo-band')).toBe(`À FAIRE · ${formatDh(1000)}`.replace(/\s+/g, ' '));
  expect(text('todo-section-__unassigned__-paid-band')).toBe(`PAYÉ · ${formatDh(500)}`.replace(/\s+/g, ' '));
  expect(screen.queryByTestId('todo-section-m-adil')).toBeNull();
  expect(screen.queryByTestId('todo-section-m-lamiaa')).toBeNull();
  await first.unmount();

  mockGetTodo.mockResolvedValue({ month: '2026-10', pending: [actionAdil], done: [], pendingCount: 1, totalRemaining: 300 });
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-m-adil'));
  expect(screen.queryByTestId('todo-section-__unassigned__')).toBeNull();
});

it('en-tête « payé / total » : 0 / total tant que rien n’est payé, tient sur une ligne même avec des montants élevés', async () => {
  const gros = { ...actionAdil, expectedAmount: 47050, remaining: 47050 };
  mockGetTodo.mockResolvedValue({ month: '2026-10', pending: [gros], done: [], pendingCount: 1, totalRemaining: 47050 });
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-m-adil-total'));
  const header = screen.getByTestId('todo-section-m-adil-total');
  expect(textContent(header as unknown as HostNode)).toBe(headerAmount(0, 47050));
  expect(header.props.numberOfLines).toBe(1);
  expect(header.props.adjustsFontSizeToFit).toBe(true);
  // Ni libellé « payé », ni pourcentage, ni couleur ajoutée.
  expect(textContent(header as unknown as HostNode)).not.toMatch(/pay|%/i);
  expect(StyleSheet.flatten(header.props.style).color).toBe(colors.textPrimary);
});

it('en-tête : seul le montant payé est vert (même vert que PAYÉ), « / total DH » reste noir, taille et poids inchangés', async () => {
  await renderWithSafeArea(<TodoScreen />);
  await waitFor(() => screen.getByTestId('todo-section-m-lamiaa-total'));
  const header = screen.getByTestId('todo-section-m-lamiaa-total');
  const paid = screen.getByTestId('todo-section-m-lamiaa-total-paid');
  expect(textContent(paid as unknown as HostNode)).toBe('300');
  expect(textContent(header as unknown as HostNode)).toBe(headerAmount(300, 800));
  const paidStyle = StyleSheet.flatten(paid.props.style);
  const headerStyle = StyleSheet.flatten(header.props.style);
  expect(paidStyle.color).toBe(StyleSheet.flatten(screen.getByTestId('todo-section-m-lamiaa-paid-band').props.style).color);
  expect(headerStyle.color).toBe(colors.textPrimary);
  expect(paidStyle.fontSize).toBeUndefined();
  expect(paidStyle.fontWeight).toBeUndefined();
});
