import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { DeadlineDetailScreen } from '../DeadlineDetailScreen';
import * as api from '../../../api/client';

/**
 * R6 clôture §5 — le parcours de paiement est désormais unique dans l'app :
 * sélecteur de compte compact (jamais un mur de chips), récapitulatif avant
 * confirmation (montant payé / compte / solde actuel / solde après / reste à
 * payer après opération), paiement partiel explicite.
 */
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: { id: 'dl1' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));
jest.mock('../../../ui/useKeyboardAwareScroll', () => ({
  useKeyboardAwareScroll: () => ({ scrollRef: { current: null }, handleFocus: jest.fn() }),
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    getDeadline: jest.fn(),
    listPayments: jest.fn(),
    listAccounts: jest.fn(),
    getProvision: jest.fn(),
    createPayment: jest.fn(),
    payDeadlineWithProvision: jest.fn(),
    updateDeadline: jest.fn(),
    closeDeadline: jest.fn(),
    cancelDeadline: jest.fn(),
    getMyHousehold: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

const DEADLINE = {
  id: 'dl1',
  dueDate: '2026-10-15',
  amountCurrent: 1000,
  amountStatus: 'confirme' as const,
  financialStatus: 'ouverte' as const,
  resteAPayer: 1000,
  provisionId: null,
  chargePlan: { label: 'Loyer' },
};

const ACCOUNTS = [
  { id: 'acc1', name: 'Compte principal', soldeCourant: 5000 },
  { id: 'acc2', name: 'Épargne', soldeCourant: 2000 },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listPayments.mockResolvedValue([]);
  mockedApi.listAccounts.mockResolvedValue(ACCOUNTS);
  mockedApi.getMyHousehold.mockResolvedValue({ settings: { seuilAPayerDays: 7 } } as any);
});

it('affiche un sélecteur compact pour le compte à débiter (jamais un mur de chips)', async () => {
  mockedApi.getDeadline.mockResolvedValue(DEADLINE);
  await render(<DeadlineDetailScreen />);

  await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select')).toBeTruthy());
  // Le second compte n'est jamais affiché en permanence (pas de mur de chips) — seulement via le modal du sélecteur.
  expect(screen.queryByText('Épargne')).toBeNull();

  fireEvent.press(screen.getByTestId('deadline-pay-account-select'));
  await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select-option-acc1')).toBeTruthy());
});

it('affiche le récapitulatif (solde actuel/après, reste à payer) avant confirmation, paiement total', async () => {
  mockedApi.getDeadline.mockResolvedValue(DEADLINE);
  await render(<DeadlineDetailScreen />);

  await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select')).toBeTruthy());
  fireEvent.press(screen.getByTestId('deadline-pay-account-select'));
  await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select-option-acc1')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('deadline-pay-account-select-option-acc1'));

  await fireEvent.changeText(screen.getByTestId('deadline-pay-amount-input'), '1000');

  await waitFor(() => expect(screen.getByTestId('payment-recap')).toBeTruthy());
  expect(screen.getByText('5 000 DH')).toBeTruthy(); // solde actuel
  expect(screen.getByText('4 000 DH')).toBeTruthy(); // solde après paiement
  expect(screen.getByText('0 DH')).toBeTruthy(); // reste à payer après opération

  await fireEvent.press(screen.getByText('CONFIRMER LE PAIEMENT'));
  await waitFor(() => expect(mockedApi.createPayment).toHaveBeenCalledWith('dl1', { amount: 1000, accountId: 'acc1', paidDate: expect.any(String) }));
});

it('paiement partiel : affiche explicitement le reste à payer après opération', async () => {
  mockedApi.getDeadline.mockResolvedValue(DEADLINE);
  await render(<DeadlineDetailScreen />);

  await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select')).toBeTruthy());
  fireEvent.press(screen.getByTestId('deadline-pay-account-select'));
  await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select-option-acc1')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('deadline-pay-account-select-option-acc1'));

  await fireEvent.changeText(screen.getByTestId('deadline-pay-amount-input'), '400');

  await waitFor(() => expect(screen.getByTestId('payment-recap')).toBeTruthy());
  expect(screen.getByText('600 DH')).toBeTruthy(); // reste à payer après opération
  expect(screen.getByText(/Paiement partiel — il restera 600 DH à payer/)).toBeTruthy();
});

it('le bouton CONFIRMER LE PAIEMENT est désactivé tant qu\'aucun montant n\'est saisi', async () => {
  mockedApi.getDeadline.mockResolvedValue(DEADLINE);
  await render(<DeadlineDetailScreen />);

  await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select')).toBeTruthy());
  expect(screen.queryByTestId('payment-recap')).toBeNull();
  const button = screen.getByText('CONFIRMER LE PAIEMENT').parent;
  expect(button?.props.accessibilityState?.disabled ?? true).toBeTruthy();
});

/**
 * Mini-lot Paiements/Échéances — badge temporel (statut partagé, cf.
 * deadlineTemporalStatus) + accès direct Corriger/Annuler depuis un paiement.
 */
describe('Mini-lot Paiements/Échéances — badge temporel + accès direct aux paiements', () => {
  it('une échéance soldée n\'affiche jamais de badge "En retard", même avec une date largement dépassée', async () => {
    mockedApi.getDeadline.mockResolvedValue({ ...DEADLINE, dueDate: '2020-01-01', financialStatus: 'soldee', resteAPayer: 0 });
    await render(<DeadlineDetailScreen />);

    await waitFor(() => expect(screen.getByText('Soldée')).toBeTruthy());
    expect(screen.queryByTestId('deadline-temporal-badge')).toBeNull();
    expect(screen.queryByText('En retard')).toBeNull();
  });

  it('une échéance ouverte en retard affiche le badge "En retard"', async () => {
    mockedApi.getDeadline.mockResolvedValue({ ...DEADLINE, dueDate: '2020-01-01' });
    await render(<DeadlineDetailScreen />);

    await waitFor(() => expect(screen.getByTestId('deadline-temporal-badge')).toBeTruthy());
    expect(screen.getByText('En retard')).toBeTruthy();
  });

  it('tap sur une ligne "Paiement enregistré" → navigation directe vers TransactionDetailScreen (Corriger/Annuler existants réutilisés)', async () => {
    mockedApi.getDeadline.mockResolvedValue(DEADLINE);
    mockedApi.listPayments.mockResolvedValue([
      { id: 'pay1', amount: 400, paidDate: '2026-10-01', type: 'paiement', accountId: 'acc1', provisionId: null },
    ]);
    await render(<DeadlineDetailScreen />);

    await waitFor(() => expect(screen.getByTestId('deadline-payment-row-pay1')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('deadline-payment-row-pay1'));

    expect(mockNavigate).toHaveBeenCalledWith('TransactionDetail', { kind: 'payment', id: 'pay1' });
  });
});
