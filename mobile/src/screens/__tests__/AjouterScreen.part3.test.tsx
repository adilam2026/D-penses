import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AjouterScreen } from '../AjouterScreen';

/** Cf. l'en-tête de AjouterScreen.part2.test.tsx pour le pourquoi de ce découpage. */

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
const mockCreateCategory = jest.fn();

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
  createCategory: (...args: unknown[]) => mockCreateCategory(...args),
  createPlannedOperation: jest.fn(),
  createRecurrenceRule: jest.fn(),
  createAccount: jest.fn(),
  createSubaccount: jest.fn(),
}));

function renderWithSafeArea(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>{ui}</SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListAccounts.mockResolvedValue([
    { id: 'bp', name: 'BP Lamiaa', bank: 'BP', type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 25000, nonAffecte: 25000, subaccounts: [] },
  ]);
  mockListCategories.mockResolvedValue([
    { id: 'cat-courses', name: 'Courses', active: true, sortOrder: 0, isDefaultFallback: false },
  ]);
});

it('"+ Nouvelle catégorie" crée puis sélectionne la catégorie', async () => {
  mockCreateCategory.mockResolvedValue({ id: 'cat-nouvelle', name: 'Loisirs', active: true, sortOrder: 2, isDefaultFallback: false });
  renderWithSafeArea(<AjouterScreen />);
  await waitFor(() => screen.getByTestId('ajouter-tile-EXPENSE'));
  fireEvent.press(screen.getByTestId('ajouter-tile-EXPENSE'));
  await waitFor(() => screen.getByTestId('ajouter-new-category'));
  fireEvent.press(screen.getByTestId('ajouter-new-category'));
  await waitFor(() => screen.getByTestId('new-category-name'));
  fireEvent.changeText(screen.getByTestId('new-category-name'), 'Loisirs');
  await waitFor(() => expect(screen.getByTestId('new-category-name').props.value).toBe('Loisirs'));
  fireEvent.press(screen.getByTestId('new-category-submit'));
  await waitFor(() => expect(mockCreateCategory).toHaveBeenCalledWith('Loisirs'));
});
