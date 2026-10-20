import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AjouterScreen } from '../AjouterScreen';

/** Lot "À faire" — absence des options sur une opération déjà réalisée et sur un revenu. Cf. l'en-tête de AjouterScreen.part5.test.tsx pour le découpage. */

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

beforeEach(() => {
  jest.clearAllMocks();
  mockListAccounts.mockResolvedValue([
    { id: 'bp', name: 'BP Adil', bank: 'BP', type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 25000, nonAffecte: 25000, subaccounts: [] },
  ]);
  mockListCategories.mockResolvedValue([{ id: 'cat-courses', name: 'Courses', active: true, sortOrder: 0, isDefaultFallback: false }]);
  mockGetMyHousehold.mockResolvedValue({ id: 'h1', name: 'Foyer', currency: 'MAD', monthStartDay: 1, memberships: [] });
});

it('dépense Réalisée : "Ajouter à mes actions"/"Responsable" ne sont jamais affichées (opération déjà réalisée)', async () => {
  renderWithSafeArea(<AjouterScreen />);
  await waitFor(() => screen.getByTestId('ajouter-tile-EXPENSE'));
  await fireEvent.press(screen.getByTestId('ajouter-tile-EXPENSE'));
  await waitFor(() => screen.getByTestId('ajouter-source'));
  expect(screen.queryByTestId('ajouter-include-in-todo-toggle')).toBeNull();
  expect(screen.queryByTestId('ajouter-responsible-member')).toBeNull();
});

it("revenu à venir : jamais d'option \"Ajouter à mes actions\" (réservée aux dépenses/versements)", async () => {
  renderWithSafeArea(<AjouterScreen />);
  await waitFor(() => screen.getByTestId('ajouter-tile-INCOME'));
  await fireEvent.press(screen.getByTestId('ajouter-tile-INCOME'));
  await fireEvent.press(screen.getByTestId('ajouter-tab-a-venir'));
  await waitFor(() => screen.getByTestId('ajouter-type-ponctuelle'));
  expect(screen.queryByTestId('ajouter-include-in-todo-toggle')).toBeNull();
});
