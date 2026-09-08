import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { RecurringTransfersScreen } from '../RecurringTransfersScreen';
import * as api from '../../../api/client';

/**
 * R6.2 corrections finales §4 — "Transferts récurrents" doit être consultable
 * depuis un vrai écran de gestion (liste), jamais seulement via sa création.
 */
jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    listRecurringTransfers: jest.fn(),
    listTransfers: jest.fn(),
    listAccounts: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

const ACCOUNTS = [
  { id: 'acc1', name: 'SG Adil' },
  { id: 'acc2', name: 'Épargne Lamiaa' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listAccounts.mockResolvedValue(ACCOUNTS as any);
});

it('affiche un transfert récurrent actif avec montant/fréquence/comptes/prochaine occurrence', async () => {
  mockedApi.listRecurringTransfers.mockResolvedValue([
    { id: 'rt1', label: 'Épargne Lamiaa', fromAccountId: 'acc1', toAccountId: 'acc2', amount: 1000, recurrenceRule: 'mensuel', status: 'actif' },
  ] as any);
  mockedApi.listTransfers.mockResolvedValue([
    { id: 'at1', recurringTransferId: 'rt1', status: 'prevu', plannedDate: '2026-09-28' },
  ] as any);

  await render(<RecurringTransfersScreen />);

  await waitFor(() => screen.getByText('Épargne Lamiaa'));
  expect(screen.getByText(/1 000 DH · Mensuel/)).toBeTruthy();
  expect(screen.getByText('SG Adil → Épargne Lamiaa')).toBeTruthy();
  expect(screen.getByText(/Prochain transfert : 28 sept/)).toBeTruthy();
});

it('tap sur une ligne navigue vers le détail', async () => {
  mockedApi.listRecurringTransfers.mockResolvedValue([
    { id: 'rt1', label: 'Épargne Lamiaa', fromAccountId: 'acc1', toAccountId: 'acc2', amount: 1000, recurrenceRule: 'mensuel', status: 'actif' },
  ] as any);
  mockedApi.listTransfers.mockResolvedValue([]);

  await render(<RecurringTransfersScreen />);
  await waitFor(() => screen.getByTestId('recurring-transfer-row-rt1'));
  await fireEvent.press(screen.getByTestId('recurring-transfer-row-rt1'));

  expect(mockNavigate).toHaveBeenCalledWith('RecurringTransferDetail', { id: 'rt1' });
});

it('une récurrence arrêtée reste visible (repliée) et affiche "Récurrence arrêtée"', async () => {
  mockedApi.listRecurringTransfers.mockResolvedValue([
    { id: 'rt2', label: 'Stoppé', fromAccountId: 'acc1', toAccountId: 'acc2', amount: 500, recurrenceRule: 'mensuel', status: 'inactif' },
  ] as any);
  mockedApi.listTransfers.mockResolvedValue([]);

  await render(<RecurringTransfersScreen />);
  await waitFor(() => screen.getByText(/récurrences arrêtées/));
  expect(screen.queryByText('Stoppé')).toBeNull();

  await fireEvent.press(screen.getByTestId('toggle-inactive-recurring-transfers'));
  expect(screen.getByText('Stoppé')).toBeTruthy();
  expect(screen.getByText('Récurrence arrêtée')).toBeTruthy();
});

it('état vide : aucun transfert récurrent', async () => {
  mockedApi.listRecurringTransfers.mockResolvedValue([]);
  mockedApi.listTransfers.mockResolvedValue([]);

  await render(<RecurringTransfersScreen />);
  await waitFor(() => screen.getByText(/Aucun transfert récurrent/));
});
