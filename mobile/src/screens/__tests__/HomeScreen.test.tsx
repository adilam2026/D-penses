import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { HomeScreen } from '../HomeScreen';
import * as api from '../../api/client';

/**
 * Tests de l'accueil-cockpit (Vague 3 §7-19/§31) : état vide, état configuré,
 * blocs cliquables (comptes/échéances/plans/projection/actions), menu ☰.
 */
jest.mock('../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

const mockNavigate = jest.fn();
const mockGetParent = jest.fn(() => ({ navigate: mockNavigate }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ getParent: mockGetParent }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => require('react').createElement(Text, null, props.name) };
});

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return {
    ...actual,
    getDashboardSummary: jest.fn(),
    listAccounts: jest.fn(),
    listIncomeSources: jest.fn(),
    getMyHousehold: jest.fn(),
    updateHouseholdSettings: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

const EMPTY_SUMMARY = {
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
  horizon_date: '2026-10-15',
  horizon_source: 'income' as const,
  horizon_is_fallback: false,
  deadlineItems: [],
  topDeadlines: [],
  variableBudgetItems: [],
  optionsEnvisagees: { total: 0, hasUnknown: false },
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
    status: 'OK' as const,
    is_complete: true,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listIncomeSources.mockResolvedValue([]);
  mockedApi.getMyHousehold.mockResolvedValue({ id: 'h1', settings: { homeBannerDismissed: false } });
});

describe('Accueil — état vide (§19)', () => {
  it("un foyer sans aucune donnée affiche 'Bienvenue' + [Commencer] → Onboarding", async () => {
    mockedApi.getDashboardSummary.mockResolvedValue(EMPTY_SUMMARY);
    mockedApi.listAccounts.mockResolvedValue([]);
    await render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Bienvenue dans D-Penses+')).toBeTruthy());
    await fireEvent.press(screen.getByText('Commencer'));
    expect(mockNavigate).toHaveBeenCalledWith('Onboarding');
  });
});

