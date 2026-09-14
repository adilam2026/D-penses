import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { TransactionsScreen } from '../TransactionsScreen';
import * as api from '../../../api/client';

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

/**
 * Mini-lot T2 — le calendrier natif est mocké au niveau de son contrat, même
 * technique que ui/__tests__/DateField.test.tsx (aucune interaction native
 * réelle simulable en jest-expo/iOS par défaut sans bascule de preset).
 */
let lastDatePickerOpen: { value: Date; onChange: (event: { type: string }, date?: Date) => void } | null = null;
jest.mock('@react-native-community/datetimepicker', () => {
  const ReactLib = require('react');
  return {
    __esModule: true,
    default: (props: any) => ReactLib.createElement('DateTimePicker', props),
    DateTimePickerAndroid: {
      open: jest.fn((options: any) => {
        lastDatePickerOpen = options;
      }),
    },
  };
});

/**
 * Confirme (demande de suivi Vague 2, point 2) que le libellé enrichi
 * "Type · Sous-type" renvoyé par le backend est réellement RENDU à l'écran —
 * pas seulement disponible dans la réponse API. Scénario exact demandé :
 * 500 DH / Alimentation → Courses → Viande / Compte SG.
 */
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, getParent: () => ({ navigate: jest.fn() }) }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    listTransactions: jest.fn(),
    listAccounts: jest.fn(),
    listCategories: jest.fn(),
    listVariableBudgets: jest.fn(),
    listFinancialPlans: jest.fn(),
    getMyHousehold: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  lastDatePickerOpen = null;
  mockedApi.listAccounts.mockResolvedValue([]);
  mockedApi.listCategories.mockResolvedValue([]);
  mockedApi.listVariableBudgets.mockResolvedValue([]);
  mockedApi.listFinancialPlans.mockResolvedValue([]);
  mockedApi.getMyHousehold.mockResolvedValue({ memberships: [] } as any);
});

it('une dépense Alimentation → Courses → Viande affiche "Courses · Viande", la catégorie, le montant et le compte', async () => {
  mockedApi.listTransactions.mockResolvedValue([
    {
      kind: 'adhoc_expense',
      displayKind: 'dépense',
      id: 'e1',
      occurredAt: '2026-09-06T10:00:00.000Z',
      amount: -500,
      accountName: 'Compte SG',
      label: 'Courses · Viande',
      categoryName: 'Alimentation',
      categoryTypeName: 'Courses',
      categorySubtypeName: 'Viande',
    },
  ]);

  await render(<TransactionsScreen />);

  await waitFor(() => expect(screen.getByText('Courses · Viande')).toBeTruthy());
  expect(screen.getByText(/Alimentation/)).toBeTruthy();
  expect(screen.getByText(/Compte SG/)).toBeTruthy();
  expect(screen.getByText('-500 DH')).toBeTruthy();
});

it('une transaction sans type (revenu, paiement...) garde son libellé d\'origine, sans régression', async () => {
  mockedApi.listTransactions.mockResolvedValue([
    {
      kind: 'income',
      displayKind: 'revenu',
      id: 'e2',
      occurredAt: '2026-09-05T10:00:00.000Z',
      amount: 8000,
      accountName: 'Compte SG',
      label: 'Salaire',
      categoryName: 'Salaire',
      categoryTypeName: null,
      categorySubtypeName: null,
    },
  ]);

  await render(<TransactionsScreen />);

  await waitFor(() => expect(screen.getByText('Salaire')).toBeTruthy());
  expect(screen.getByText('+8 000 DH')).toBeTruthy();
});

it('§5 — une carte de transaction est cliquable et navigue vers son écran détail avec kind+id', async () => {
  mockedApi.listTransactions.mockResolvedValue([
    {
      kind: 'payment',
      displayKind: 'paiement',
      id: 'p1',
      occurredAt: '2026-09-04T10:00:00.000Z',
      amount: -1500,
      accountName: 'Compte SG',
      label: 'Frais scolarité',
      categoryName: null,
      categoryTypeName: null,
      categorySubtypeName: null,
    },
  ]);

  await render(<TransactionsScreen />);
  await waitFor(() => expect(screen.getByText('Frais scolarité')).toBeTruthy());

  fireEvent.press(screen.getByTestId('transaction-row-payment-p1'));

  expect(mockNavigate).toHaveBeenCalledWith('TransactionDetail', { kind: 'payment', id: 'p1' });
});

