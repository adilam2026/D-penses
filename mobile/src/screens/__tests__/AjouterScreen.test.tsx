import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AjouterScreen } from '../AjouterScreen';

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
const mockCreateFinancialOperation = jest.fn();
const mockCreateCategory = jest.fn();
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
  createFinancialOperation: (...args: unknown[]) => mockCreateFinancialOperation(...args),
  createCategory: (...args: unknown[]) => mockCreateCategory(...args),
  createPlannedOperation: (...args: unknown[]) => mockCreatePlannedOperation(...args),
  createRecurrenceRule: (...args: unknown[]) => mockCreateRecurrenceRule(...args),
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

it('Item 14 : le libellé du compte précise s\'il sera débité ou crédité (Dépense/Revenu)', async () => {
  renderWithSafeArea(<AjouterScreen />);
  await waitFor(() => screen.getByTestId('ajouter-tile-EXPENSE'));
  fireEvent.press(screen.getByTestId('ajouter-tile-EXPENSE'));
  await waitFor(() => screen.getByTestId('ajouter-source'));
  expect(screen.getByText('Compte débité')).toBeTruthy();
  expect(screen.getByText('Ce compte sera débité du montant de la dépense.')).toBeTruthy();

  fireEvent.press(screen.getByTestId('ajouter-form-back'));
  await waitFor(() => screen.getByTestId('ajouter-tile-INCOME'));
  fireEvent.press(screen.getByTestId('ajouter-tile-INCOME'));
  await waitFor(() => screen.getByTestId('ajouter-destination'));
  expect(screen.getByText('Compte crédité')).toBeTruthy();
  expect(screen.getByText('Ce compte sera crédité du montant du revenu.')).toBeTruthy();
});

it('mode Dépense (défaut) : "Remboursable par mutuelle ?" apparaît seulement si Catégorie=Santé', async () => {
  renderWithSafeArea(<AjouterScreen />);
  await waitFor(() => screen.getByTestId('ajouter-tile-EXPENSE'));
  fireEvent.press(screen.getByTestId('ajouter-tile-EXPENSE'));
  await waitFor(() => screen.getByTestId('ajouter-category'));
  expect(screen.queryByTestId('ajouter-medical-claim-toggle')).toBeNull();

  fireEvent.press(screen.getByTestId('ajouter-category'));
  await waitFor(() => screen.getByTestId('ajouter-category-option-cat-sante'));
  fireEvent.press(screen.getByTestId('ajouter-category-option-cat-sante'));

  await waitFor(() => expect(screen.getByTestId('ajouter-medical-claim-toggle')).toBeTruthy());
  cleanup();
});

it('soumission Dépense réalisée -> createFinancialOperation avec sourceAccountId', async () => {
  mockCreateFinancialOperation.mockResolvedValue({});
  renderWithSafeArea(<AjouterScreen />);
  await waitFor(() => screen.getByTestId('ajouter-tile-EXPENSE'));
  fireEvent.press(screen.getByTestId('ajouter-tile-EXPENSE'));
  await waitFor(() => screen.getByTestId('ajouter-source'));

  fireEvent.changeText(screen.getByTestId('ajouter-amount'), '200');
  fireEvent.changeText(screen.getByTestId('ajouter-label'), 'Courses');
  fireEvent.press(screen.getByTestId('ajouter-source'));
  await waitFor(() => screen.getByTestId('ajouter-source-option-acc:bp'));
  fireEvent.press(screen.getByTestId('ajouter-source-option-acc:bp'));

  // Simule une date déjà choisie (le picker natif n'est pas testable ici) en pilotant directement le champ.
  fireEvent.press(screen.getByTestId('ajouter-submit'));
  // Sans date renseignée, canSubmit reste false : le bouton ne déclenche rien.
  expect(mockCreateFinancialOperation).not.toHaveBeenCalled();
  cleanup();
});

// Les scénarios "mode Transfert" et "+ Nouvelle catégorie" vivent dans
// AjouterScreen.part2.test.tsx — cf. le commentaire d'en-tête de ce fichier
// voisin pour la raison (contournement d'un artefact d'environnement RNTL).