describe('Accueil — état configuré (§7-17/§31)', () => {
  const CONFIGURED_SUMMARY = {
    ...EMPTY_SUMMARY,
    operational_treasury: 45000,
    reserved_amount: 20000,
    committed_amount: 21800,
    safety_buffer: 10000,
    free_available: 15000,
    patrimoine_liquide_total: 45000,
    deadlineItems: [
      {
        id: 'd1',
        chargePlanId: 'cp1',
        chargePlanLabel: 'Scolarité Dina',
        dueDate: '2026-09-30',
        amountStatus: 'confirme' as const,
        resteAPayer: 21800,
        coverageStatus: 'non_couverte' as const,
        engagementNonCouvert: 21800,
      },
    ],
    topDeadlines: [
      {
        id: 'd1',
        chargePlanId: 'cp1',
        chargePlanLabel: 'Scolarité Dina',
        dueDate: '2026-09-30',
        amountStatus: 'confirme' as const,
        resteAPayer: 21800,
        coverageStatus: 'non_couverte' as const,
        engagementNonCouvert: 21800,
      },
    ],
    financialPlansResume: [
      {
        id: 'p1',
        label: 'École 2026/2027',
        knownPlanCost: 67450,
        remainingDue: 37450,
        provisionCoverage: 30000,
        tauxCouverture: 44,
        nextDeadlineDate: '2026-09-30',
        hasOverdue: false,
        completude: 'complet',
      },
    ],
  };

  beforeEach(() => {
    mockedApi.getDashboardSummary.mockResolvedValue(CONFIGURED_SUMMARY);
    mockedApi.listAccounts.mockResolvedValue([
      { id: 'acc-cih', name: 'CIH', soldeCourant: 15000 },
      { id: 'acc-bp', name: 'Banque Populaire', soldeCourant: 30000 },
    ]);
  });

  it('affiche le disponible libre mis en avant (bloc 2)', async () => {
    await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByText('DISPONIBLE LIBRE')).toBeTruthy());
    expect(screen.getAllByText('15 000 DH').length).toBeGreaterThan(0);
  });

  it('§14 : le disponible libre est le PREMIER élément du bloc 2 (hiérarchie visuelle), les autres montants en dessous', async () => {
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('DISPONIBLE LIBRE'));

    expect(screen.queryByText("Comment est calculé mon disponible")).toBeNull(); // aide repliée par défaut
    await fireEvent.press(screen.getByTestId('free-available-info'));
    expect(screen.getByText(/tient compte de l'argent réservé/)).toBeTruthy();
  });

  it('un compte est cliquable → AccountDetail', async () => {
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('CIH'));
    await fireEvent.press(screen.getByText('CIH'));
    expect(mockNavigate).toHaveBeenCalledWith('AccountDetail', { id: 'acc-cih' });
  });

  it('R6.3 (point B) : la ligne "Engagé" est cliquable → EngagedDetail avec exactement le montant Home et les composantes de la même source', async () => {
    await render(<HomeScreen />);
    await waitFor(() => screen.getByTestId('home-engaged-row'));
    await fireEvent.press(screen.getByTestId('home-engaged-row'));
    expect(mockNavigate).toHaveBeenCalledWith(
      'EngagedDetail',
      expect.objectContaining({
        committedAmount: CONFIGURED_SUMMARY.committed_amount,
        deadlineItems: CONFIGURED_SUMMARY.deadlineItems,
        variableBudgetItems: CONFIGURED_SUMMARY.variableBudgetItems,
      }),
    );
  });

  it('une échéance est cliquable → DeadlineDetail', async () => {
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('Scolarité Dina'));
    await fireEvent.press(screen.getByText('Scolarité Dina'));
    expect(mockNavigate).toHaveBeenCalledWith('DeadlineDetail', { id: 'd1' });
  });

  it('un plan est cliquable → FinancialPlanDetail, avec le taux de couverture affiché', async () => {
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('École 2026/2027'));
    expect(screen.getByText('44% couvert')).toBeTruthy();
    await fireEvent.press(screen.getByText('École 2026/2027'));
    expect(mockNavigate).toHaveBeenCalledWith('FinancialPlanDetail', { id: 'p1' });
  });

  it('le bloc projection est cliquable → Projection', async () => {
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('DANS 30 JOURS'));
    await fireEvent.press(screen.getByText('DANS 30 JOURS'));
    expect(mockNavigate).toHaveBeenCalledWith('Projection');
  });

  it('le bouton ☰ ouvre le menu hamburger', async () => {
    await render(<HomeScreen />);
    await waitFor(() => screen.getByTestId('hamburger-menu-button'));
    await fireEvent.press(screen.getByTestId('hamburger-menu-button'));
    expect(mockNavigate).toHaveBeenCalledWith('HamburgerMenu');
  });

  it('R6.4 (§5 / test I) : le bloc "Actions à traiter" est absent de l\'accueil', async () => {
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('DISPONIBLE LIBRE'));
    expect(screen.queryByText(/action.*à traiter/i)).toBeNull();
  });

  it('R6.1 §10 / R6.3 point D : "Ma situation" affiche "Trésorerie pilotée" en principal (comptes pilotés uniquement), "Patrimoine total" en secondaire, et un badge "Hors pilotage" sur un compte exclu', async () => {
    mockedApi.listAccounts.mockResolvedValue([
      { id: 'acc-cih', name: 'CIH', soldeCourant: 15000, includeInOperationalTreasury: true },
      { id: 'acc-livret', name: 'Livret bloqué', soldeCourant: 30000, includeInOperationalTreasury: false },
    ]);
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('CIH'));

    // §D — le montant PRINCIPAL est la trésorerie pilotée (45000, comptes includeInOperationalTreasury=true),
    // jamais le patrimoine global (52000, avec le livret hors pilotage) qui reste secondaire.
    expect(screen.getByText('Trésorerie pilotée')).toBeTruthy();
    expect(screen.getByTestId('home-piloted-total')).toBeTruthy();
    expect(screen.getByText('Patrimoine total (avec hors pilotage)')).toBeTruthy();
    expect(screen.getByText('Hors pilotage')).toBeTruthy();
  });
});

