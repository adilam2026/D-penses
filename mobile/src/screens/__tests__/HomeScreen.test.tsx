import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { HomeScreen } from '../HomeScreen';
import * as api from '../../api/client';

/**
 * Tests de l'accueil-cockpit (Vague 3 §7-19/§31, passe visuelle Maquette 3) : état
 * vide, état configuré, blocs cliquables (comptes/échéances/plans/projection),
 * menu ☰, conformité de l'ordre/du contenu des 6 blocs validés.
 */
jest.mock('../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));
jest.mock('../../ui/useTopInset', () => ({ useTopInset: () => 16 }));

const mockNavigate = jest.fn();
const mockGetParent = jest.fn(() => ({ navigate: mockNavigate }));
jest.mock('@react-navigation/native', () => ({
  // Point 3 — 'Transactions' est un Tab.Screen SIBLING de 'Accueil' (jamais
  // atteignable via getParent(), qui renvoie le Stack racine) : navigate()
  // direct désormais utilisé pour ce bouton, d'où l'ajout ici (même mockNavigate,
  // partagé avec getParent().navigate pour les autres routes du Stack racine).
  useNavigation: () => ({ getParent: mockGetParent, navigate: mockNavigate }),
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
    listTransactions: jest.fn(),
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
    fin_periode_engagements_connus: 0,
    fin_periode_prudente: 0,
    ecart_prudentiel: 0,
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
  mockedApi.listTransactions.mockResolvedValue([]);
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

describe('Accueil — état configuré (§7-17/§31, Maquette 3)', () => {
  const CONFIGURED_SUMMARY = {
    ...EMPTY_SUMMARY,
    operational_treasury: 45000,
    reserved_amount: 20000,
    committed_amount: 21800,
    safety_buffer: 10000,
    free_available: 15000,
    patrimoine_liquide_total: 45000,
    next_30_days: {
      ...EMPTY_SUMMARY.next_30_days,
      closing_physical_treasury: 40000,
      fin_periode_engagements_connus: 40000,
      fin_periode_prudente: 34000,
      ecart_prudentiel: 6000,
    },
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
        planType: 'school' as const,
        knownPlanCost: 67450,
        paidAmount: 8000,
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

  it("TXT réf. §M4 : le héro affiche Aujourd'hui + Fin de période (engagements connus / budgets inclus) avec l'écart prudentiel, jamais \"Disponible après engagements\" en indicateur principal", async () => {
    await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByText("AUJOURD'HUI")).toBeTruthy());
    expect(screen.getAllByText('45 000 DH').length).toBeGreaterThan(0); // operational_treasury (montant principal du héro)
    expect(screen.getByText('Comptes inclus dans votre pilotage financier')).toBeTruthy();
    expect(screen.getByText('Fin de période — engagements connus')).toBeTruthy();
    expect(screen.getByText('Fin de période — budgets inclus')).toBeTruthy();
    expect(screen.getAllByText('40 000 DH').length).toBeGreaterThan(0); // fin_periode_engagements_connus
    expect(screen.getByText('34 000 DH')).toBeTruthy(); // fin_periode_prudente
    expect(screen.getByText('dont 6 000 DH de budgets encore disponibles')).toBeTruthy();
    // "Disponible après engagements" n'est plus un grand indicateur principal du héro (§4).
    expect(screen.queryByText('Disponible après engagements')).toBeNull();
    // "Budgets restants" / "Plans couverts" définitivement supprimés (règle validée).
    expect(screen.queryByText('Budgets restants')).toBeNull();
    expect(screen.queryByText('Plans couverts')).toBeNull();
  });

  it('un compte est cliquable → AccountDetail', async () => {
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('CIH'));
    await fireEvent.press(screen.getByText('CIH'));
    expect(mockNavigate).toHaveBeenCalledWith('AccountDetail', { id: 'acc-cih' });
  });

  it('R6.3 (point B) / TXT réf. §M4 : la mini-métrique "Fin de période — engagements connus" est cliquable → EngagedDetail avec exactement le montant Home et les composantes de la même source', async () => {
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

  it('R5 clôture Home §6 : aucun bouton "Payer" visible sur la carte échéance de la Home (l\'action reste dans DeadlineDetailScreen)', async () => {
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('Scolarité Dina'));
    expect(screen.queryByText('Payer')).toBeNull();
  });

  it('un plan est cliquable → FinancialPlanDetail, icône school + montant total + ligne payé/provisionné', async () => {
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('École 2026/2027'));
    expect(screen.getByText('🎓')).toBeTruthy();
    expect(screen.getByText('67 450 DH')).toBeTruthy();
    expect(screen.getByText('Payé 8 000 DH')).toBeTruthy();
    expect(screen.getByText('Provisionné 30 000 DH')).toBeTruthy();
    await fireEvent.press(screen.getByText('École 2026/2027'));
    expect(mockNavigate).toHaveBeenCalledWith('FinancialPlanDetail', { id: 'p1' });
  });

  it('corrections consolidées §2 — bloc "Dernières transactions" : une ligne est cliquable → TransactionDetail, "Voir toutes" → Transactions', async () => {
    mockedApi.listTransactions.mockResolvedValue([
      { kind: 'payment', id: 'pay-1', occurredAt: '2026-09-10', amount: -500, accountName: 'CIH', label: 'Loyer', displayKind: 'paiement' },
    ]);
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('Dernières transactions'));

    await fireEvent.press(screen.getByTestId('home-transaction-payment-pay-1'));
    expect(mockNavigate).toHaveBeenCalledWith('TransactionDetail', { kind: 'payment', id: 'pay-1' });

    await fireEvent.press(screen.getByTestId('home-transactions-see-all'));
    expect(mockNavigate).toHaveBeenCalledWith('Transactions');
  });

  it('Correction UX (Transactions) — appelle listTransactions avec excludeReconciliation: true (jamais un écart de rapprochement dans "Dernières transactions")', async () => {
    mockedApi.listTransactions.mockResolvedValue([]);
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('Dernières transactions'));

    expect(mockedApi.listTransactions).toHaveBeenCalledWith(expect.objectContaining({ excludeReconciliation: true }));
  });

  it('corrections consolidées §2 — sans transaction réelle, affiche un état vide explicite', async () => {
    mockedApi.listTransactions.mockResolvedValue([]);
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('Dernières transactions'));
    expect(screen.getByText("Aucune transaction enregistrée pour l'instant.")).toBeTruthy();
  });

  it('R6.4 (§5 / test I) : le bloc "Actions à traiter" est absent de l\'accueil', async () => {
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText("AUJOURD'HUI"));
    expect(screen.queryByText(/action.*à traiter/i)).toBeNull();
  });

  it('R6.1 §10 / R6.3 point D (dernier cadrage Home), mis à jour par les corrections consolidées §4/§5 : "Mes comptes" affiche le badge "Hors pilotage", "Patrimoine total" en secondaire (jamais de ligne "Trésorerie pilotée" doublon du héro), et le masquage par défaut suit désormais hideBalanceByDefault (compte par compte), PAS includeInOperationalTreasury', async () => {
    mockedApi.listAccounts.mockResolvedValue([
      { id: 'acc-cih', name: 'CIH', soldeCourant: 15000, includeInOperationalTreasury: true },
      // Corrections consolidées §4/§5/§6 — un compte hors pilotage masqué par
      // défaut : les 2 préférences sont réglées indépendamment (§6 démontrée
      // par un test dédié ci-dessous, showOnHome).
      { id: 'acc-livret', name: 'Livret bloqué', soldeCourant: 30000, includeInOperationalTreasury: false, hideBalanceByDefault: true },
    ]);
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('CIH'));

    // Dernier cadrage Home — la ligne "Trésorerie pilotée" sous les comptes est
    // retirée (doublon du montant déjà affiché en tête du héro) ; seul le
    // patrimoine global reste affiché ici, en secondaire.
    expect(screen.queryByText('Trésorerie pilotée')).toBeNull();
    expect(screen.queryByTestId('home-piloted-total')).toBeNull();
    expect(screen.getByText('Patrimoine total (avec hors pilotage)')).toBeTruthy();
    expect(screen.getByText('Hors pilotage')).toBeTruthy();

    // Corrections consolidées §4/§5 — masqué par défaut (hideBalanceByDefault),
    // bascule via l'icône œil (état UI local, temporaire).
    expect(screen.getByText('•••••• DH')).toBeTruthy();
    expect(screen.queryByText('30 000 DH')).toBeNull();
    await fireEvent.press(screen.getByTestId('account-reveal-acc-livret'));
    expect(screen.getByText('30 000 DH')).toBeTruthy();
    expect(screen.queryByText('•••••• DH')).toBeNull();
  });

  it('corrections consolidées §4 — l\'œil est disponible sur CHAQUE compte (pas seulement les comptes hors pilotage) et fonctionne dans les 2 sens', async () => {
    mockedApi.listAccounts.mockResolvedValue([
      { id: 'acc-cih', name: 'CIH', soldeCourant: 15000, includeInOperationalTreasury: true, hideBalanceByDefault: false },
    ]);
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('CIH'));

    // Visible par défaut (hideBalanceByDefault=false) : l'œil permet quand même de masquer temporairement.
    expect(screen.getByText('15 000 DH')).toBeTruthy();
    expect(screen.getByTestId('account-reveal-acc-cih')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('account-reveal-acc-cih'));
    expect(screen.getByText('•••••• DH')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('account-reveal-acc-cih'));
    expect(screen.getByText('15 000 DH')).toBeTruthy();
  });

  it('corrections consolidées §6 — showOnHome=false retire le compte de "Mes comptes" (Accueil), indépendamment du pilotage', async () => {
    mockedApi.listAccounts.mockResolvedValue([
      { id: 'acc-cih', name: 'CIH', soldeCourant: 15000, includeInOperationalTreasury: true, showOnHome: true },
      { id: 'acc-masque', name: 'Compte masqué accueil', soldeCourant: 5000, includeInOperationalTreasury: true, showOnHome: false },
    ]);
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('CIH'));
    expect(screen.queryByText('Compte masqué accueil')).toBeNull();
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
 * Lot 3 / Maquette 3 §3 — bloc "Mes budgets" de l'accueil : réutilise
 * EXCLUSIVEMENT summary.budgetsResume déjà calculé côté backend, jamais un
 * recalcul mobile (donut = simple rendu du même ratio déjà fourni).
 */
describe('Accueil — bloc "Mes budgets" (Lot 3, Maquette 3)', () => {
  it('affiche les budgets avec consommé/plafond/restant (donut réel), et navigue vers BudgetDetail au clic', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      budgetsResume: [budgetFixture({ id: 'b1', categoryName: 'Courses', consommeADate: 300, budgetPeriode: 1000 })],
    });
    mockedApi.listAccounts.mockResolvedValue([]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByTestId('home-budget-b1'));
    expect(screen.getByText('Courses')).toBeTruthy();
    expect(screen.getByText('300 / 1 000 DH')).toBeTruthy();
    expect(screen.getByText('700 DH restent à consommer')).toBeTruthy();
    expect(screen.getByText('30%')).toBeTruthy(); // texte au centre du donut (300/1000)

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

  it('"Voir tous" navigue vers Budgets', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      budgetsResume: [budgetFixture({ id: 'b1' })],
    });
    mockedApi.listAccounts.mockResolvedValue([]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByTestId('home-budget-b1'));
    await fireEvent.press(screen.getByText('Voir tous'));
    expect(mockNavigate).toHaveBeenCalledWith('Budgets');
  });

  // Corrections UI/UX finales §9 — "Voir toutes" sur Échéances importantes
  // ouvre le calendrier des échéances, jamais l'écran de création de charge.
  it('Échéances importantes → "Voir toutes" navigue vers Calendrier (jamais Charges)', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
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
    await render(<HomeScreen />);

    await waitFor(() => screen.getByText('Échéances importantes'));
    await fireEvent.press(screen.getByTestId('home-deadlines-see-all'));
    expect(mockNavigate).toHaveBeenCalledWith('Calendrier');
    expect(mockNavigate).not.toHaveBeenCalledWith('Charges');
  });

  it('aucun budget → le bloc "Mes budgets" est absent (jamais un bloc vide affiché)', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({ ...EMPTY_SUMMARY, budgetsResume: [] });
    mockedApi.listAccounts.mockResolvedValue([{ id: 'acc-1', name: 'Compte SG', soldeCourant: 0 }]);
    mockedApi.listIncomeSources.mockResolvedValue([{ id: 'inc-1', label: 'Salaire' }]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByText("AUJOURD'HUI"));
    expect(screen.queryByText('Mes budgets')).toBeNull();
  });
});

