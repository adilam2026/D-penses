import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { TransactionDetailScreen } from '../TransactionDetailScreen';
import * as api from '../../../api/client';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: { kind: string; id: string } = { kind: 'payment', id: 'p1' };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: mockRouteParams }),
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
    getTransactionDetail: jest.fn(),
    getProvision: jest.fn(),
    correctPayment: jest.fn(),
    reversePayment: jest.fn(),
    unconfirmIncomeOccurrence: jest.fn(),
    correctAdhocExpense: jest.fn(),
    reverseAdhocExpense: jest.fn(),
    reverseTransfer: jest.fn(),
    updateExpenseMetadata: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

function mockConfirmAlert() {
  const RN = require('react-native');
  return jest.spyOn(RN.Alert, 'alert').mockImplementation((...args: unknown[]) => {
    const buttons = args[2] as Array<{ text: string; onPress?: () => void }> | undefined;
    buttons?.find((b) => b.text === 'Confirmer')?.onPress?.();
  });
}

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

const PAYMENT_DETAIL = {
  kind: 'payment',
  displayKind: 'paiement',
  id: 'p1',
  origin: "Paiement d'une échéance",
  label: 'Frais scolarité clôture',
  amount: -1500,
  date: '2026-09-30T00:00:00.000Z',
  accountId: 'a1',
  accountName: 'Compte SG',
  note: null,
  deadline: { id: 'd1', dueDate: '2026-09-30T00:00:00.000Z', chargePlanLabel: 'Frais scolarité clôture' },
  financialPlan: null,
  provisionId: null,
};

