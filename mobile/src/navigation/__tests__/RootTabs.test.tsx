import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { RootTabs } from '../RootTabs';
import { QuickActionsProvider } from '../../state/QuickActionsContext';
import { QuickActionsSheet } from '../../ui/QuickActionsSheet';
import * as api from '../../api/client';

/**
 * Navigation basse (Vague 3 §1/§2/§31) : Accueil / Transactions / [+] / Calendrier,
 * le bouton central ouvre la bottom sheet — jamais une navigation d'onglet réelle.
 */
jest.mock('../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => require('react').createElement(Text, null, props.name) };
});

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return {
    ...actual,
    getDashboardSummary: jest.fn().mockResolvedValue({
      seuil_a_payer_days: 7,
      operational_treasury: 0,
      free_available: 0,
      reserved_amount: 0,
      committed_amount: 0,
      safety_buffer: 0,
      patrimoine_liquide_total: 0,
      is_complete: true,
      contains_estimates: false,
      unknown_commitments_count: 0,
      deadlineItems: [],
      optionsEnvisagees: { total: 0, hasUnknown: false },
      actionsATraiter: [],
      budgetsResume: [],
      financialPlansResume: [],
      provisionsResume: [],
      next_30_days: {
        closing_physical_treasury: 0,
        closing_free_capacity: 0,
        physical_low_point: 0,
        physical_low_point_date: '2026-09-20',
        free_capacity_low_point: 0,
        free_capacity_low_point_date: '2026-09-20',
        first_negative_date: null,
        deficit_at_first_negative: null,
        status: 'OK',
        is_complete: true,
      },
    }),
    listAccounts: jest.fn().mockResolvedValue([]),
    listTransactions: jest.fn().mockResolvedValue([]),
    getCalendar: jest.fn().mockResolvedValue({ events: [] }),
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

it('la navigation basse propose 5 positions symétriques : Accueil, Transactions, [+], Calendrier, Enveloppes', async () => {
  await renderApp();
  await waitFor(() => screen.getByText('Bienvenue dans D-Penses+'));
  expect(screen.getByText('Accueil')).toBeTruthy();
  expect(screen.getByText('Transactions')).toBeTruthy();
  expect(screen.getByText('Calendrier')).toBeTruthy();
  expect(screen.getByTestId('tab-quick-actions')).toBeTruthy();
  // Correctif post-Vague 3 (§13) — Enveloppes rejoint la barre basse (accès permanent) :
  // avec 5 positions, le bouton central [+] occupe mathématiquement le 3e emplacement,
  // donc le centre exact de la barre (contrairement à 4 positions, jamais centré).
  expect(screen.getByText('Enveloppes')).toBeTruthy();
  expect(screen.queryByText('Plus')).toBeNull();
});

it('le bouton central "+" ouvre la bottom sheet, jamais une navigation d\'onglet', async () => {
  await renderApp();
  await waitFor(() => screen.getByTestId('tab-quick-actions'));

  await fireEvent.press(screen.getByTestId('tab-quick-actions'));

  await waitFor(() => expect(screen.getByTestId('quick-actions-sheet')).toBeTruthy());
  expect(screen.getByTestId('quick-action-depense')).toBeTruthy();
});
