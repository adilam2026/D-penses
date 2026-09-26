import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { RootTabs } from '../RootTabs';
import { QuickActionsProvider } from '../../state/QuickActionsContext';
import { QuickActionsSheet } from '../../ui/QuickActionsSheet';
import * as api from '../../api/client';

/**
 * Refonte maquette V6B §19 — navigation basse : Accueil / Planning / [+] /
 * Enveloppes, le bouton central ouvre la bottom sheet — jamais une navigation
 * d'onglet réelle.
 */
jest.mock('../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));
jest.mock('../../ui/useTopInset', () => ({ useTopInset: () => 0 }));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => require('react').createElement(Text, null, props.name) };
});

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return {
    ...actual,
    listAccounts: jest.fn().mockResolvedValue([]),
    listOpenDeadlines: jest.fn().mockResolvedValue([]),
    listProvisions: jest.fn().mockResolvedValue([]),
    listPockets: jest.fn().mockResolvedValue([]),
    listMedicalClaims: jest.fn().mockResolvedValue({ summary: { pendingCount: 0, totalEngaged: 0, totalReimbursed: 0 }, claims: [] }),
    getMonthlyProjection: jest.fn().mockResolvedValue({
      reference_date: '2026-09-01',
      horizon_end: '2027-02-28',
      horizon_months: 6,
      months: [],
      summary: {
        total_income: 0,
        total_expense: 0,
        total_balance: 0,
        deficit_months_count: 0,
        worst_month: null,
        max_monthly_deficit: null,
        opening_cash_balance: 0,
        cash_low_point: null,
        max_financing_need: 0,
        first_positive_cash_balance_month: null,
        treasury_account_ids: [],
        is_complete: true,
        incomplete_months_count: 0,
      },
      account_filters: { incomeAccountIds: null, expenseAccountIds: null },
    }),
  };
});

async function renderApp() {
  await render(
    <NavigationContainer>
      <QuickActionsProvider>
        <RootTabs />
        <QuickActionsSheet />
      </QuickActionsProvider>
    </NavigationContainer>,
  );
}

it('la navigation basse propose 4 positions symétriques : Accueil, Planning, [+], Enveloppes', async () => {
  await renderApp();
  await waitFor(() => screen.getByText("Aucun compte pour l'instant."));
  expect(screen.getByText('Accueil')).toBeTruthy();
  expect(screen.getByText('Planning')).toBeTruthy();
  expect(screen.getByTestId('tab-quick-actions')).toBeTruthy();
  expect(screen.getByText('Enveloppes')).toBeTruthy();
  // Transactions/Calendrier/Projection/Budgets restent atteignables depuis le
  // menu ☰ (menuSections.ts) et leur propre Stack.Screen racine, mais ne sont
  // plus des onglets de la barre basse.
  expect(screen.queryByText('Transactions')).toBeNull();
  expect(screen.queryByText('Calendrier')).toBeNull();
  expect(screen.queryByText('Projection')).toBeNull();
});

it('le bouton central "+" ouvre la bottom sheet, jamais une navigation d\'onglet', async () => {
  await renderApp();
  await waitFor(() => screen.getByTestId('tab-quick-actions'));

  await fireEvent.press(screen.getByTestId('tab-quick-actions'));

  await waitFor(() => expect(screen.getByTestId('quick-actions-sheet')).toBeTruthy());
  expect(screen.getByTestId('quick-action-depense')).toBeTruthy();
});