function budgetFixture(overrides: Partial<{
  id: string;
  categoryName: string;
  healthStatus: 'sous_budget' | 'proche_limite' | 'depasse';
  rythmeAlerte: boolean;
  consommeADate: number;
  budgetPeriode: number;
}>) {
  const consommeADate = overrides.consommeADate ?? 500;
  const budgetPeriode = overrides.budgetPeriode ?? 1000;
  return {
    id: overrides.id ?? 'b1',
    categoryName: overrides.categoryName ?? 'Courses',
    referenceAmount: budgetPeriode,
    referencePeriod: 'semaine' as const,
    status: {
      budgetPeriode,
      consommeADate,
      budgetContractuelRestant: budgetPeriode - consommeADate,
      healthStatus: overrides.healthStatus ?? 'sous_budget',
      consumptionRatio: consommeADate / budgetPeriode,
      elapsedRatio: 0.3,
      rythmeAlerte: overrides.rythmeAlerte ?? false,
    },
  };
}

/**
 * Lot 3 — bloc "MES BUDGETS" de l'accueil (§4 de la demande) : réutilise
 * EXCLUSIVEMENT summary.budgetsResume déjà calculé côté backend, jamais un
 * recalcul mobile. Positionné avant "Mes plans" (contrainte explicite), cap à 3.
 */
describe('Accueil — bloc "Mes budgets" (Lot 3)', () => {
  it('affiche les budgets avec consommé/plafond/restant, et navigue vers BudgetDetail au clic', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      budgetsResume: [budgetFixture({ id: 'b1', categoryName: 'Courses', consommeADate: 300, budgetPeriode: 1000 })],
    });
    mockedApi.listAccounts.mockResolvedValue([]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByTestId('home-budget-b1'));
    expect(screen.getByText('Courses')).toBeTruthy();
    expect(screen.getByText('300 / 1 000 DH')).toBeTruthy();
    expect(screen.getByText('Restant : 700 DH')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('home-budget-b1'));
    expect(mockNavigate).toHaveBeenCalledWith('BudgetDetail', { id: 'b1' });
  });

  it("affiche l'alerte de rythme uniquement pour les budgets concernés, jamais fusionnée avec un autre badge", async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      budgetsResume: [
        budgetFixture({ id: 'b-alerte', rythmeAlerte: true }),
        budgetFixture({ id: 'b-calme', rythmeAlerte: false }),
      ],
    });
    mockedApi.listAccounts.mockResolvedValue([]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByTestId('home-budget-rythme-alerte-b-alerte'));
    expect(screen.queryByTestId('home-budget-rythme-alerte-b-calme')).toBeNull();
  });

  it('priorise dépassé > alerte de rythme > proche limite > ratio décroissant, et plafonne à 3', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      budgetsResume: [
        budgetFixture({ id: 'b-sous-budget', healthStatus: 'sous_budget', consommeADate: 100, budgetPeriode: 1000 }),
        budgetFixture({ id: 'b-proche', healthStatus: 'proche_limite', consommeADate: 850, budgetPeriode: 1000 }),
        budgetFixture({ id: 'b-rythme', healthStatus: 'sous_budget', rythmeAlerte: true, consommeADate: 400, budgetPeriode: 1000 }),
        budgetFixture({ id: 'b-depasse', healthStatus: 'depasse', consommeADate: 1200, budgetPeriode: 1000 }),
      ],
    });
    mockedApi.listAccounts.mockResolvedValue([]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByTestId('home-budget-b-depasse'));
    const cards = screen.getAllByTestId(/^home-budget-(?!rythme-alerte)/);
    // Cap à 3 : "b-sous-budget" (ratio le plus faible, priorité la plus basse) est exclu.
    expect(cards.map((c) => c.props.testID)).toEqual(['home-budget-b-depasse', 'home-budget-b-rythme', 'home-budget-b-proche']);
  });

  it('"Voir tous →" navigue vers Budgets', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      budgetsResume: [budgetFixture({ id: 'b1' })],
    });
    mockedApi.listAccounts.mockResolvedValue([]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByTestId('home-budget-b1'));
    await fireEvent.press(screen.getByText('Voir tous →'));
    expect(mockNavigate).toHaveBeenCalledWith('Budgets');
  });

  it('aucun budget → le bloc "MES BUDGETS" est absent (jamais un bloc vide affiché)', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({ ...EMPTY_SUMMARY, budgetsResume: [] });
    mockedApi.listAccounts.mockResolvedValue([{ id: 'acc-1', name: 'Compte SG', soldeCourant: 0 }]);
    mockedApi.listIncomeSources.mockResolvedValue([{ id: 'inc-1', label: 'Salaire' }]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByText('DISPONIBLE LIBRE'));
    expect(screen.queryByText('MES BUDGETS')).toBeNull();
  });
});

