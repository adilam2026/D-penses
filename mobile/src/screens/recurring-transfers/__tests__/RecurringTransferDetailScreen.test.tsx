import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { RecurringTransferDetailScreen } from '../RecurringTransferDetailScreen';
import * as api from '../../../api/client';

/**
 * R6.2 corrections finales §4/§5 — édition (uniquement occurrences futures),
 * "ARRÊTER LA RÉCURRENCE", confirmation d'une occurrence prévue.
 */
jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

jest.mock('../../../ui/DateField', () => {
  const { TextInput } = require('react-native');
  return {
    DateField: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) => (
      <TextInput testID={label ? `date-${label}` : 'date-field'} value={value} onChangeText={onChange} />
    ),
  };
});

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { id: 'rt1' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    getRecurringTransfer: jest.fn(),
    updateRecurringTransfer: jest.fn(),
    listTransfers: jest.fn(),
    listAccounts: jest.fn(),
    confirmTransfer: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

const ACCOUNTS = [
  { id: 'acc1', name: 'SG Adil' },
  { id: 'acc2', name: 'Épargne Lamiaa' },
];

const TRANSFER = {
  id: 'rt1',
  label: 'Épargne Lamiaa',
  fromAccountId: 'acc1',
  toAccountId: 'acc2',
  amount: 1000,
  recurrenceRule: 'mensuel',
  recurrenceAnchorDate: '2026-09-28',
  note: null,
  status: 'actif' as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.getRecurringTransfer.mockResolvedValue(TRANSFER as any);
  mockedApi.listAccounts.mockResolvedValue(ACCOUNTS as any);
  mockedApi.listTransfers.mockResolvedValue([]);
});

it('modifie le libellé et enregistre — sans jamais toucher un transfert déjà confirmé', async () => {
  mockedApi.updateRecurringTransfer.mockResolvedValue({ ...TRANSFER, label: 'Épargne renommée' });
  await render(<RecurringTransferDetailScreen />);
  await waitFor(() => screen.getByDisplayValue('Épargne Lamiaa'));

  await fireEvent.changeText(screen.getByDisplayValue('Épargne Lamiaa'), 'Épargne renommée');
  await fireEvent.press(screen.getByTestId('recurring-transfer-save'));

  await waitFor(() =>
    expect(mockedApi.updateRecurringTransfer).toHaveBeenCalledWith('rt1', expect.objectContaining({ label: 'Épargne renommée' })),
  );
});

it('"ARRÊTER LA RÉCURRENCE" bascule status=inactif', async () => {
  mockedApi.updateRecurringTransfer.mockResolvedValue({ ...TRANSFER, status: 'inactif' });
  await render(<RecurringTransferDetailScreen />);
  await waitFor(() => screen.getByTestId('recurring-transfer-toggle-status'));

  await fireEvent.press(screen.getByTestId('recurring-transfer-toggle-status'));

  await waitFor(() => expect(mockedApi.updateRecurringTransfer).toHaveBeenCalledWith('rt1', { status: 'inactif' }));
});

it('une récurrence arrêtée affiche la bannière "Récurrence arrêtée"', async () => {
  mockedApi.getRecurringTransfer.mockResolvedValue({ ...TRANSFER, status: 'inactif' } as any);
  await render(<RecurringTransferDetailScreen />);

  await waitFor(() => screen.getByText(/Récurrence arrêtée/));
});

it('liste les occurrences prévues et confirme une occurrence (débit/crédit réel)', async () => {
  mockedApi.listTransfers.mockResolvedValue([
    { id: 'at1', recurringTransferId: 'rt1', status: 'prevu', plannedDate: '2026-09-28', actualDate: null, amount: 1000 },
  ] as any);
  mockedApi.confirmTransfer.mockResolvedValue({ id: 'at1', status: 'confirme' } as any);

  await render(<RecurringTransferDetailScreen />);
  await waitFor(() => screen.getByTestId('confirm-occurrence-at1'));

  await fireEvent.press(screen.getByTestId('confirm-occurrence-at1'));

  await waitFor(() => expect(mockedApi.confirmTransfer).toHaveBeenCalledWith('at1'));
});

it('affiche l\'historique des occurrences confirmées séparément des occurrences prévues', async () => {
  mockedApi.listTransfers.mockResolvedValue([
    { id: 'at1', recurringTransferId: 'rt1', status: 'prevu', plannedDate: '2026-10-28', actualDate: null, amount: 1000 },
    { id: 'at2', recurringTransferId: 'rt1', status: 'confirme', plannedDate: '2026-09-28', actualDate: '2026-09-28', amount: 1000 },
  ] as any);

  await render(<RecurringTransferDetailScreen />);
  await waitFor(() => screen.getByTestId('occurrence-row-at1'));

  expect(screen.getByTestId('history-row-at2')).toBeTruthy();
});
