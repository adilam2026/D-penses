import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { TransactionDetailScreen } from '../TransactionDetailScreen';
import * as api from '../../../api/client';

const mockNavigate = jest.fn();
let mockRouteParams: { kind: string; id: string } = { kind: 'payment', id: 'p1' };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: mockRouteParams }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { ...actual, getTransactionDetail: jest.fn(), getProvision: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = { kind: 'payment', id: 'p1' };
});

it('§5 — affiche label, montant, date, compte, note, échéance liée et plan financier lié pour un paiement', async () => {
  mockedApi.getTransactionDetail.mockResolvedValue({
    kind: 'payment',
    displayKind: 'paiement',
    id: 'p1',
    origin: "Paiement d'une échéance",
    label: 'Frais scolarité détail',
    amount: -1500,
    date: '2026-09-30T00:00:00.000Z',
    accountId: 'a1',
    accountName: 'Compte SG',
    note: 'Paiement de test',
    deadline: { id: 'd1', dueDate: '2026-09-30T00:00:00.000Z', chargePlanLabel: 'Frais scolarité détail' },
    financialPlan: { id: 'plan1', label: 'École détail' },
    provisionId: null,
  });

  await render(<TransactionDetailScreen />);

  await waitFor(() => expect(screen.getByText('Frais scolarité détail')).toBeTruthy());
  expect(screen.getByText('-1 500 DH')).toBeTruthy();
  expect(screen.getByText('Compte SG')).toBeTruthy();
  expect(screen.getByText('Paiement de test')).toBeTruthy();
  expect(screen.getByText("Paiement d'une échéance")).toBeTruthy();
  expect(screen.getByTestId('transaction-detail-deadline-link')).toBeTruthy();
  expect(screen.getByTestId('transaction-detail-plan-link')).toBeTruthy();
});

it('§5 — taper sur l\'échéance liée navigue vers DeadlineDetail avec le bon id', async () => {
  mockedApi.getTransactionDetail.mockResolvedValue({
    kind: 'payment',
    displayKind: 'paiement',
    id: 'p1',
    origin: "Paiement d'une échéance",
    label: 'Frais scolarité détail',
    amount: -1500,
    date: '2026-09-30T00:00:00.000Z',
    accountId: 'a1',
    accountName: 'Compte SG',
    note: null,
    deadline: { id: 'd1', dueDate: '2026-09-30T00:00:00.000Z', chargePlanLabel: 'Frais scolarité détail' },
    financialPlan: null,
    provisionId: null,
  });

  await render(<TransactionDetailScreen />);
  await waitFor(() => expect(screen.getByTestId('transaction-detail-deadline-link')).toBeTruthy());

  fireEvent.press(screen.getByTestId('transaction-detail-deadline-link'));

  expect(mockNavigate).toHaveBeenCalledWith('DeadlineDetail', { id: 'd1' });
});

it('§5 — affiche le nom de l\'enveloppe quand la transaction est rattachée à une provision', async () => {
  mockRouteParams = { kind: 'payment', id: 'p2' };
  mockedApi.getTransactionDetail.mockResolvedValue({
    kind: 'payment',
    displayKind: 'paiement',
    id: 'p2',
    origin: "Paiement d'une échéance",
    label: 'Assurance détail',
    amount: -800,
    date: '2026-09-15T00:00:00.000Z',
    accountId: 'a1',
    accountName: 'Compte SG',
    note: null,
    deadline: null,
    financialPlan: null,
    provisionId: 'prov1',
  });
  mockedApi.getProvision.mockResolvedValue({ id: 'prov1', name: 'Assurance' });

  await render(<TransactionDetailScreen />);

  await waitFor(() => expect(screen.getByText('Assurance')).toBeTruthy());
  expect(mockedApi.getProvision).toHaveBeenCalledWith('prov1');
});

it('§5 — transfert affiche le compte contrepartie', async () => {
  mockRouteParams = { kind: 'transfer_out', id: 't1' };
  mockedApi.getTransactionDetail.mockResolvedValue({
    kind: 'transfer_out',
    displayKind: 'transfert',
    id: 't1',
    origin: 'Transfert sortant',
    label: 'Transfert sortant',
    amount: -500,
    date: '2026-09-10T00:00:00.000Z',
    accountId: 'source',
    accountName: 'Source',
    note: null,
    deadline: null,
    financialPlan: null,
    provisionId: null,
    transferCounterpart: { accountId: 'dest', accountName: 'Destination' },
  });

  await render(<TransactionDetailScreen />);

  await waitFor(() => expect(screen.getByText('Destination')).toBeTruthy());
});

it('§5 — transaction introuvable affiche un message d\'erreur, jamais un crash silencieux', async () => {
  mockedApi.getTransactionDetail.mockRejectedValue(new api.ApiError(404, 'Transaction introuvable'));

  await render(<TransactionDetailScreen />);

  await waitFor(() => expect(screen.getByText('Transaction introuvable')).toBeTruthy());
});
