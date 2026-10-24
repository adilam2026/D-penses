import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AjouterScreen } from '../AjouterScreen';

/**
 * Lot "responsable automatique" — le responsable est PROPOSÉ depuis le
 * propriétaire STRUCTURÉ (ownerType/ownerMemberId) du compte RÉEL à débiter,
 * jamais imposé (reste modifiable), jamais écrasé après un choix manuel.
 * Cf. l'en-tête de AjouterScreen.part5.test.tsx pour le découpage en
 * plusieurs fichiers (contrainte de montages RNTL de ce projet).
 */

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: undefined }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockListAccounts = jest.fn();
const mockListCategories = jest.fn();
const mockGetMyHousehold = jest.fn();
const mockCreatePlannedOperation = jest.fn();

jest.mock('../../api/client', () => ({
  ApiError: class FakeApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  listAccounts: () => mockListAccounts(),
  listCategories: () => mockListCategories(),
  createFinancialOperation: jest.fn(),
  createCategory: jest.fn(),
  createPlannedOperation: (...args: unknown[]) => mockCreatePlannedOperation(...args),
  createRecurrenceRule: jest.fn(),
  createAccount: jest.fn(),
  createSubaccount: jest.fn(),
  getMyHousehold: () => mockGetMyHousehold(),
}));

function renderWithSafeArea(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>{ui}</SafeAreaProvider>,
  );
}

const ACCOUNTS = [
  { id: 'sg-adil', name: 'SG Adil', bank: 'SG', type: 'COURANT', ownerType: 'INDIVIDUAL', ownerMemberId: 'm-adil', ownerLabel: null, balance: 1000, nonAffecte: 1000, subaccounts: [] },
  {
    id: 'bp-lamiaa',
    name: 'BP Lamiaa',
    bank: 'BP',
    type: 'COURANT',
    ownerType: 'INDIVIDUAL',
    ownerMemberId: 'm-lamiaa',
    ownerLabel: null,
    balance: 2000,
    nonAffecte: 2000,
    subaccounts: [{ id: 'sub-courses', accountId: 'bp-lamiaa', name: 'Courses', balance: 500, active: true }],
  },
  { id: 'compte-commun', name: 'Compte commun', bank: null, type: 'COURANT', ownerType: 'SHARED', ownerMemberId: null, ownerLabel: null, balance: 3000, nonAffecte: 3000, subaccounts: [] },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockListAccounts.mockResolvedValue(ACCOUNTS);
  mockListCategories.mockResolvedValue([{ id: 'cat-courses', name: 'Courses', active: true, sortOrder: 0, isDefaultFallback: false }]);
  mockGetMyHousehold.mockResolvedValue({
    id: 'h1',
    name: 'Foyer',
    currency: 'MAD',
    monthStartDay: 1,
    memberships: [
      { id: 'm-adil', role: 'admin', user: { id: 'u-adil', firstName: 'Adil', lastName: 'A', email: 'adil@test.local', color: null } },
      { id: 'm-lamiaa', role: 'member', user: { id: 'u-lamiaa', firstName: 'Lamiaa', lastName: 'L', email: 'lamiaa@test.local', color: null } },
    ],
  });
  mockCreatePlannedOperation.mockResolvedValue({});
});

it('source = SG Adil (propriétaire Adil) -> responsable proposé automatiquement = Adil', async () => {
  renderWithSafeArea(<AjouterScreen />);
  await waitFor(() => screen.getByTestId('ajouter-tile-SAVINGS_CONTRIBUTION'));
  await fireEvent.press(screen.getByTestId('ajouter-tile-SAVINGS_CONTRIBUTION'));
  await fireEvent.press(screen.getByTestId('ajouter-tab-a-venir'));

  await waitFor(() => screen.getByTestId('ajouter-source'));
  await fireEvent.press(screen.getByTestId('ajouter-source'));
  await fireEvent.press(screen.getByTestId('ajouter-source-option-acc:sg-adil'));

  await waitFor(() => expect(screen.getByText('Adil')).toBeTruthy());
});

it('changement de source avant tout choix manuel : le responsable proposé se met à jour (Adil -> Lamiaa)', async () => {
  renderWithSafeArea(<AjouterScreen />);
  await waitFor(() => screen.getByTestId('ajouter-tile-SAVINGS_CONTRIBUTION'));
  await fireEvent.press(screen.getByTestId('ajouter-tile-SAVINGS_CONTRIBUTION'));
  await fireEvent.press(screen.getByTestId('ajouter-tab-a-venir'));

  await waitFor(() => screen.getByTestId('ajouter-source'));
  await fireEvent.press(screen.getByTestId('ajouter-source'));
  await fireEvent.press(screen.getByTestId('ajouter-source-option-acc:sg-adil'));
  await waitFor(() => expect(screen.getByText('Adil')).toBeTruthy());

  await fireEvent.press(screen.getByTestId('ajouter-source'));
  await fireEvent.press(screen.getByTestId('ajouter-source-option-acc:bp-lamiaa'));
  await waitFor(() => expect(screen.getByText('Lamiaa')).toBeTruthy());
  expect(screen.queryByText('Adil')).toBeNull();
});

it('responsable modifié manuellement : un changement ultérieur de source ne l\'écrase jamais', async () => {
  renderWithSafeArea(<AjouterScreen />);
  await waitFor(() => screen.getByTestId('ajouter-tile-SAVINGS_CONTRIBUTION'));
  await fireEvent.press(screen.getByTestId('ajouter-tile-SAVINGS_CONTRIBUTION'));
  await fireEvent.press(screen.getByTestId('ajouter-tab-a-venir'));

  await waitFor(() => screen.getByTestId('ajouter-source'));
  await fireEvent.press(screen.getByTestId('ajouter-source'));
  await fireEvent.press(screen.getByTestId('ajouter-source-option-acc:sg-adil'));
  await waitFor(() => expect(screen.getByText('Adil')).toBeTruthy());

  // Choix manuel explicite : Lamiaa, exceptionnellement, malgré la source Adil.
  await fireEvent.press(screen.getByTestId('ajouter-responsible-member'));
  await fireEvent.press(screen.getByTestId('ajouter-responsible-member-option-m-lamiaa'));
  await waitFor(() => expect(screen.getByText('Lamiaa')).toBeTruthy());

  // Changement de source ultérieur -> le choix manuel (Lamiaa) n'est jamais écrasé.
  await fireEvent.press(screen.getByTestId('ajouter-source'));
  await fireEvent.press(screen.getByTestId('ajouter-source-option-acc:bp-lamiaa'));
  expect(screen.getByText('Lamiaa')).toBeTruthy();
});
