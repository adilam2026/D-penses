import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ProjectionScreen } from '../ProjectionScreen';
import * as api from '../../../api/client';

/**
 * Round 4 — Projection Globale Mensuelle. ProjectionScreen est un onglet de
 * RootTabs (Tab.Navigator) : `getParent()` doit renvoyer un navigateur réel
 * (jamais undefined, contrairement à un Stack.Screen racine) pour que la
 * navigation vers le détail d'une dépense fonctionne (même règle que
 * HomeScreen/TransactionsScreen, déjà correcte depuis Round 1).
 */
const mockParentNavigate = jest.fn();
const mockGetParent = jest.fn(() => ({ navigate: mockParentNavigate }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ getParent: mockGetParent, navigate: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    listAccounts: jest.fn(),
    getMonthlyProjection: jest.fn(),
    simulateMonthlyProjection: jest.fn(),
    updateDeadline: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

const ACCOUNTS = [
  { id: 'acc1', name: 'Compte courant' },
  { id: 'acc2', name: 'CIH' },
];

function monthBucket(overrides: Partial<api.MonthBucketApi> = {}): api.MonthBucketApi {
  return {
    month: '2026-09',
    label: 'Septembre 2026',
    total_income: 30000,
    total_expense: 28000,
    balance: 2000,
    cumulative_balance: 2000,
    projected_cash_balance: 2000,
    income_items: [
      { entityType: 'income_occurrence', entityId: 'occ1', label: 'Salaire', date: '2026-09-05', amount: 30000, accountId: 'acc1', accountKnown: true, movable: false, realized: false },
    ],
    expense_items: [
      {
        entityType: 'deadline',
        entityId: 'dl1',
        label: 'Charges',
        date: '2026-09-15',
        amount: 28000,
        accountId: 'acc1',
        accountKnown: true,
        movable: true,
        category: 'flexible',
        realized: false,
      },
    ],
    movable_expense_total: 28000,
    is_complete: true,
    unknown_count: 0,
    unknown_labels: [],
    contains_estimates: false,
    excluded_by_filter_count: 0,
    excluded_by_filter_total: 0,
    ...overrides,
  };
}

function projectionFixture(months: api.MonthBucketApi[]): api.MonthlyProjectionApi {
  return {
    reference_date: '2026-09-01',
    horizon_end: '2027-08-31',
    horizon_months: months.length,
    months,
    summary: {
      total_income: months.reduce((s, m) => s + m.total_income, 0),
      total_expense: months.reduce((s, m) => s + m.total_expense, 0),
      total_balance: months.reduce((s, m) => s + m.balance, 0),
      deficit_months_count: months.filter((m) => m.balance < 0).length,
      worst_month: null,
      max_monthly_deficit: null,
      opening_cash_balance: 0,
      cash_low_point: null,
      max_financing_need: 0,
      first_positive_cash_balance_month: null,
      treasury_account_ids: ['acc1', 'acc2'],
      is_complete: months.every((m) => m.is_complete),
      incomplete_months_count: months.filter((m) => !m.is_complete).length,
    },
    account_filters: { incomeAccountIds: null, expenseAccountIds: null },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listAccounts.mockResolvedValue(ACCOUNTS);
  mockedApi.getMonthlyProjection.mockResolvedValue(projectionFixture([monthBucket()]));
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

it('ouvre l\'écran, affiche l\'horizon par défaut (12 mois) et le résumé', async () => {
  await render(<ProjectionScreen />);
  await waitFor(() => screen.getByTestId('summary-card'));

  expect(mockedApi.getMonthlyProjection).toHaveBeenCalledWith(expect.objectContaining({ horizonMonths: 12 }));
  expect(screen.getByText('Septembre 2026')).toBeTruthy();
});

it('change d\'horizon et recharge la projection', async () => {
  await render(<ProjectionScreen />);
  await waitFor(() => screen.getByTestId('horizon-24'));

  await fireEvent.press(screen.getByTestId('horizon-24'));

  await waitFor(() => expect(mockedApi.getMonthlyProjection).toHaveBeenLastCalledWith(expect.objectContaining({ horizonMonths: 24 })));
});

it('filtre par compte et recalcule la projection', async () => {
  await render(<ProjectionScreen />);
  await waitFor(() => screen.getByTestId('toggle-filters'));
  await fireEvent.press(screen.getByTestId('toggle-filters'));
  await waitFor(() => screen.getByTestId('projection-expense-accounts-select'));

  fireEvent.press(screen.getByTestId('projection-expense-accounts-select'));
  await fireEvent.press(await screen.findByTestId('projection-expense-accounts-select-option-acc2'));

  await waitFor(() =>
    expect(mockedApi.getMonthlyProjection).toHaveBeenLastCalledWith(expect.objectContaining({ expenseAccountIds: ['acc2'] })),
  );
});

it('la sélection "Compte non déterminé" recalcule aussi la projection', async () => {
  await render(<ProjectionScreen />);
  await waitFor(() => screen.getByTestId('toggle-filters'));
  await fireEvent.press(screen.getByTestId('toggle-filters'));
  await waitFor(() => screen.getByTestId('projection-expense-accounts-select'));

  fireEvent.press(screen.getByTestId('projection-expense-accounts-select'));
  await fireEvent.press(await screen.findByTestId(`projection-expense-accounts-select-option-${api.UNDETERMINED_ACCOUNT}`));

  await waitFor(() =>
    expect(mockedApi.getMonthlyProjection).toHaveBeenLastCalledWith(expect.objectContaining({ expenseAccountIds: [api.UNDETERMINED_ACCOUNT] })),
  );
});

it('déplie puis replie le détail d\'un mois', async () => {
  await render(<ProjectionScreen />);
  await waitFor(() => screen.getByTestId('month-toggle-2026-09'));

  expect(screen.queryByText('Total revenus 30 000 DH')).toBeNull();
  await fireEvent.press(screen.getByTestId('month-toggle-2026-09'));
  await waitFor(() => screen.getByText('Salaire'));
  expect(screen.getByText('Charges')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('month-toggle-2026-09'));
  await waitFor(() => expect(screen.queryByText('Salaire')).toBeNull());
});

it('navigue vers le détail d\'une dépense (échéance) au tap', async () => {
  await render(<ProjectionScreen />);
  await waitFor(() => screen.getByTestId('month-toggle-2026-09'));
  await fireEvent.press(screen.getByTestId('month-toggle-2026-09'));
  await waitFor(() => screen.getByText('Charges'));

  await fireEvent.press(screen.getByText('Charges'));

  expect(mockParentNavigate).toHaveBeenCalledWith('DeadlineDetail', { id: 'dl1' });
});

it('un mois déficitaire affiche la balance négative et le total décalable', async () => {
  mockedApi.getMonthlyProjection.mockResolvedValue(
    projectionFixture([
      monthBucket({ month: '2026-11', label: 'Novembre 2026', total_income: 30000, total_expense: 35000, balance: -5000, cumulative_balance: -5000, movable_expense_total: 20000 }),
    ]),
  );
  await render(<ProjectionScreen />);
  await waitFor(() => screen.getByTestId('month-toggle-2026-11'));

  const monthCard = within(screen.getByTestId('month-card-2026-11'));
  expect(monthCard.getByText('-5 000 DH')).toBeTruthy();
  expect(monthCard.getByText('Déficitaire')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('month-toggle-2026-11'));
  await waitFor(() => screen.getByText('Pourquoi ce déficit ?'));
  expect(screen.getByText('Dépenses potentiellement décalables : 20 000 DH')).toBeTruthy();
});

it('projection incomplète : le mois affiche l\'avertissement et le libellé inconnu', async () => {
  mockedApi.getMonthlyProjection.mockResolvedValue(
    projectionFixture([monthBucket({ is_complete: false, unknown_count: 1, unknown_labels: ['Facture inconnue'] })]),
  );
  await render(<ProjectionScreen />);
  await waitFor(() => screen.getByTestId('month-toggle-2026-09'));

  expect(screen.getByText(/Facture inconnue/)).toBeTruthy();
});

it('« Déplacer » sur une dépense flexible démarre un scénario et affiche la comparaison avant/après', async () => {
  const scenarioMonth = monthBucket({ total_expense: 0, balance: 30000, cumulative_balance: 30000, expense_items: [] });
  mockedApi.simulateMonthlyProjection.mockResolvedValue({
    baseline: projectionFixture([monthBucket()]),
    scenario: projectionFixture([scenarioMonth]),
  });
  await render(<ProjectionScreen />);
  await waitFor(() => screen.getByTestId('month-toggle-2026-09'));
  await fireEvent.press(screen.getByTestId('month-toggle-2026-09'));
  await waitFor(() => screen.getByTestId('move-dl1'));

  await fireEvent.press(screen.getByTestId('move-dl1'));
  await waitFor(() => screen.getByTestId('move-dialog'));
  await fireEvent.press(screen.getByTestId('confirm-move'));

  await waitFor(() => expect(mockedApi.simulateMonthlyProjection).toHaveBeenCalled());
  await waitFor(() => screen.getByText(/SCÉNARIO EN COURS/));
  expect(screen.getByText(/Impact/)).toBeTruthy();
  // Aucune donnée réelle modifiée par la simulation elle-même.
  expect(mockedApi.updateDeadline).not.toHaveBeenCalled();
});

it('« Réinitialiser le scénario » revient à la projection réelle', async () => {
  mockedApi.simulateMonthlyProjection.mockResolvedValue({
    baseline: projectionFixture([monthBucket()]),
    scenario: projectionFixture([monthBucket({ total_expense: 0, balance: 30000 })]),
  });
  await render(<ProjectionScreen />);
  await waitFor(() => screen.getByTestId('month-toggle-2026-09'));
  await fireEvent.press(screen.getByTestId('month-toggle-2026-09'));
  await waitFor(() => screen.getByTestId('move-dl1'));
  await fireEvent.press(screen.getByTestId('move-dl1'));
  await waitFor(() => screen.getByTestId('move-dialog'));
  await fireEvent.press(screen.getByTestId('confirm-move'));
  await waitFor(() => screen.getByTestId('reset-scenario'));

  await fireEvent.press(screen.getByTestId('reset-scenario'));

  await waitFor(() => expect(screen.queryByText(/SCÉNARIO EN COURS/)).toBeNull());
});

it('« Appliquer les modifications » persiste réellement le déplacement d\'une dépense flexible', async () => {
  mockedApi.simulateMonthlyProjection.mockResolvedValue({
    baseline: projectionFixture([monthBucket()]),
    scenario: projectionFixture([monthBucket({ total_expense: 0, balance: 30000 })]),
  });
  mockedApi.updateDeadline.mockResolvedValue({});
  await render(<ProjectionScreen />);
  await waitFor(() => screen.getByTestId('month-toggle-2026-09'));
  await fireEvent.press(screen.getByTestId('month-toggle-2026-09'));
  await waitFor(() => screen.getByTestId('move-dl1'));
  await fireEvent.press(screen.getByTestId('move-dl1'));
  await waitFor(() => screen.getByTestId('move-dialog'));
  await fireEvent.press(screen.getByTestId('confirm-move'));
  await waitFor(() => screen.getByTestId('apply-scenario'));

  await fireEvent.press(screen.getByTestId('apply-scenario'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
  const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  await buttons[1].onPress();

  await waitFor(() => expect(mockedApi.updateDeadline).toHaveBeenCalledWith('dl1', expect.objectContaining({ dueDate: expect.any(String) })));
});

it('Round 4bis : une ligne réelle affiche le badge "Réel" et aucun lien de déplacement, une ligne prévue affiche "Prévu"', async () => {
  mockedApi.getMonthlyProjection.mockResolvedValue(
    projectionFixture([
      monthBucket({
        expense_items: [
          {
            entityType: 'deadline',
            entityId: 'dl3',
            label: 'Facture payée',
            date: '2026-09-12',
            amount: 1500,
            accountId: 'acc1',
            accountKnown: true,
            movable: false,
            realized: true,
          },
        ],
      }),
    ]),
  );
  await render(<ProjectionScreen />);
  await waitFor(() => screen.getByTestId('month-toggle-2026-09'));
  await fireEvent.press(screen.getByTestId('month-toggle-2026-09'));
  await waitFor(() => screen.getByText('Facture payée'));

  expect(screen.getByText('Réel')).toBeTruthy();
  // Un mouvement déjà réel ne propose plus de déplacement (ni réel ni simulé).
  expect(screen.queryByTestId('move-dl3')).toBeNull();
});

it('Round 4bis : la carte résumé distingue "Trésorerie initiale" et "Balance cumulée" (jamais confondues)', async () => {
  mockedApi.getMonthlyProjection.mockResolvedValue({
    ...projectionFixture([monthBucket({ projected_cash_balance: 22000 })]),
    summary: {
      total_income: 30000,
      total_expense: 28000,
      total_balance: 2000,
      deficit_months_count: 0,
      worst_month: null,
      max_monthly_deficit: null,
      opening_cash_balance: 20000,
      cash_low_point: { month: '2026-09', value: 22000 },
      max_financing_need: 0,
      first_positive_cash_balance_month: null,
      treasury_account_ids: ['acc1'],
      is_complete: true,
      incomplete_months_count: 0,
    },
  });
  await render(<ProjectionScreen />);
  await waitFor(() => screen.getByTestId('summary-card'));

  expect(screen.getByText(/Trésorerie initiale/)).toBeTruthy();
  expect(screen.getByText(/20 000 DH/)).toBeTruthy();
  expect(screen.getByText(/Besoin temporaire de financement/)).toBeTruthy();
  const monthCard = within(screen.getByTestId('month-card-2026-09'));
  expect(monthCard.getByText(/Balance cumulée/)).toBeTruthy();
  expect(monthCard.getByText(/Trésorerie projetée/)).toBeTruthy();
});

it('une échéance contractuelle (non modifiable) propose "Simuler un décalage", jamais "Déplacer"', async () => {
  mockedApi.getMonthlyProjection.mockResolvedValue(
    projectionFixture([
      monthBucket({
        expense_items: [
          { entityType: 'deadline', entityId: 'dl2', label: 'Prêt immobilier', date: '2026-09-05', amount: 8000, accountId: 'acc1', accountKnown: true, movable: false, category: 'obligatoire', realized: false },
        ],
      }),
    ]),
  );
  await render(<ProjectionScreen />);
  await waitFor(() => screen.getByTestId('month-toggle-2026-09'));
  await fireEvent.press(screen.getByTestId('month-toggle-2026-09'));

  await waitFor(() => screen.getByText('Simuler un décalage'));
  expect(screen.queryByText('Déplacer')).toBeNull();
});

/**
 * Recette téléphone réel §6/§7 : aide discrète expliquant les 3 notions
 * (balance du mois / balance cumulée / trésorerie projetée), repliée par
 * défaut pour ne pas surcharger l'écran.
 */
it('§6/§7 : aide "Balance/cumul/trésorerie" repliée par défaut, dépliable au tap', async () => {
  await render(<ProjectionScreen />);
  await waitFor(() => screen.getByTestId('projection-info-toggle'));

  expect(screen.queryByTestId('projection-info-panel')).toBeNull();

  await fireEvent.press(screen.getByTestId('projection-info-toggle'));

  const panel = within(screen.getByTestId('projection-info-panel'));
  expect(panel.getByText(/Balance du mois/)).toBeTruthy();
  expect(panel.getByText(/Balance cumulée/)).toBeTruthy();
  expect(panel.getByText(/Trésorerie projetée/)).toBeTruthy();
});
