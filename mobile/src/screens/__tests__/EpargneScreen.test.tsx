import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EpargneScreen } from '../EpargneScreen';
import { clearCache } from '../../state/cache';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockListAccounts = jest.fn();
const mockListMedicalClaims = jest.fn();
const mockListGoals = jest.fn();
const mockCreateGoal = jest.fn();
const mockDeleteGoal = jest.fn();
jest.mock('../../api/client', () => ({
  listAccounts: () => mockListAccounts(),
  listMedicalClaims: () => mockListMedicalClaims(),
  listGoals: () => mockListGoals(),
  createGoal: (...args: unknown[]) => mockCreateGoal(...args),
  deleteGoal: (...args: unknown[]) => mockDeleteGoal(...args),
}));

function renderWithSafeArea(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>{ui}</SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  mockListMedicalClaims.mockResolvedValue([]);
  mockListGoals.mockResolvedValue([]);
});

it("aucune curation cachée : tous les comptes épargne sans sous-compte ET tous les sous-comptes apparaissent, y compris BP Épargne-Autres", async () => {
  mockListAccounts.mockResolvedValue([
    { id: 'epargne-enfants', name: 'Épargne Enfants', bank: 'BP', type: 'EPARGNE', ownerMemberId: null, ownerLabel: null, balance: 42000, nonAffecte: 42000, subaccounts: [] },
    {
      id: 'bp-epargne', name: 'BP Épargne', bank: 'BP', type: 'EPARGNE', ownerMemberId: null, ownerLabel: null, balance: 60000, nonAffecte: 5000,
      subaccounts: [
        { id: 'scolarite', accountId: 'bp-epargne', name: 'BP Épargne-Scolarité', balance: 45000 },
        { id: 'autres', accountId: 'bp-epargne', name: 'BP Épargne-Autres', balance: 10000 },
      ],
    },
    {
      id: 'cih', name: 'CIH', bank: 'CIH', type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 12000, nonAffecte: 0,
      subaccounts: [{ id: 'voiture', accountId: 'cih', name: 'CIH-Voiture', balance: 5000 }],
    },
  ]);

  renderWithSafeArea(<EpargneScreen />);

  await waitFor(() => expect(screen.getByText('Épargne Enfants')).toBeTruthy());
  // BP Épargne (parent avec sous-comptes) n'apparaît pas lui-même, uniquement ses sous-comptes.
  expect(screen.queryByText('BP Épargne')).toBeNull();
  expect(screen.getByText('BP Épargne-Scolarité')).toBeTruthy();
  expect(screen.getByText('BP Épargne-Autres')).toBeTruthy();
  // CIH (courant) n'apparaît pas lui-même, mais son enveloppe de réserve oui.
  expect(screen.queryByText('CIH')).toBeNull();
  expect(screen.getByText('CIH-Voiture')).toBeTruthy();
});

it('§16/test I : objectif sur un compte réel -> barre de progression affichée avec le pourcentage réel', async () => {
  mockListAccounts.mockResolvedValue([
    { id: 'epargne-enfants', name: 'Épargne Enfants', bank: 'BP', type: 'EPARGNE', ownerMemberId: null, ownerLabel: null, balance: 45000, nonAffecte: 45000, subaccounts: [] },
  ]);
  mockListGoals.mockResolvedValue([
    { id: 'goal-1', accountId: 'epargne-enfants', subaccountId: null, targetAmount: 100000, targetDate: '2027-12-31T00:00:00.000Z', label: 'Épargne Enfants', current: 45000, percent: 45 },
  ]);

  renderWithSafeArea(<EpargneScreen />);
  await waitFor(() => screen.getByTestId('epargne-goal-epargne-enfants'));
  expect(screen.getByText(/Objectif 100 000 DH · 45%/)).toBeTruthy();
});

it('§16/test J : objectif sur un sous-compte -> création via le formulaire dédié, jamais le détail sous-compte générique', async () => {
  mockListAccounts.mockResolvedValue([
    { id: 'cih', name: 'CIH', bank: null, type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 5000, nonAffecte: 0, subaccounts: [{ id: 'voiture', accountId: 'cih', name: 'CIH-Voiture', balance: 5000 }] },
  ]);
  mockCreateGoal.mockResolvedValue({ id: 'goal-2', accountId: null, subaccountId: 'voiture', targetAmount: 15000, targetDate: null, label: 'CIH-Voiture', current: 5000, percent: 33 });

  renderWithSafeArea(<EpargneScreen />);
  await waitFor(() => screen.getByTestId('epargne-add-goal-voiture'));
  fireEvent.press(screen.getByTestId('epargne-add-goal-voiture'));

  await waitFor(() => screen.getByTestId('goal-amount'));
  fireEvent.changeText(screen.getByTestId('goal-amount'), '15000');
  await waitFor(() => expect(screen.getByTestId('goal-amount').props.value).toBe('15000'));
  fireEvent.press(screen.getByTestId('goal-submit'));

  await waitFor(() => expect(mockCreateGoal).toHaveBeenCalledWith(expect.objectContaining({ subaccountId: 'voiture', targetAmount: '15000' })));
});

it('tap sur une carte sous-compte navigue vers SubaccountDetail', async () => {
  mockListAccounts.mockResolvedValue([
    { id: 'cih', name: 'CIH', bank: null, type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 5000, nonAffecte: 0, subaccounts: [{ id: 'voiture', accountId: 'cih', name: 'CIH-Voiture', balance: 5000 }] },
  ]);
  renderWithSafeArea(<EpargneScreen />);
  await waitFor(() => screen.getByTestId('epargne-card-voiture'));
  fireEvent.press(screen.getByTestId('epargne-card-voiture'));
  expect(mockNavigate).toHaveBeenCalledWith('SubaccountDetail', { id: 'voiture' });
});
