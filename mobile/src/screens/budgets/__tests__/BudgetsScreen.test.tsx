import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { BudgetsScreen } from '../BudgetsScreen';
import * as api from '../../../api/client';

/**
 * Lot 3 — badge d'alerte de rythme sur la liste des budgets : additif et
 * distinct du badge healthStatus (ratio consommé/plafond seul), jamais fusionné.
 */
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { ...actual, listVariableBudgets: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

function budgetFixture(overrides: Partial<{ id: string; rythmeAlerte: boolean; healthStatus: 'sous_budget' | 'proche_limite' | 'depasse' }>) {
  return {
    id: overrides.id ?? 'b1',
    referenceAmount: 1000,
    referencePeriod: 'semaine' as const,
    category: { name: 'Courses' },
    status: {
      budgetPeriode: 1000,
      consommeADate: 300,
      budgetContractuelRestant: 700,
      rythmeProjete: 500,
      healthStatus: overrides.healthStatus ?? 'sous_budget',
      consumptionRatio: 0.3,
      elapsedRatio: 0.2,
      rythmeAlerte: overrides.rythmeAlerte ?? false,
    },
  };
}

describe('BudgetsScreen — alerte de rythme (Lot 3)', () => {
  it("affiche le badge d'alerte de rythme quand rythmeAlerte=true, avec les pourcentages consommé/écoulé", async () => {
    mockedApi.listVariableBudgets.mockResolvedValue([budgetFixture({ id: 'b1', rythmeAlerte: true })]);
    await render(<BudgetsScreen />);

    await waitFor(() => screen.getByTestId('budget-rythme-alerte-b1'));
    expect(screen.getByText(/30% consommé \/ 20% de période écoulée/)).toBeTruthy();
  });

  it("n'affiche aucun badge de rythme quand rythmeAlerte=false, même si healthStatus est dépassé", async () => {
    mockedApi.listVariableBudgets.mockResolvedValue([budgetFixture({ id: 'b2', rythmeAlerte: false, healthStatus: 'depasse' })]);
    await render(<BudgetsScreen />);

    await waitFor(() => screen.getByText('Dépassé')); // badge healthStatus toujours affiché, indépendamment
    expect(screen.queryByTestId('budget-rythme-alerte-b2')).toBeNull();
  });
});
