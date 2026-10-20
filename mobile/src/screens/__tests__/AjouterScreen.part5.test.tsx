import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AjouterScreen } from '../AjouterScreen';

/**
 * Lot "À faire" — "Ajouter à mes actions" + "Responsable" sur la création
 * d'une échéance future/récurrente. Séparé des fichiers voisins (cf. leur
 * commentaire d'en-tête) : un montage par fichier pour cet environnement de
 * test RNTL (au plus 2 montages par fichier).
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
const mockCreateRecurrenceRule = jest.fn();

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
  createRecurrenceRule: (...args: unknown[]) => mockCreateRecurrenceRule(...args),
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
  mockCreateRecurrenceRule.mockResolvedValue({});
});

it('versement à venir : "Ajouter à mes actions" coché par défaut (OUI), le responsable est sélectionnable', async () => {
  renderWithSafeArea(<AjouterScreen />);
  await waitFor(() => screen.getByTestId('ajouter-tile-SAVINGS_CONTRIBUTION'));
  await fireEvent.press(screen.getByTestId('ajouter-tile-SAVINGS_CONTRIBUTION'));
  await fireEvent.press(screen.getByTestId('ajouter-tab-a-venir'));

  await waitFor(() => screen.getByTestId('ajouter-include-in-todo-toggle'));
  // Coché par défaut (OUI) — le responsable est donc déjà sélectionnable.
  await waitFor(() => screen.getByTestId('ajouter-responsible-member'));

  await fireEvent.press(screen.getByTestId('ajouter-responsible-member'));
  await waitFor(() => screen.getByTestId('ajouter-responsible-member-option-m-lamiaa'));
  await fireEvent.press(screen.getByTestId('ajouter-responsible-member-option-m-lamiaa'));
  expect(screen.getByText('Lamiaa')).toBeTruthy();

  // Décocher fait disparaître le responsable (jamais envoyé si l'action n'est pas incluse).
  await fireEvent.press(screen.getByTestId('ajouter-include-in-todo-toggle'));
  expect(screen.queryByTestId('ajouter-responsible-member')).toBeNull();
});

it('dépense à venir : "Ajouter à mes actions" décoché par défaut (NON) ; cocher fait apparaître le responsable, décocher le fait disparaître à nouveau', async () => {
  renderWithSafeArea(<AjouterScreen />);
  await waitFor(() => screen.getByTestId('ajouter-tile-EXPENSE'));
  await fireEvent.press(screen.getByTestId('ajouter-tile-EXPENSE'));
  await fireEvent.press(screen.getByTestId('ajouter-tab-a-venir'));

  await waitFor(() => screen.getByTestId('ajouter-include-in-todo-toggle'));
  expect(screen.queryByTestId('ajouter-responsible-member')).toBeNull(); // décoché par défaut -> jamais affiché

  await fireEvent.press(screen.getByTestId('ajouter-include-in-todo-toggle'));
  await waitFor(() => screen.getByTestId('ajouter-responsible-member'));

  await fireEvent.press(screen.getByTestId('ajouter-include-in-todo-toggle'));
  expect(screen.queryByTestId('ajouter-responsible-member')).toBeNull();
});
