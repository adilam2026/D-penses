import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { TransactionsScreen } from '../TransactionsScreen';
import * as api from '../../../api/client';

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
  return { ...actual, listTransactions: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

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
