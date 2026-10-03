import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AjouterScreen } from '../AjouterScreen';

/**
 * Séparé de AjouterScreen.test.tsx : monter cet écran plus de deux fois dans
 * le même fichier Jest déclenche une désynchronisation de rendu propre à
 * l'environnement de test RNTL v14 (arbre vide au 3e montage, reproductible
 * même avec un cleanup() explicite entre chaque test) — sans rapport avec un
 * bug de l'écran lui-même (fonctionne normalement dans l'app et dans les 2
 * premiers tests du fichier voisin). Un fichier par petit lot de tests
 * contourne ce problème d'environnement.
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
    { id: 'cih', name: 'CIH', bank: 'CIH', type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 12000, nonAffecte: 9000, subaccounts: [{ id: 'sante', accountId: 'cih', name: 'CIH-Santé', balance: 3000 }] },
  ]);
  mockListCategories.mockResolvedValue([
    { id: 'cat-courses', name: 'Courses', active: true, sortOrder: 0, isDefaultFallback: false },
    { id: 'cat-sante', name: 'Santé', active: true, sortOrder: 1, isDefaultFallback: false },
  ]);
});

it('mode Transfert : masque/réinitialise l\'onglet "À venir" (TRANSFER exclu de PlannedOperationKind)', async () => {
  renderWithSafeArea(<AjouterScreen />);
  await waitFor(() => screen.getByTestId('ajouter-tile-EXPENSE'));
  fireEvent.press(screen.getByTestId('ajouter-tile-EXPENSE'));
  await waitFor(() => screen.getByTestId('ajouter-tab-a-venir'));
  expect(screen.getByTestId('ajouter-tab-a-venir')).toBeTruthy();

  fireEvent.press(screen.getByTestId('ajouter-form-back'));
  await waitFor(() => screen.getByTestId('ajouter-tile-TRANSFER'));
  fireEvent.press(screen.getByTestId('ajouter-tile-TRANSFER'));
  await waitFor(() => expect(screen.queryByTestId('ajouter-tab-a-venir')).toBeNull());
});

// "+ Nouvelle catégorie" vit dans AjouterScreen.part3.test.tsx (même raison
// que le commentaire d'en-tête : ce montage-écran-ci ouvre un Modal
// personnalisé (NewCategoryModal) dont l'interaction devient instable dès
// qu'il suit un autre montage d'AjouterScreen dans le même fichier).
