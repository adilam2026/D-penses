import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { BudgetDetailScreen } from '../BudgetDetailScreen';
import * as api from '../../../api/client';

/**
 * Lot 3 — bandeau d'alerte de rythme sur la fiche budget : additif, distinct
 * des figures existantes (rythmeProjete/previsionRythmeRestant restent des
 * indicateurs informatifs, ne définissent pas l'alerte).
 */
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { id: 'b1' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => require('react').createElement(Text, null, props.name) };
});

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { ...actual, getVariableBudget: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

function detailFixture(rythmeAlerte: boolean) {
  return {
    id: 'b1',
    categoryId: 'cat-1',
    category: { name: 'Courses' },
    referenceAmount: 1000,
    referencePeriod: 'semaine' as const,
    weekStartDay: 1,
    status: {
      periodStart: '2026-09-07',
      periodEnd: '2026-09-13',
      budgetPeriode: 1000,
      consommeADate: 670,
      budgetContractuelRestant: 330,
      rythmeProjete: 1500,
      previsionRythmeRestant: -500,
      projectionPrudenteRestante: 330,
      consumptionRatio: 0.67,
      elapsedRatio: 0.43,
      rythmeAlerte,
    },
    history: [],
  };
}

describe('BudgetDetailScreen — alerte de rythme (Lot 3)', () => {
  it('affiche le bandeau avec % consommé/% écoulé quand rythmeAlerte=true', async () => {
    mockedApi.getVariableBudget.mockResolvedValue(detailFixture(true));
    await render(<BudgetDetailScreen />);

    await waitFor(() => screen.getByTestId('budget-rythme-alerte'));
    expect(screen.getByText(/67% consommé pour 43% de la période écoulée/)).toBeTruthy();
    // Les indicateurs de pilotage existants restent affichés tels quels — jamais retirés.
    expect(screen.getByText('Projection au rythme actuel')).toBeTruthy();
  });

  it('aucun bandeau quand rythmeAlerte=false', async () => {
    mockedApi.getVariableBudget.mockResolvedValue(detailFixture(false));
    await render(<BudgetDetailScreen />);

    await waitFor(() => screen.getByText('Courses'));
    expect(screen.queryByTestId('budget-rythme-alerte')).toBeNull();
  });
});