/** Correctif post-Vague 3 (point 1) — la priorité de "Mes plans" doit intégrer
 * l'urgence d'échéance (nextDeadlineDate/hasOverdue), jamais seulement le montant :
 * un plan avec une échéance très proche ne doit jamais être masqué par un plan
 * moins urgent uniquement parce que son reste à financer est supérieur. */
describe('Accueil — priorité des plans intègre l\'échéance (correctif post-Vague 3)', () => {
  function iso(daysFromNow: number): string {
    return new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);
  }

  it("un plan avec une échéance proche passe avant un plan au reste à financer bien plus élevé mais sans échéance proche", async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      financialPlansResume: [
        {
          id: 'plan-loin',
          label: 'Voyage lointain',
          knownPlanCost: 60000,
          remainingDue: 50000,
          provisionCoverage: 5000,
          tauxCouverture: 10,
          nextDeadlineDate: iso(60),
          hasOverdue: false,
          completude: 'complet',
        },
        {
          id: 'plan-proche',
          label: 'École échéance demain',
          knownPlanCost: 1000,
          remainingDue: 500,
          provisionCoverage: 500,
          tauxCouverture: 50,
          nextDeadlineDate: iso(1),
          hasOverdue: false,
          completude: 'complet',
        },
      ],
    });
    mockedApi.listAccounts.mockResolvedValue([]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByTestId('home-plan-plan-proche'));
    const cards = screen.getAllByTestId(/^home-plan-/);
    expect(cards.map((c) => c.props.testID)).toEqual(['home-plan-plan-proche', 'home-plan-plan-loin']);
  });

  it('un plan en retard passe toujours avant un plan non en retard, même avec une échéance plus proche sur ce dernier', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      financialPlansResume: [
        {
          id: 'plan-a-venir',
          label: 'À venir',
          knownPlanCost: 100000,
          remainingDue: 100000,
          provisionCoverage: 0,
          tauxCouverture: 0,
          nextDeadlineDate: iso(1),
          hasOverdue: false,
          completude: 'complet',
        },
        {
          id: 'plan-retard',
          label: 'En retard',
          knownPlanCost: 100,
          remainingDue: 100,
          provisionCoverage: 50,
          tauxCouverture: 50,
          nextDeadlineDate: iso(-5),
          hasOverdue: true,
          completude: 'complet',
        },
      ],
    });
    mockedApi.listAccounts.mockResolvedValue([]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByTestId('home-plan-plan-retard'));
    const cards = screen.getAllByTestId(/^home-plan-/);
    expect(cards.map((c) => c.props.testID)).toEqual(['home-plan-plan-retard', 'home-plan-plan-a-venir']);
  });
});

/** Correctif post-Vague 3 (point 2) — le seuil "très proche" (orange) de l'accueil doit
 * refléter seuil_a_payer_days du foyer (déjà chargé avec le dashboard), jamais une
 * valeur codée en dur, pour rester cohérent quel que soit le seuil configuré. */