/** Correction (point 9, révision) — "Mes plans financiers" sur l'Accueil doit
 * être trié par ordre alphabétique du libellé PUIS limité aux 6 premiers,
 * JAMAIS par urgence/retard (nextDeadlineDate/hasOverdue) : même règle que
 * "Voir tous" (FinancialPlansScreen), pour que les deux écrans montrent la
 * même sélection cohérente. Remplace l'ancien correctif "priorité par
 * échéance" (explicitement rejeté par le besoin utilisateur réel). */
describe('Accueil — "Mes plans financiers" trié par ordre alphabétique, jamais par urgence (point 9)', () => {
  function iso(daysFromNow: number): string {
    return new Date(Date.now() + daysFromNow * 86400000).toISOString().slice(0, 10);
  }

  it("un plan alphabétiquement antérieur passe avant un plan en retard/urgent alphabétiquement postérieur", async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      financialPlansResume: [
        {
          id: 'plan-zoo',
          label: 'Zoo — voyage urgent',
          planType: 'travel' as const,
          knownPlanCost: 60000,
          paidAmount: 0,
          remainingDue: 50000,
          provisionCoverage: 5000,
          tauxCouverture: 10,
          nextDeadlineDate: iso(-5),
          hasOverdue: true, // urgent, mais ne doit plus jamais primer sur l'alphabet
          completude: 'complet',
        },
        {
          id: 'plan-abonnements',
          label: 'Abonnements',
          planType: 'subscriptions' as const,
          knownPlanCost: 100,
          paidAmount: 0,
          remainingDue: 50,
          provisionCoverage: 50,
          tauxCouverture: 50,
          nextDeadlineDate: null,
          hasOverdue: false,
          completude: 'complet',
        },
      ],
    });
    mockedApi.listAccounts.mockResolvedValue([]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByTestId('home-plan-plan-abonnements'));
    const cards = screen.getAllByTestId(/^home-plan-/);
    expect(cards.map((c) => c.props.testID)).toEqual(['home-plan-plan-abonnements', 'home-plan-plan-zoo']);
  });

  it('tri alphabétique insensible à la casse/accents, puis les 6 premiers seulement (au-delà : "Voir tous")', async () => {
    const label = (id: string, label: string) => ({
      id,
      label,
      planType: 'other' as const,
      knownPlanCost: 100,
      paidAmount: 0,
      remainingDue: 100,
      provisionCoverage: 0,
      tauxCouverture: 0,
      nextDeadlineDate: null,
      hasOverdue: false,
      completude: 'complet' as const,
    });
    mockedApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      financialPlansResume: [
        label('p-zoo', 'Zoo'),
        label('p-ecole', 'école'),
        label('p-banane', 'Banane'),
        label('p-abricot', 'Abricot'),
        label('p-elephant', 'Éléphant'),
        label('p-dromadaire', 'Dromadaire'),
        label('p-citron', 'Citron'),
        label('p-figue', 'Figue'),
      ],
    });
    mockedApi.listAccounts.mockResolvedValue([]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByTestId('home-plan-p-abricot'));
    const cards = screen.getAllByTestId(/^home-plan-/);
    // Abricot, Banane, Citron, Dromadaire, école, Éléphant — 6 premiers alphabétiques
    // (accents/casse insensibles), Figue et Zoo exclus (au-delà des 6, "Voir tous" seulement).
    expect(cards.map((c) => c.props.testID)).toEqual([
      'home-plan-p-abricot',
      'home-plan-p-banane',
      'home-plan-p-citron',
      'home-plan-p-dromadaire',
      'home-plan-p-ecole',
      'home-plan-p-elephant',
    ]);
  });
});

