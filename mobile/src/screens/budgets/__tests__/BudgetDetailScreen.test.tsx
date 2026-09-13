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
  return { ...actual, getVariableBudget: jest.fn(), getVariableBudgetHistory: jest.fn(), updateVariableBudget: jest.fn() };
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
    includeInPrudentProjection: true,
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

/**
 * Lot 6 — édition du mode du mois (CALENDAR/FINANCIAL/CUSTOM) depuis la fiche
 * budget (menu "..." → Modifier), symétrique de CreateBudgetScreen : le
 * sélecteur n'apparaît que pour referencePeriod='mois', le jour personnalisé
 * uniquement pour monthMode='personnalise', et tout changement de mode
 * incompatible avec customStartDay le remet immédiatement à vide (jamais de
 * valeur fantôme envoyée au PATCH).
 */
function monthlyFixture(monthMode: api.MonthMode, customStartDay: number | null, includeInPrudentProjection = true) {
  return {
    id: 'b1',
    categoryId: 'cat-1',
    category: { name: 'Courses' },
    referenceAmount: 1000,
    referencePeriod: 'mois' as const,
    weekStartDay: 1,
    monthMode,
    customStartDay,
    includeInPrudentProjection,
    status: {
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      budgetPeriode: 1000,
      consommeADate: 300,
      budgetContractuelRestant: 700,
      rythmeProjete: 700,
      previsionRythmeRestant: 400,
      projectionPrudenteRestante: 700,
      consumptionRatio: 0.3,
      elapsedRatio: 0.4,
      rythmeAlerte: false,
    },
    history: [],
    periodNavigation: {
      at: '2026-09-10',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      isCurrentPeriod: true,
      previousPeriodAt: '2026-08-31',
      nextPeriodAt: null,
    },
    initialValues: null,
    adjustedValues: null,
  };
}

// Barrière de synchronisation générique (même constat empirique que
// CreateBudgetScreen.test.tsx) : force le tick nécessaire entre deux
// interactions rapprochées dans la modale d'édition.
async function flush() {
  await waitFor(() => screen.getByTestId('budget-edit-save'));
}

async function openEditModal() {
  await waitFor(() => screen.getByTestId('budget-menu-button'));
  await fireEvent.press(screen.getByTestId('budget-menu-button'));
  await waitFor(() => screen.getByTestId('budget-menu-option-modifier'));
  await fireEvent.press(screen.getByTestId('budget-menu-option-modifier'));
  await waitFor(() => screen.getByTestId('budget-edit-form'));
}

describe('BudgetDetailScreen — édition du mode du mois (Lot 6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.updateVariableBudget.mockResolvedValue({ id: 'b1' } as any);
  });

  it('affiche le sélecteur de mode pour un budget mensuel', async () => {
    mockedApi.getVariableBudget.mockResolvedValue(monthlyFixture('calendaire', null));
    await render(<BudgetDetailScreen />);
    await openEditModal();

    expect(screen.getByText('Mode du mois')).toBeTruthy();
    expect(screen.getByTestId('budget-edit-month-mode-calendaire')).toBeTruthy();
    expect(screen.getByTestId('budget-edit-month-mode-financier')).toBeTruthy();
    expect(screen.getByTestId('budget-edit-month-mode-personnalise')).toBeTruthy();
  });

  it('aucun sélecteur de mode pour un budget hebdomadaire', async () => {
    mockedApi.getVariableBudget.mockResolvedValue(detailFixture(false)); // referencePeriod='semaine'
    await render(<BudgetDetailScreen />);
    await openEditModal();

    expect(screen.queryByText('Mode du mois')).toBeNull();
    expect(screen.queryByTestId('budget-edit-month-mode-calendaire')).toBeNull();
  });

  it('édition calendaire → personnalise + jour : PATCH avec monthMode/customStartDay cohérents', async () => {
    mockedApi.getVariableBudget.mockResolvedValue(monthlyFixture('calendaire', null));
    await render(<BudgetDetailScreen />);
    await openEditModal();

    await fireEvent.press(screen.getByTestId('budget-edit-month-mode-personnalise'));
    await flush();
    expect(screen.getByTestId('budget-edit-custom-start-day-input')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('budget-edit-custom-start-day-input'), '25');
    await flush();

    await fireEvent.press(screen.getByTestId('budget-edit-save'));
    await waitFor(() =>
      expect(mockedApi.updateVariableBudget).toHaveBeenCalledWith('b1', {
        referenceAmount: 1000,
        referencePeriod: 'mois',
        monthMode: 'personnalise',
        customStartDay: 25,
        includeInPrudentProjection: true,
      }),
    );
  });

  it('édition personnalise → financier : customStartDay remis à null (omis du PATCH), champ masqué', async () => {
    mockedApi.getVariableBudget.mockResolvedValue(monthlyFixture('personnalise', 25));
    await render(<BudgetDetailScreen />);
    await openEditModal();

    // Confirme que le formulaire démarre bien avec la valeur en base avant le changement de mode.
    expect(screen.getByTestId('budget-edit-custom-start-day-input').props.value).toBe('25');

    await fireEvent.press(screen.getByTestId('budget-edit-month-mode-financier'));
    await flush();
    expect(screen.queryByTestId('budget-edit-custom-start-day-input')).toBeNull();

    await fireEvent.press(screen.getByTestId('budget-edit-save'));
    await waitFor(() =>
      expect(mockedApi.updateVariableBudget).toHaveBeenCalledWith('b1', {
        referenceAmount: 1000,
        referencePeriod: 'mois',
        monthMode: 'financier',
        customStartDay: undefined,
        includeInPrudentProjection: true,
      }),
    );
  });

  it('validation du jour personnalisé : 99 est refusé (hors 1..31), aucun appel API', async () => {
    mockedApi.getVariableBudget.mockResolvedValue(monthlyFixture('calendaire', null));
    await render(<BudgetDetailScreen />);
    await openEditModal();

    await fireEvent.press(screen.getByTestId('budget-edit-month-mode-personnalise'));
    await flush();
    fireEvent.changeText(screen.getByTestId('budget-edit-custom-start-day-input'), '99');
    await flush();

    await fireEvent.press(screen.getByTestId('budget-edit-save'));
    await waitFor(() => screen.getByText('Le jour de départ doit être un nombre entier entre 1 et 31'));
    expect(mockedApi.updateVariableBudget).not.toHaveBeenCalled();
  });

  it('payload PATCH exact pour une édition combinée (montant + mode + jour)', async () => {
    mockedApi.getVariableBudget.mockResolvedValue(monthlyFixture('financier', null));
    await render(<BudgetDetailScreen />);
    await openEditModal();

    fireEvent.changeText(screen.getByTestId('budget-edit-amount'), '1500');
    await flush();
    await fireEvent.press(screen.getByTestId('budget-edit-month-mode-personnalise'));
    await flush();
    fireEvent.changeText(screen.getByTestId('budget-edit-custom-start-day-input'), '10');
    await flush();

    await fireEvent.press(screen.getByTestId('budget-edit-save'));
    await waitFor(() => expect(mockedApi.updateVariableBudget).toHaveBeenCalledTimes(1));
    expect(mockedApi.updateVariableBudget).toHaveBeenCalledWith('b1', {
      referenceAmount: 1500,
      referencePeriod: 'mois',
      monthMode: 'personnalise',
      customStartDay: 10,
      includeInPrudentProjection: true,
    });
  });

  it("passage vers 'semaine' : mode remis à calendaire, customStartDay omis (jamais de configuration mensuelle incohérente)", async () => {
    mockedApi.getVariableBudget.mockResolvedValue(monthlyFixture('personnalise', 25));
    await render(<BudgetDetailScreen />);
    await openEditModal();

    await fireEvent.press(screen.getByTestId('budget-edit-period'));
    await flush();
    await fireEvent.press(await screen.findByTestId('budget-edit-period-option-semaine'));
    await flush();
    expect(screen.queryByText('Mode du mois')).toBeNull();

    await fireEvent.press(screen.getByTestId('budget-edit-save'));
    await waitFor(() =>
      expect(mockedApi.updateVariableBudget).toHaveBeenCalledWith('b1', {
        referenceAmount: 1000,
        referencePeriod: 'semaine',
        monthMode: 'calendaire',
        customStartDay: undefined,
        includeInPrudentProjection: true,
      }),
    );
  });
});

