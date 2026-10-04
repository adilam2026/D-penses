import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AjouterScreen } from '../AjouterScreen';

/**
 * Séparé des fichiers voisins (cf. leur commentaire d'en-tête) : un montage
 * par fichier pour cet environnement de test RNTL.
 *
 * Lot "Afficher dans le Planning" (dépense ponctuelle réalisée) : la case
 * est cochée par défaut, visible uniquement en mode Dépense + onglet
 * Réalisée (jamais pour une échéance à venir ni une récurrence, qui restent
 * toujours intégrées au Planning).
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
  mockListCategories.mockResolvedValue([{ id: 'cat-courses', name: 'Courses', active: true, sortOrder: 0, isDefaultFallback: false }]);
});

it('"Afficher dans le Planning" : cochée par défaut en Dépense/Réalisée, masquée en À venir', async () => {
  renderWithSafeArea(<AjouterScreen />);
  await waitFor(() => screen.getByTestId('ajouter-tile-EXPENSE'));
  await fireEvent.press(screen.getByTestId('ajouter-tile-EXPENSE'));

  // Dépense + Réalisée (défaut) : visible, cochée par défaut.
  await waitFor(() => screen.getByTestId('ajouter-include-in-planning-toggle'));
  expect(screen.getByText('Afficher dans le Planning')).toBeTruthy();
  expect(screen.getByText("Décochez pour enregistrer cette dépense uniquement dans vos opérations réelles.")).toBeTruthy();

  // Décocher puis recocher fonctionne (toggle, aucune exception).
  await fireEvent.press(screen.getByTestId('ajouter-include-in-planning-toggle'));
  await fireEvent.press(screen.getByTestId('ajouter-include-in-planning-toggle'));

  // Dépense + À venir : jamais affichée (toujours planifiée par nature).
  await fireEvent.press(screen.getByTestId('ajouter-tab-a-venir'));
  await waitFor(() => screen.getByTestId('ajouter-type-ponctuelle'));
  expect(screen.queryByTestId('ajouter-include-in-planning-toggle')).toBeNull();

  // Retour à Réalisée : réapparaît.
  await fireEvent.press(screen.getByTestId('ajouter-tab-realisee'));
  await waitFor(() => screen.getByTestId('ajouter-include-in-planning-toggle'));
});

it('"Afficher dans le Planning" : jamais affichée en mode Revenu (réservée aux dépenses)', async () => {
  renderWithSafeArea(<AjouterScreen />);
  await waitFor(() => screen.getByTestId('ajouter-tile-INCOME'));
  await fireEvent.press(screen.getByTestId('ajouter-tile-INCOME'));
  await waitFor(() => screen.getByTestId('ajouter-destination'));
  expect(screen.queryByTestId('ajouter-include-in-planning-toggle')).toBeNull();
});
