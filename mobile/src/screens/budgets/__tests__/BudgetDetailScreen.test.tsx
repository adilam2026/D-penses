import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
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
  // Lot 4 — re-déclenche quand la référence de `cb` change (comme le ferait
  // useFocusEffect réel tant que l'écran reste au premier plan), nécessaire ici
  // car la navigation de périodes recharge via setAt() sans changement de focus.
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, [cb]);
  },
}));

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => require('react').createElement(Text, null, props.name) };
});

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { ...actual, getVariableBudget: jest.fn(), getVariableBudgetHistory: jest.fn() };
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
    // Lot 4 — période courante, aucune modification pendant cette période.
    periodNavigation: {
      at: '2026-09-10',
      periodStart: '2026-09-07',
      periodEnd: '2026-09-13',
      isCurrentPeriod: true,
      previousPeriodAt: '2026-08-31',
      nextPeriodAt: null,
    },
    initialValues: null,
    adjustedValues: null,
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

/**
 * Lot 4 — navigation < précédente | période | suivante >, valeur initiale/ajustée,
 * historique repliable. Réutilise la fiche existante (aucun nouvel écran).
 */
function pastPeriodFixture() {
  return {
    id: 'b1',
    categoryId: 'cat-1',
    category: { name: 'Courses' },
    referenceAmount: 1000,
    referencePeriod: 'semaine' as const,
    weekStartDay: 1,
    status: {
      periodStart: '2026-08-31',
      periodEnd: '2026-09-06',
      budgetPeriode: 1000,
      consommeADate: 300,
      budgetContractuelRestant: 700,
      rythmeProjete: 700,
      previsionRythmeRestant: 400,
      projectionPrudenteRestante: 700,
      consumptionRatio: 0.3,
      elapsedRatio: 1,
      rythmeAlerte: false,
    },
    history: [],
    periodNavigation: {
      at: '2026-09-02',
      periodStart: '2026-08-31',
      periodEnd: '2026-09-06',
      isCurrentPeriod: false,
      previousPeriodAt: '2026-08-24',
      nextPeriodAt: '2026-09-07',
    },
    initialValues: { referenceAmount: 1000, referencePeriod: 'semaine' as const },
    adjustedValues: { referenceAmount: 1800, referencePeriod: 'semaine' as const },
  };
}

describe('BudgetDetailScreen — navigation de périodes et historique (Lot 4)', () => {
  it('"suivante" est masquée sur la période courante (jamais de navigation vers le futur)', async () => {
    mockedApi.getVariableBudget.mockResolvedValue(detailFixture(false));
    await render(<BudgetDetailScreen />);

    await waitFor(() => screen.getByTestId('budget-nav-previous'));
    expect(screen.queryByTestId('budget-nav-next')).toBeNull();
  });

  it('taper "précédente" recharge la fiche avec le `at` renvoyé par periodNavigation.previousPeriodAt', async () => {
    mockedApi.getVariableBudget.mockResolvedValue(detailFixture(false));
    await render(<BudgetDetailScreen />);
    await waitFor(() => screen.getByTestId('budget-nav-previous'));

    mockedApi.getVariableBudget.mockClear();
    mockedApi.getVariableBudget.mockResolvedValue(pastPeriodFixture());
    await fireEvent.press(screen.getByTestId('budget-nav-previous'));

    await waitFor(() => expect(mockedApi.getVariableBudget).toHaveBeenCalledWith('b1', '2026-08-31'));
  });

  it('affiche "suivante" et "(en cours)" absent sur une période passée, avec le bandeau initial/ajusté', async () => {
    mockedApi.getVariableBudget.mockResolvedValue(pastPeriodFixture());
    await render(<BudgetDetailScreen />);

    await waitFor(() => screen.getByTestId('budget-nav-next'));
    expect(screen.queryByText(/\(en cours\)/)).toBeNull();
    expect(screen.getByTestId('budget-initial-adjusted')).toBeTruthy();
    expect(screen.getByText(/1 000 DH → ajusté à 1 800 DH/)).toBeTruthy();
  });

  it("aucun bandeau initial/ajusté quand la période n'a pas été modifiée", async () => {
    mockedApi.getVariableBudget.mockResolvedValue(detailFixture(false));
    await render(<BudgetDetailScreen />);

    await waitFor(() => screen.getByText('Courses'));
    expect(screen.queryByTestId('budget-initial-adjusted')).toBeNull();
  });

  it("l'historique des modifications se charge à l'ouverture et affiche champ/ancienne/nouvelle valeur", async () => {
    mockedApi.getVariableBudget.mockResolvedValue(detailFixture(false));
    mockedApi.getVariableBudgetHistory.mockResolvedValue([
      {
        budgetId: 'b1',
        field: 'referenceAmount',
        oldValue: 1000,
        newValue: 2000,
        changedAt: '2026-09-08T10:00:00.000Z',
        effectiveFrom: '2026-09-08T10:00:00.000Z',
      },
    ]);
    await render(<BudgetDetailScreen />);
    await waitFor(() => screen.getByTestId('budget-history-toggle'));

    expect(mockedApi.getVariableBudgetHistory).not.toHaveBeenCalled(); // replié par défaut, chargé à la demande

    await fireEvent.press(screen.getByTestId('budget-history-toggle'));
    await waitFor(() => expect(mockedApi.getVariableBudgetHistory).toHaveBeenCalledWith('b1'));
    await waitFor(() => screen.getByTestId('budget-history-list'));
    expect(screen.getByText('Montant de référence')).toBeTruthy();
    expect(screen.getByText(/1 000 DH → 2 000 DH/)).toBeTruthy();
  });
});
