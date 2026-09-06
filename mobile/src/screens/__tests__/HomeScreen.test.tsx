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

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, getDashboardSummary: jest.fn(), listAccounts: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

const EMPTY_SUMMARY = {
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
    status: 'OK' as const,
    is_complete: true,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
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
    committed_amount: 0,
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
      },
    ],
    financialPlansResume: [
      { id: 'p1', label: 'École 2026/2027', knownPlanCost: 67450, remainingDue: 37450, provisionCoverage: 30000, tauxCouverture: 44, completude: 'complet' },
    ],
    actionsATraiter: [{ kind: 'montant_a_confirmer' as const, deadlineId: 'd2', message: 'Facture Internet à confirmer.' }],
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

  it('un compte est cliquable → AccountDetail', async () => {
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('CIH'));
    await fireEvent.press(screen.getByText('CIH'));
    expect(mockNavigate).toHaveBeenCalledWith('AccountDetail', { id: 'acc-cih' });
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

  it('une action à traiter est cliquable → ConfirmDeadline', async () => {
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('• Facture Internet à confirmer.'));
    await fireEvent.press(screen.getByText('• Facture Internet à confirmer.'));
    expect(mockNavigate).toHaveBeenCalledWith('ConfirmDeadline', { id: 'd2' });
  });

  it('le bouton ☰ ouvre le menu hamburger', async () => {
    await render(<HomeScreen />);
    await waitFor(() => screen.getByTestId('hamburger-menu-button'));
    await fireEvent.press(screen.getByTestId('hamburger-menu-button'));
    expect(mockNavigate).toHaveBeenCalledWith('HamburgerMenu');
  });

  it("aucune carte 'actions à traiter' n'est affichée quand il n'y a rien à traiter", async () => {
    mockedApi.getDashboardSummary.mockResolvedValue({ ...CONFIGURED_SUMMARY, actionsATraiter: [] });
    await render(<HomeScreen />);
    await waitFor(() => screen.getByText('DISPONIBLE LIBRE'));
    expect(screen.queryByText(/action.*à traiter/)).toBeNull();
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