/**
 * Mini-lot includeInPrudentProjection — édition depuis BudgetDetailScreen :
 * état initial fidèle à `detail.includeInPrudentProjection`, bascule dans les
 * deux sens, valeur toujours renvoyée explicitement au PATCH (y compris quand
 * le switch n'est pas touché — même convention que referencePeriod/monthMode).
 */
describe('BudgetDetailScreen — includeInPrudentProjection (mini-lot)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.updateVariableBudget.mockResolvedValue({ id: 'b1' } as any);
  });

  it('état initial fidèle au backend : true', async () => {
    mockedApi.getVariableBudget.mockResolvedValue(monthlyFixture('calendaire', null, true));
    await render(<BudgetDetailScreen />);
    await openEditModal();

    expect(screen.getByTestId('budget-edit-include-prudent-switch').props.value).toBe(true);
  });

  it('état initial fidèle au backend : false', async () => {
    mockedApi.getVariableBudget.mockResolvedValue(monthlyFixture('calendaire', null, false));
    await render(<BudgetDetailScreen />);
    await openEditModal();

    expect(screen.getByTestId('budget-edit-include-prudent-switch').props.value).toBe(false);
  });

  it('bascule true→false : PATCH avec includeInPrudentProjection=false', async () => {
    mockedApi.getVariableBudget.mockResolvedValue(monthlyFixture('calendaire', null, true));
    await render(<BudgetDetailScreen />);
    await openEditModal();

    await fireEvent(screen.getByTestId('budget-edit-include-prudent-switch'), 'valueChange', false);
    await flush();
    await fireEvent.press(screen.getByTestId('budget-edit-save'));
    await waitFor(() =>
      expect(mockedApi.updateVariableBudget).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({ includeInPrudentProjection: false }),
      ),
    );
  });

  it('bascule false→true : PATCH avec includeInPrudentProjection=true', async () => {
    mockedApi.getVariableBudget.mockResolvedValue(monthlyFixture('calendaire', null, false));
    await render(<BudgetDetailScreen />);
    await openEditModal();

    await fireEvent(screen.getByTestId('budget-edit-include-prudent-switch'), 'valueChange', true);
    await flush();
    await fireEvent.press(screen.getByTestId('budget-edit-save'));
    await waitFor(() =>
      expect(mockedApi.updateVariableBudget).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({ includeInPrudentProjection: true }),
      ),
    );
  });

  it('switch non touché : la valeur actuelle (false) est conservée et renvoyée explicitement', async () => {
    mockedApi.getVariableBudget.mockResolvedValue(monthlyFixture('calendaire', null, false));
    await render(<BudgetDetailScreen />);
    await openEditModal();

    fireEvent.changeText(screen.getByTestId('budget-edit-amount'), '1200');
    await flush();
    await fireEvent.press(screen.getByTestId('budget-edit-save'));
    await waitFor(() =>
      expect(mockedApi.updateVariableBudget).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({ referenceAmount: 1200, includeInPrudentProjection: false }),
      ),
    );
  });
});