/**
 * Maquette 3 §4 — mapping strict de l'icône selon planType, jamais une
 * déduction par mots-clés dans le libellé, jamais un type inventé.
 */
describe('Accueil — icônes des plans (Maquette 3 §4)', () => {
  it('school → 🎓, travel → ✈️, other → 📁, jamais déduit du libellé', async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      financialPlansResume: [
        { id: 'p-school', label: 'École', planType: 'school' as const, knownPlanCost: 100, paidAmount: 0, remainingDue: 100, provisionCoverage: 0, tauxCouverture: 0, nextDeadlineDate: null, hasOverdue: false, completude: 'complet' },
        { id: 'p-travel', label: 'Voyage', planType: 'travel' as const, knownPlanCost: 100, paidAmount: 0, remainingDue: 100, provisionCoverage: 0, tauxCouverture: 0, nextDeadlineDate: null, hasOverdue: false, completude: 'complet' },
        { id: 'p-maison', label: 'Maison (libellé trompeur)', planType: 'other' as const, knownPlanCost: 100, paidAmount: 0, remainingDue: 100, provisionCoverage: 0, tauxCouverture: 0, nextDeadlineDate: null, hasOverdue: false, completude: 'complet' },
      ],
    });
    mockedApi.listAccounts.mockResolvedValue([]);
    await render(<HomeScreen />);

    await waitFor(() => screen.getByTestId('home-plan-p-school'));
    expect(screen.getByText('🎓')).toBeTruthy();
    expect(screen.getByText('✈️')).toBeTruthy();
    expect(screen.getByText('📁')).toBeTruthy();
    // "Maison" dans le libellé n'a jamais produit l'icône 🏠 (pas de déduction par mots-clés).
    expect(screen.queryByText('🏠')).toBeNull();
  });
});