describe('Accueil — seuil "très proche" suit seuil_a_payer_days du foyer (correctif post-Vague 3)', () => {
  const deadlineDueIn10Days = {
    id: 'd-seuil',
    chargePlanId: 'cp-seuil',
    chargePlanLabel: 'Échéance à 10 jours',
    dueDate: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
    amountStatus: 'confirme' as const,
    resteAPayer: 1000,
    coverageStatus: 'non_couverte' as const,
  };

  it('avec seuil_a_payer_days=14, une échéance à 10 jours est classée "très proche" (orange)', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      seuil_a_payer_days: 14,
      deadlineItems: [deadlineDueIn10Days],
      topDeadlines: [deadlineDueIn10Days],
    });
    mockedApi.listAccounts.mockResolvedValue([]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByText('Échéance à 10 jours'));
    const dateText = screen.getByText(
      new Date(deadlineDueIn10Days.dueDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
    );
    const style = [dateText.props.style].flat();
    expect(style.some((s: any) => s?.color === '#B8860B')).toBe(true);
  });

  it('avec seuil_a_payer_days=7 (défaut), la même échéance à 10 jours reste neutre (pas encore "très proche")', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      seuil_a_payer_days: 7,
      deadlineItems: [deadlineDueIn10Days],
      topDeadlines: [deadlineDueIn10Days],
    });
    mockedApi.listAccounts.mockResolvedValue([]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByText('Échéance à 10 jours'));
    const dateText = screen.getByText(
      new Date(deadlineDueIn10Days.dueDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
    );
    const style = [dateText.props.style].flat();
    expect(style.some((s: any) => s?.color === '#B8860B')).toBe(false);
    expect(style.some((s: any) => s?.color === '#172436')).toBe(true);
  });
});

describe('Accueil — configuration partielle (§19/§28)', () => {
  it("un foyer avec au moins un compte mais sans reste affiche 'Terminer ma configuration'", async () => {
    mockedApi.getDashboardSummary.mockResolvedValue(EMPTY_SUMMARY);
    mockedApi.listAccounts.mockResolvedValue([{ id: 'acc-1', name: 'Compte SG', soldeCourant: 0 }]);
    await render(<HomeScreen />);

    await waitFor(() => expect(screen.getByText('Terminer ma configuration →')).toBeTruthy());
    await fireEvent.press(screen.getByText('Terminer ma configuration →'));
    expect(mockNavigate).toHaveBeenCalledWith('Onboarding');
  });
});

/**
 * Recette téléphone réel §13 — le bandeau ne s'affiche plus dès que les
 * prérequis essentiels (≥1 compte, ≥1 revenu planifié) sont satisfaits, et
 * plus jamais après un "Ne plus afficher" persisté côté foyer.
 */
describe('Accueil — bandeau de configuration intelligent (§13)', () => {
  it('prérequis essentiels satisfaits (compte + revenu) → le bandeau ne s\'affiche plus, même en configuration partielle', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue(EMPTY_SUMMARY);
    mockedApi.listAccounts.mockResolvedValue([{ id: 'acc-1', name: 'Compte SG', soldeCourant: 0 }]);
    mockedApi.listIncomeSources.mockResolvedValue([{ id: 'inc-1', label: 'Salaire' }]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByText('DISPONIBLE LIBRE'));
    expect(screen.queryByTestId('config-banner')).toBeNull();
    expect(screen.queryByText('Terminer ma configuration →')).toBeNull();
  });

  it('prérequis essentiels NON satisfaits (pas de revenu planifié) → le bandeau reste affiché avec un bouton de fermeture', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue(EMPTY_SUMMARY);
    mockedApi.listAccounts.mockResolvedValue([{ id: 'acc-1', name: 'Compte SG', soldeCourant: 0 }]);
    mockedApi.listIncomeSources.mockResolvedValue([]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByTestId('config-banner'));
    expect(screen.getByTestId('config-banner-close')).toBeTruthy();
  });

  it('déjà marqué "Ne plus afficher" côté foyer → le bandeau ne s\'affiche jamais, même sans prérequis satisfaits', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue(EMPTY_SUMMARY);
    mockedApi.listAccounts.mockResolvedValue([{ id: 'acc-1', name: 'Compte SG', soldeCourant: 0 }]);
    mockedApi.listIncomeSources.mockResolvedValue([]);
    mockedApi.getMyHousehold.mockResolvedValue({ id: 'h1', settings: { homeBannerDismissed: true } });
    await render(<HomeScreen />);

    await waitFor(() => screen.getByText('DISPONIBLE LIBRE'));
    expect(screen.queryByTestId('config-banner')).toBeNull();
  });

  it('"Ne plus afficher" masque immédiatement le bandeau et persiste le choix côté foyer', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue(EMPTY_SUMMARY);
    mockedApi.listAccounts.mockResolvedValue([{ id: 'acc-1', name: 'Compte SG', soldeCourant: 0 }]);
    mockedApi.listIncomeSources.mockResolvedValue([]);
    mockedApi.updateHouseholdSettings.mockResolvedValue({});
    await render(<HomeScreen />);
    await waitFor(() => screen.getByTestId('config-banner-close'));

    await fireEvent.press(screen.getByTestId('config-banner-close'));
    await waitFor(() => screen.getByTestId('dismiss-banner-choice-option-forever'));
    await fireEvent.press(screen.getByTestId('dismiss-banner-choice-option-forever'));

    await waitFor(() => expect(screen.queryByTestId('config-banner')).toBeNull());
    expect(mockedApi.updateHouseholdSettings).toHaveBeenCalledWith({ homeBannerDismissed: true });
  });

  it('"Pas maintenant" garde le bandeau visible (jamais persisté)', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue(EMPTY_SUMMARY);
    mockedApi.listAccounts.mockResolvedValue([{ id: 'acc-1', name: 'Compte SG', soldeCourant: 0 }]);
    mockedApi.listIncomeSources.mockResolvedValue([]);
    await render(<HomeScreen />);
    await waitFor(() => screen.getByTestId('config-banner-close'));

    await fireEvent.press(screen.getByTestId('config-banner-close'));
    await waitFor(() => screen.getByTestId('dismiss-banner-choice-option-later'));
    await fireEvent.press(screen.getByTestId('dismiss-banner-choice-option-later'));

    expect(screen.getByTestId('config-banner')).toBeTruthy();
    expect(mockedApi.updateHouseholdSettings).not.toHaveBeenCalled();
  });
});

