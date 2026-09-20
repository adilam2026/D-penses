import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { IncomeOccurrenceDetailScreen } from '../IncomeOccurrenceDetailScreen';
import * as api from '../../../api/client';

/**
 * Correction UX (Calendrier — occurrence de revenu) : fiche d'UNE occurrence
 * précise (libellé/date/montant/compte/statut/Reçu/Annuler), jamais la
 * gestion de la source récurrente entière (Modifier la source, Fréquence,
 * Arrêter la récurrence, Supprimer, liste des autres occurrences).
 */
jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: { id: 'occ1' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    getIncomeOccurrence: jest.fn(),
    listAccounts: jest.fn(),
    confirmIncomeOccurrence: jest.fn(),
    unconfirmIncomeOccurrence: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

const OCCURRENCE_PREVU = {
  id: 'occ1',
  usualDate: '2026-09-26',
  plannedAmount: 46700,
  actualAmount: null,
  actualDate: null,
  status: 'prevu' as const,
  accountId: 'acc1',
  incomeSource: { id: 's1', label: 'Salaire Adil' },
};

const ACCOUNTS = [
  { id: 'acc1', name: 'Compte courant' },
  { id: 'acc2', name: 'Épargne' },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockedApi.listAccounts.mockResolvedValue(ACCOUNTS);
});

it("affiche la fiche d'une occurrence prévue : libellé, date, montant, compte, statut — jamais les champs de gestion de la source", async () => {
  mockedApi.getIncomeOccurrence.mockResolvedValue(OCCURRENCE_PREVU);
  await render(<IncomeOccurrenceDetailScreen />);
  await waitFor(() => screen.getByText('Salaire Adil'));

  expect(screen.getByText('Prévu')).toBeTruthy();
  expect(screen.getAllByText(/46[\s ]?700 DH/).length).toBeGreaterThan(0);
  expect(screen.getByTestId('income-occurrence-confirm')).toBeTruthy();

  // Jamais les champs/actions de gestion de la source (réservés à IncomeSourceDetail).
  expect(screen.queryByText('Modifier la source')).toBeNull();
  expect(screen.queryByText('Fréquence')).toBeNull();
  expect(screen.queryByText(/Arrêter la récurrence/)).toBeNull();
  expect(screen.queryByText('Supprimer')).toBeNull();
  expect(screen.queryByText('Occurrences')).toBeNull();
  expect(screen.queryByTestId('income-source-save')).toBeNull();
  expect(screen.queryByTestId('income-source-toggle-status')).toBeNull();
  expect(screen.queryByTestId('income-source-delete')).toBeNull();
});

it('"Reçu" réutilise exactement confirmIncomeOccurrence (compte obligatoire, montant réel)', async () => {
  mockedApi.getIncomeOccurrence.mockResolvedValue(OCCURRENCE_PREVU);
  mockedApi.confirmIncomeOccurrence.mockResolvedValue({});
  await render(<IncomeOccurrenceDetailScreen />);
  await waitFor(() => screen.getByTestId('income-occurrence-confirm'));

  await fireEvent.changeText(screen.getByTestId('income-occurrence-amount-input'), '46700');
  await fireEvent.press(screen.getByTestId('income-occurrence-confirm'));

  await waitFor(() =>
    expect(mockedApi.confirmIncomeOccurrence).toHaveBeenCalledWith('occ1', expect.objectContaining({ actualAmount: 46700, accountId: 'acc1' })),
  );
});

it('refuse "Reçu" sans compte sélectionné', async () => {
  mockedApi.getIncomeOccurrence.mockResolvedValue({ ...OCCURRENCE_PREVU, accountId: null });
  await render(<IncomeOccurrenceDetailScreen />);
  await waitFor(() => screen.getByTestId('income-occurrence-confirm'));

  await fireEvent.changeText(screen.getByTestId('income-occurrence-amount-input'), '46700');
  await fireEvent.press(screen.getByTestId('income-occurrence-confirm'));

  await waitFor(() => screen.getByText('Choisissez un compte à créditer'));
  expect(mockedApi.confirmIncomeOccurrence).not.toHaveBeenCalled();
});

it("après réception, affiche le statut Reçu et propose Annuler (réutilise unconfirmIncomeOccurrence, jamais un DELETE)", async () => {
  mockedApi.getIncomeOccurrence.mockResolvedValue({
    ...OCCURRENCE_PREVU,
    status: 'recu',
    actualAmount: 46700,
    actualDate: '2026-09-26',
  });
  mockedApi.unconfirmIncomeOccurrence.mockResolvedValue({});
  await render(<IncomeOccurrenceDetailScreen />);
  await waitFor(() => screen.getByText('Reçu'));

  expect(screen.queryByTestId('income-occurrence-confirm')).toBeNull();
  expect(screen.getByTestId('income-occurrence-cancel')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('income-occurrence-cancel'));
  const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  await buttons[1].onPress();

  await waitFor(() => expect(mockedApi.unconfirmIncomeOccurrence).toHaveBeenCalledWith('occ1'));
});