describe('R5 clôture §1 — actions par type de transaction', () => {
  it('paiement : propose Corriger et Annuler, jamais Supprimer', async () => {
    mockedApi.getTransactionDetail.mockResolvedValue(PAYMENT_DETAIL);
    await render(<TransactionDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('action-correct')).toBeTruthy());
    expect(screen.getByTestId('action-reverse')).toBeTruthy();
    expect(screen.queryByText(/Supprimer/i)).toBeNull();
  });

  it('paiement : Corriger appelle correctPayment avec le montant corrigé puis revient en arrière', async () => {
    mockedApi.getTransactionDetail.mockResolvedValue(PAYMENT_DETAIL);
    mockedApi.correctPayment.mockResolvedValue({});
    await render(<TransactionDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('action-correct')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('action-correct'));
    await waitFor(() => expect(screen.getByTestId('correct-form')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('correct-amount-input'), '1600');
    await fireEvent.press(screen.getByTestId('correct-confirm'));

    await waitFor(() => expect(mockedApi.correctPayment).toHaveBeenCalledWith('d1', 'p1', { correctedAmount: 1600 }));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('paiement : Annuler demande confirmation puis appelle reversePayment', async () => {
    mockedApi.getTransactionDetail.mockResolvedValue(PAYMENT_DETAIL);
    mockedApi.reversePayment.mockResolvedValue({});
    const alertSpy = mockConfirmAlert();
    await render(<TransactionDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('action-reverse')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('action-reverse'));

    expect(alertSpy).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.reversePayment).toHaveBeenCalledWith('d1', 'p1'));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('revenu confirmé : propose uniquement Annuler', async () => {
    mockRouteParams = { kind: 'income', id: 'occ1' };
    mockedApi.getTransactionDetail.mockResolvedValue({
      kind: 'income',
      displayKind: 'revenu',
      id: 'occ1',
      origin: 'Revenu confirmé',
      label: 'Salaire',
      amount: 8000,
      date: '2026-09-30T00:00:00.000Z',
      accountId: 'a1',
      accountName: 'Compte SG',
      note: null,
      deadline: null,
      financialPlan: null,
      provisionId: null,
    });
    mockedApi.unconfirmIncomeOccurrence.mockResolvedValue({});
    const alertSpy = mockConfirmAlert();
    await render(<TransactionDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('action-unconfirm')).toBeTruthy());
    expect(screen.queryByTestId('action-correct')).toBeNull();

    await fireEvent.press(screen.getByTestId('action-unconfirm'));

    expect(alertSpy).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.unconfirmIncomeOccurrence).toHaveBeenCalledWith('occ1'));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('dépense ponctuelle : Modifier la description sauvegarde puis recharge le détail (jamais un goBack)', async () => {
    mockRouteParams = { kind: 'adhoc_expense', id: 'e1' };
    mockedApi.getTransactionDetail.mockResolvedValue({
      kind: 'adhoc_expense',
      displayKind: 'depense',
      id: 'e1',
      origin: 'Dépense ponctuelle',
      label: 'Courses',
      amount: -200,
      date: '2026-09-10T00:00:00.000Z',
      accountId: 'a1',
      accountName: 'Compte SG',
      note: null,
      deadline: null,
      financialPlan: null,
      provisionId: null,
    });
    mockedApi.updateExpenseMetadata.mockResolvedValue({});
    await render(<TransactionDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('action-metadata')).toBeTruthy());
    expect(screen.getByTestId('action-correct')).toBeTruthy();
    expect(screen.getByTestId('action-reverse')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('action-metadata'));
    await waitFor(() => expect(screen.getByTestId('metadata-form')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('metadata-notes-input'), 'Courses de la semaine');
    await fireEvent.press(screen.getByTestId('metadata-save'));

    await waitFor(() => expect(mockedApi.updateExpenseMetadata).toHaveBeenCalledWith('adhoc_expense', 'e1', { notes: 'Courses de la semaine' }));
    expect(mockGoBack).not.toHaveBeenCalled(); // reste sur l'écran, détail rechargé
  });

  it('dépense sur budget : propose uniquement Modifier, jamais Corriger/Annuler', async () => {
    mockRouteParams = { kind: 'budget_expense', id: 'be1' };
    mockedApi.getTransactionDetail.mockResolvedValue({
      kind: 'budget_expense',
      displayKind: 'depense',
      id: 'be1',
      origin: 'Dépense sur budget variable',
      label: 'Loisirs',
      amount: -80,
      date: '2026-09-10T00:00:00.000Z',
      accountId: 'a1',
      accountName: 'Compte SG',
      note: null,
      deadline: null,
      financialPlan: null,
      provisionId: null,
    });
    await render(<TransactionDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('action-metadata')).toBeTruthy());
    expect(screen.queryByTestId('action-correct')).toBeNull();
    expect(screen.queryByTestId('action-reverse')).toBeNull();
  });

  it('ajustement : aucune action, lecture seule', async () => {
    mockRouteParams = { kind: 'adjustment', id: 'adj1' };
    mockedApi.getTransactionDetail.mockResolvedValue({
      kind: 'adjustment',
      displayKind: 'ajustement',
      id: 'adj1',
      origin: 'Ajustement de rapprochement',
      label: 'Écart',
      amount: -50,
      date: '2026-09-10T00:00:00.000Z',
      accountId: 'a1',
      accountName: 'Compte SG',
      note: null,
      deadline: null,
      financialPlan: null,
      provisionId: null,
    });
    await render(<TransactionDetailScreen />);
    await waitFor(() => expect(screen.getByText('Écart')).toBeTruthy());
    expect(screen.queryByTestId('action-correct')).toBeNull();
    expect(screen.queryByTestId('action-reverse')).toBeNull();
    expect(screen.queryByTestId('action-metadata')).toBeNull();
  });

  it('transfert confirmé : propose Annuler (transfert miroir), appelle reverseTransfer', async () => {
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
    mockedApi.reverseTransfer.mockResolvedValue({});
    const alertSpy = mockConfirmAlert();
    await render(<TransactionDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('action-reverse')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('action-reverse'));

    expect(alertSpy).toHaveBeenCalled();
    await waitFor(() => expect(mockedApi.reverseTransfer).toHaveBeenCalledWith('t1'));
    expect(mockGoBack).toHaveBeenCalled();
  });

  it("l'action affiche un message d'erreur si le backend refuse (jamais un crash silencieux)", async () => {
    mockedApi.getTransactionDetail.mockResolvedValue(PAYMENT_DETAIL);
    mockedApi.reversePayment.mockRejectedValue(new api.ApiError(400, 'Action refusée par le serveur'));
    mockConfirmAlert();
    await render(<TransactionDetailScreen />);
    await waitFor(() => expect(screen.getByTestId('action-reverse')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('action-reverse'));

    await waitFor(() => expect(screen.getByText('Action refusée par le serveur')).toBeTruthy());
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});