/** Correctif post-Vague 3 (point 2) — le seuil "très proche" (orange) de l'accueil doit
 * refléter seuil_a_payer_days du foyer (déjà chargé avec le dashboard), jamais une
 * valeur codée en dur, pour rester cohérent quel que soit le seuil configuré. Depuis
 * la passe Maquette 3, l'urgence colore le FOND de la pastille date, plus le texte. */
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

  function pillBackgroundColor(id: string): string | undefined {
    const pill = screen.getByTestId(`deadline-date-pill-${id}`);
    const flat = [pill.props.style].flat();
    return flat.find((s: any) => s?.backgroundColor)?.backgroundColor;
  }

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
    expect(pillBackgroundColor('d-seuil')).toBe('#B8860B');
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
    expect(pillBackgroundColor('d-seuil')).toBe('#172436');
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

    await waitFor(() => screen.getByText("AUJOURD'HUI"));
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

    await waitFor(() => screen.getByText("AUJOURD'HUI"));
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
 * Corrections UI/UX finales §1, mises à jour par les corrections consolidées
 * §2 — ordre des blocs validé : Situation pilotée aujourd'hui (premier bloc
 * fonctionnel après le titre) → Mes comptes → Mes budgets → Mes plans
 * financiers → Échéances importantes → Dernières transactions (remplace
 * l'ancien bloc Projection), avec les titres de section en casse normale.
 */
// Corrections UI/UX finales §7 — le menu ☰ n'est plus un onglet de la barre
// basse : un bouton dédié en haut à gauche de l'écran racine ouvre HamburgerMenu.
it('le bouton ☰ en haut à gauche navigue vers HamburgerMenu', async () => {
  mockedApi.getDashboardSummary.mockResolvedValue(EMPTY_SUMMARY);
  mockedApi.listAccounts.mockResolvedValue([]);
  await render(<HomeScreen />);

  await waitFor(() => screen.getByTestId('home-hamburger'));
  await fireEvent.press(screen.getByTestId('home-hamburger'));
  expect(mockNavigate).toHaveBeenCalledWith('HamburgerMenu');
});

describe('Accueil — ordre des blocs (corrections UI/UX finales §1)', () => {
  it("les 6 blocs apparaissent dans l'arbre rendu dans l'ordre validé : Situation pilotée → Comptes → Budgets → Plans → Échéances → Dernières transactions", async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({
      ...EMPTY_SUMMARY,
      budgetsResume: [budgetFixture({ id: 'b1' })],
      financialPlansResume: [
        {
          id: 'p1',
          label: 'École 2026/2027',
          planType: 'school' as const,
          knownPlanCost: 1000,
          paidAmount: 200,
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
    await waitFor(() => screen.getByText('Dernières transactions'));

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
    const order = ["AUJOURD'HUI", 'Mes comptes', 'Mes budgets', 'Mes plans financiers', 'Échéances importantes', 'Dernières transactions'];
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
