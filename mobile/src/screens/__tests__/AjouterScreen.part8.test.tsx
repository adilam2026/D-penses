import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AjouterScreen } from '../AjouterScreen';

/**
 * Lot "responsable automatique" — suite de AjouterScreen.part7.test.tsx :
 * enveloppe (hérite du propriétaire du COMPTE RÉEL) et comptes
 * Commun/Non défini (responsable proposé = null, jamais déduit).
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
  createPlannedOperation: jest.fn(),
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
  { id: 'compte-undef', name: 'Compte X', bank: null, type: 'COURANT', ownerType: 'UNDEFINED', ownerMemberId: null, ownerLabel: null, balance: 1500, nonAffecte: 1500, subaccounts: [] },
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
});

it('source = enveloppe "Courses" de BP Lamiaa -> responsable proposé = Lamiaa (hérité du COMPTE RÉEL, jamais un propriétaire propre à l\'enveloppe)', async () => {
  renderWithSafeArea(<AjouterScreen />);
  await waitFor(() => screen.getByTestId('ajouter-tile-SAVINGS_CONTRIBUTION'));
  await fireEvent.press(screen.getByTestId('ajouter-tile-SAVINGS_CONTRIBUTION'));
  await fireEvent.press(screen.getByTestId('ajouter-tab-a-venir'));

  await waitFor(() => screen.getByTestId('ajouter-source'));
  await fireEvent.press(screen.getByTestId('ajouter-source'));
  await fireEvent.press(screen.getByTestId('ajouter-source-option-sub:sub-courses'));

  await waitFor(() => expect(screen.getByText('Lamiaa')).toBeTruthy());
});

it('source = compte Commun ou Non défini -> responsable proposé = null ("Non défini"), jamais déduit', async () => {
  renderWithSafeArea(<AjouterScreen />);
  await waitFor(() => screen.getByTestId('ajouter-tile-SAVINGS_CONTRIBUTION'));
  await fireEvent.press(screen.getByTestId('ajouter-tile-SAVINGS_CONTRIBUTION'));
  await fireEvent.press(screen.getByTestId('ajouter-tab-a-venir'));

  await waitFor(() => screen.getByTestId('ajouter-source'));
  await fireEvent.press(screen.getByTestId('ajouter-source'));
  await fireEvent.press(screen.getByTestId('ajouter-source-option-acc:compte-commun'));
  await waitFor(() => screen.getByTestId('ajouter-responsible-member'));
  expect(screen.getByText('Non défini')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('ajouter-source'));
  await fireEvent.press(screen.getByTestId('ajouter-source-option-acc:compte-undef'));
  expect(screen.getByText('Non défini')).toBeTruthy();
});