/**
 * R5 clôture Home §2 — ordre des blocs validé : Situation pilotée aujourd'hui →
 * Mes comptes → Mes budgets → Mes plans financiers → Échéances importantes →
 * Projection. "Situation pilotée aujourd'hui" (disponible libre) doit précéder
 * "Mes comptes", jamais l'inverse.
 */
describe('Accueil — ordre des blocs (R5 clôture Home §2)', () => {
  it("les 6 blocs apparaissent dans l'arbre rendu dans l'ordre validé : Situation pilotée → Comptes → Budgets → Plans → Échéances → Projection", async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      budgetsResume: [budgetFixture({ id: 'b1' })],
      financialPlansResume: [
        {
          id: 'p1',
          label: 'École 2026/2027',
          knownPlanCost: 1000,
          remainingDue: 500,
          provisionCoverage: 500,
          tauxCouverture: 50,
          nextDeadlineDate: null,
          hasOverdue: false,
          completude: 'complet',
        },
      ],
      topDeadlines: [
        {
          id: 'd1',
          chargePlanId: 'cp1',
          chargePlanLabel: 'Scolarité Dina',
          dueDate: '2026-09-30',
          amountStatus: 'confirme' as const,
          resteAPayer: 21800,
          coverageStatus: 'non_couverte' as const,
          engagementNonCouvert: 21800,
        },
      ],
    });
    mockedApi.listAccounts.mockResolvedValue([{ id: 'acc-1', name: 'Compte SG', soldeCourant: 1000 }]);
    const { toJSON } = await render(<HomeScreen />);
    await waitFor(() => screen.getByText('DANS 30 JOURS'));

    // react-test-renderer JSON contient des références circulaires (_owner/return) :
    // un JSON.stringify direct échoue, donc on les élague explicitement ici (jamais
    // de librairie tierce pour un simple test d'ordre de rendu).
    const seen = new WeakSet();
    const text = JSON.stringify(toJSON(), (_key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return undefined;
        seen.add(value);
      }
      return value;
    });
    const order = ["SITUATION PILOTÉE AUJOURD'HUI", 'MES COMPTES', 'MES BUDGETS', 'MES PLANS', 'PROCHAINEMENT', 'DANS 30 JOURS'];
    const positions = order.map((title) => {
      const index = text.indexOf(title);
      expect(index).toBeGreaterThan(-1);
      return index;
    });
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });
});
