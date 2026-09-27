import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootTabs } from '../RootTabs';
import { clearCache } from '../../state/cache';

jest.mock('../../api/client', () => ({
  listAccounts: () => Promise.resolve([]),
  listPlannedOperations: () => Promise.resolve([]),
  listMedicalClaims: () => Promise.resolve([]),
  listFinancialPlans: () => Promise.resolve([]),
  listCategories: () => Promise.resolve([]),
  getMyHousehold: () => Promise.resolve({ id: 'h1', name: 'Foyer Demo' }),
}));

const TEST_INSET_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

beforeEach(() => clearCache());

it('affiche exactement les 4 onglets Accueil / Planning / Épargne / Ajouter, sous le shell "Finance Maison"', async () => {
  render(
    <SafeAreaProvider initialMetrics={TEST_INSET_METRICS}>
      <NavigationContainer>
        <RootTabs />
      </NavigationContainer>
    </SafeAreaProvider>,
  );

  // "Accueil" apparaît deux fois (libellé de l'onglet + titre de l'écran) — legitime.
  await waitFor(() => expect(screen.getAllByText('Accueil').length).toBeGreaterThan(0));
  expect(screen.getByText('Planning')).toBeTruthy();
  expect(screen.getByText('Épargne')).toBeTruthy();
  expect(screen.getByText('Ajouter')).toBeTruthy();
  // Shell persistant (Checkpoint 2 §5) : marque visible, menu accessible depuis les 4 onglets.
  expect(screen.getByText('Finance Maison')).toBeTruthy();
  expect(screen.getByTestId('app-shell-menu-button')).toBeTruthy();
  // Aucun autre onglet (pas de "Plus"/"Enveloppes"/bouton central flottant de l'ancienne app).
  expect(screen.queryByText('Plus')).toBeNull();
  expect(screen.queryByText('Enveloppes')).toBeNull();
});