/**
 * Mini-lot T2 — panneau de filtres, regroupement par mois civil, affichage de
 * l'initiateur et des rattachements budget/plan (mappés vers leur libellé, y
 * compris budgets/plans clôturés — listVariableBudgets/listFinancialPlans ne
 * filtrent déjà rien côté backend), état vide distinct, avertissement de
 * troncature à 200 résultats.
 */
describe('TransactionsScreen — mini-lot T2', () => {
  const originalOS = Platform.OS;

  beforeAll(() => {
    Platform.OS = 'android';
  });

  afterAll(() => {
    Platform.OS = originalOS;
  });

  async function flush() {
    await waitFor(() => screen.getByTestId('transactions-filters-button'));
  }

  it('le panneau de filtres affiche tous les sélecteurs attendus', async () => {
    mockedApi.listTransactions.mockResolvedValue([]);
    await render(<TransactionsScreen />);
    await flush();

    await fireEvent.press(screen.getByTestId('transactions-filters-button'));
    await flush();

    expect(screen.getByTestId('transactions-filters-form')).toBeTruthy();
    expect(screen.getByTestId('transactions-filter-kind')).toBeTruthy();
    expect(screen.getByTestId('transactions-filter-account')).toBeTruthy();
    expect(screen.getByTestId('transactions-filter-category')).toBeTruthy();
    expect(screen.getByTestId('transactions-filter-budget')).toBeTruthy();
    expect(screen.getByTestId('transactions-filter-plan')).toBeTruthy();
    expect(screen.getByTestId('transactions-filter-initiator')).toBeTruthy();
  });

  it("Type='Transfert' appliqué → listTransactions appelé avec kind=transfer_in,transfer_out (jamais les kinds bruts d'autres familles)", async () => {
    mockedApi.listTransactions.mockResolvedValue([]);
    await render(<TransactionsScreen />);
    await flush();

    await fireEvent.press(screen.getByTestId('transactions-filters-button'));
    await flush();
    await fireEvent.press(screen.getByTestId('transactions-filter-kind'));
    await flush();
    await fireEvent.press(await screen.findByTestId('transactions-filter-kind-option-transfert'));
    await flush();
    await fireEvent.press(screen.getByTestId('transactions-filter-kind-done'));
    await flush();
    await fireEvent.press(screen.getByTestId('transactions-filters-apply'));

    await waitFor(() => expect(mockedApi.listTransactions).toHaveBeenCalledWith(expect.objectContaining({ kind: 'transfer_in,transfer_out' })));
  });

  it("période Du 01/09/2026 au 30/09/2026 : from/to couvrent exactement ces jours (convention [from, to) déjà utilisée par l'app)", async () => {
    mockedApi.listTransactions.mockResolvedValue([]);
    await render(<TransactionsScreen />);
    await flush();

    await fireEvent.press(screen.getByTestId('transactions-filters-button'));
    await flush();

    await fireEvent.press(screen.getByText('Date de début'));
    lastDatePickerOpen!.onChange({ type: 'set' }, new Date('2026-09-01T00:00:00'));
    await flush();

    await fireEvent.press(screen.getByText('Date de fin'));
    lastDatePickerOpen!.onChange({ type: 'set' }, new Date('2026-09-30T00:00:00'));
    await flush();

    await fireEvent.press(screen.getByTestId('transactions-filters-apply'));

    await waitFor(() =>
      expect(mockedApi.listTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }),
      ),
    );
  });

  it('regroupe les transactions par mois civil (deux en-têtes de section pour deux mois différents)', async () => {
    mockedApi.listTransactions.mockResolvedValue([
      { kind: 'income', displayKind: 'revenu', id: 'a', occurredAt: '2026-09-15T00:00:00.000Z', amount: 100, accountName: 'Cpt', label: 'Salaire', categoryName: null, categoryTypeName: null, categorySubtypeName: null },
      { kind: 'income', displayKind: 'revenu', id: 'b', occurredAt: '2026-08-15T00:00:00.000Z', amount: 100, accountName: 'Cpt', label: 'Salaire', categoryName: null, categoryTypeName: null, categorySubtypeName: null },
    ]);

    await render(<TransactionsScreen />);
    await waitFor(() => expect(screen.getByText('septembre 2026')).toBeTruthy());
    expect(screen.getByText('août 2026')).toBeTruthy();
  });

  it("l'initiateur n'est affiché que lorsque createdByName est présent", async () => {
    mockedApi.listTransactions.mockResolvedValue([
      { kind: 'income', displayKind: 'revenu', id: 'a', occurredAt: '2026-09-15T00:00:00.000Z', amount: 100, accountName: 'Cpt', label: 'Salaire A', categoryName: null, categoryTypeName: null, categorySubtypeName: null, createdByUserId: 'u1', createdByName: 'Adulte1 T' },
      { kind: 'income', displayKind: 'revenu', id: 'b', occurredAt: '2026-09-16T00:00:00.000Z', amount: 100, accountName: 'Cpt', label: 'Salaire B', categoryName: null, categoryTypeName: null, categorySubtypeName: null, createdByUserId: null, createdByName: null },
    ]);

    await render(<TransactionsScreen />);
    await waitFor(() => expect(screen.getByText('Salaire A')).toBeTruthy());
    expect(screen.getByText('Ajouté par Adulte1 T')).toBeTruthy();
    expect(screen.queryByText(/Ajouté par null/)).toBeNull();
  });

  it('badge budget/plan : libellé mappé quand trouvé, fallback discret "Budget"/"Plan" sinon (jamais un rattachement inventé)', async () => {
    mockedApi.listVariableBudgets.mockResolvedValue([{ id: 'bud-1', category: { name: 'Alimentation' } }]);
    mockedApi.listFinancialPlans.mockResolvedValue([{ id: 'plan-1', label: 'École 2026' }]);
    mockedApi.listTransactions.mockResolvedValue([
      { kind: 'budget_expense', displayKind: 'dépense', id: 'a', occurredAt: '2026-09-15T00:00:00.000Z', amount: -50, accountName: 'Cpt', label: 'Courses', categoryName: null, categoryTypeName: null, categorySubtypeName: null, budgetId: 'bud-1', financialPlanId: null },
      { kind: 'payment', displayKind: 'paiement', id: 'b', occurredAt: '2026-09-16T00:00:00.000Z', amount: -100, accountName: 'Cpt', label: 'Frais', categoryName: null, categoryTypeName: null, categorySubtypeName: null, budgetId: null, financialPlanId: 'plan-deleted' },
    ]);

    await render(<TransactionsScreen />);
    await waitFor(() => expect(screen.getByText('Alimentation')).toBeTruthy());
    // plan-deleted n'existe plus dans listFinancialPlans() → fallback générique, jamais inventé.
    expect(screen.getByText('Plan')).toBeTruthy();
  });

  it('état vide distinct : filtres actifs sans résultat ≠ aucune transaction du tout', async () => {
    mockedApi.listTransactions.mockResolvedValue([]);
    mockedApi.listAccounts.mockResolvedValue([{ id: 'acc-1', name: 'Compte SG' }]);
    await render(<TransactionsScreen />);
    await waitFor(() => expect(screen.getByText("Aucune transaction pour l'instant.")).toBeTruthy());

    await fireEvent.press(screen.getByTestId('transactions-filters-button'));
    await flush();
    await fireEvent.press(screen.getByTestId('transactions-filter-account'));
    await flush();
    await fireEvent.press(await screen.findByTestId('transactions-filter-account-option-acc-1'));
    await flush();
    await fireEvent.press(screen.getByTestId('transactions-filters-apply'));

    await waitFor(() => expect(screen.getByText('Aucune transaction pour ces filtres.')).toBeTruthy());
    expect(screen.queryByText("Aucune transaction pour l'instant.")).toBeNull();
  });

  it('avertissement affiché quand la liste atteint exactement la limite par défaut (200)', async () => {
    const entries = Array.from({ length: 200 }, (_, i) => ({
      kind: 'adhoc_expense',
      displayKind: 'dépense',
      id: `e${i}`,
      occurredAt: '2026-09-15T00:00:00.000Z',
      amount: -10,
      accountName: 'Cpt',
      label: `Dépense ${i}`,
      categoryName: null,
      categoryTypeName: null,
      categorySubtypeName: null,
    }));
    mockedApi.listTransactions.mockResolvedValue(entries);

    await render(<TransactionsScreen />);
    await waitFor(() => expect(screen.getByTestId('transactions-limit-warning')).toBeTruthy());
  });

  it('aucun avertissement quand la liste ne contient pas exactement 200 résultats', async () => {
    mockedApi.listTransactions.mockResolvedValue([
      { kind: 'income', displayKind: 'revenu', id: 'a', occurredAt: '2026-09-15T00:00:00.000Z', amount: 100, accountName: 'Cpt', label: 'Salaire', categoryName: null, categoryTypeName: null, categorySubtypeName: null },
    ]);

    await render(<TransactionsScreen />);
    await waitFor(() => expect(screen.getByText('Salaire')).toBeTruthy());
    expect(screen.queryByTestId('transactions-limit-warning')).toBeNull();
  });
});
