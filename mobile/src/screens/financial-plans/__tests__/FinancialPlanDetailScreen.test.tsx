import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { FinancialPlanDetailScreen } from '../FinancialPlanDetailScreen';
import * as api from '../../../api/client';

/**
 * Correctif critique post-Vague 3 (§11/§12) — le bouton "Payer" et le tap sur
 * une échéance à confirmer utilisaient `navigation.getParent()?.navigate(...)`.
 * FinancialPlanDetailScreen est un Stack.Screen RACINE (RootNavigator), pas un
 * écran imbriqué dans RootTabs : `getParent()` y retourne toujours undefined,
 * donc `?.navigate(...)` ne faisait STRICTEMENT rien (bug identique à celui
 * déjà corrigé sur EpargneScreen). Ces tests prouvent que le tap déclenche
 * réellement la navigation (plain `navigate`), pas seulement qu'aucune erreur
 * n'est levée.
 */
jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockGoBack = jest.fn();
const mockGetParent = jest.fn(() => undefined); // simule fidèlement un Stack.Screen racine
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, replace: mockReplace, goBack: mockGoBack, getParent: mockGetParent }),
  useRoute: () => ({ params: { id: 'plan-1' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

// expo-font/expo-asset ne résolvent pas sous Jest dans cet environnement (frontière
// mockée, pas le comportement — seule l'icône réellement affichée nous importe ici).
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => Text != null && require('react').createElement(Text, null, props.name) };
});

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    getFinancialPlan: jest.fn(),
    updateFinancialPlan: jest.fn(),
    deleteFinancialPlan: jest.fn(),
    duplicateFinancialPlan: jest.fn(),
    listChildren: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

const PLAN = {
  id: 'plan-1',
  periodStart: '2026-09-01',
  periodEnd: '2027-06-30',
  planType: 'school' as const,
  label: 'École 2026/2027',
  knownPlanCost: 20000,
  paidAmount: 0,
  remainingDue: 20000,
  provisionCoverage: 0,
  remainingToFund: 20000,
  tauxCouverture: 0,
  completude: 'complet' as const,
  deadlinesCertain: [
    {
      id: 'd1',
      dueDate: '2026-09-30',
      chargePlanLabel: 'Scolarité T1',
      amountCurrent: 21800,
      amountStatus: 'confirme' as const,
      resteAPayer: 21800,
      financialStatus: 'ouverte' as const,
      provisionId: null,
      coverageAffectee: 0,
      engagementNonCouvert: 21800,
      coverageStatus: 'non_couverte' as const,
    },
    {
      id: 'd2',
      dueDate: '2026-10-15',
      chargePlanLabel: 'Garderie',
      amountCurrent: 500,
      amountStatus: 'estime' as const,
      resteAPayer: 500,
      financialStatus: 'ouverte' as const,
      provisionId: null,
      coverageAffectee: 0,
      engagementNonCouvert: 500,
      coverageStatus: 'non_couverte' as const,
    },
  ],
  envisagedItems: [],
  envisagedTotal: 0,
  unknownItems: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.getFinancialPlan.mockResolvedValue(PLAN);
  mockedApi.listChildren.mockResolvedValue([]);
});

it('le bouton "Payer" navigue réellement vers DeadlineDetail (bug critique corrigé)', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('pay-deadline-d1'));

  await fireEvent.press(screen.getByTestId('pay-deadline-d1'));

  expect(mockNavigate).toHaveBeenCalledWith('DeadlineDetail', { id: 'd1' });
});

it('taper une échéance "Estimé" navigue réellement vers ConfirmDeadline (bug critique corrigé)', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByText(/Garderie/));

  await fireEvent.press(screen.getByText(/Garderie/));

  expect(mockNavigate).toHaveBeenCalledWith('ConfirmDeadline', { id: 'd2' });
});

it('taper une échéance déjà confirmée navigue vers DeadlineDetail (pas ConfirmDeadline)', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByText(/Scolarité T1/));

  await fireEvent.press(screen.getByText(/Scolarité T1/));

  expect(mockNavigate).toHaveBeenCalledWith('DeadlineDetail', { id: 'd1' });
});

/**
 * Recette téléphone réel §1 — le bas de l'écran utilise désormais useBottomInset()
 * (source unique des marges système, cf. ui/useBottomInset.ts) au lieu d'un padding
 * fixe : jamais une valeur magique propre à un téléphone.
 */
it('le padding bas du ScrollView provient de useBottomInset(), jamais d\'une valeur fixe (§1)', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-detail-scroll'));

  const scroll = screen.getByTestId('plan-detail-scroll');
  const flatStyle = [scroll.props.contentContainerStyle].flat();
  expect(flatStyle.some((s: any) => s && s.paddingBottom === 16)).toBe(true);
});

/**
 * R5 §2 — menu "..." (Modifier/Dupliquer/Supprimer), pattern réutilisable (§19).
 */
it('§2 — le menu "..." propose Modifier/Dupliquer/Supprimer', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));

  await fireEvent.press(screen.getByTestId('plan-menu-button'));

  await waitFor(() => screen.getByTestId('plan-menu-option-modifier'));
  expect(screen.getByTestId('plan-menu-option-dupliquer')).toBeTruthy();
  expect(screen.getByTestId('plan-menu-option-supprimer')).toBeTruthy();
});

it("§2 — Modifier pré-remplit le formulaire et enregistre via PATCH", async () => {
  mockedApi.updateFinancialPlan.mockResolvedValue({ ...PLAN, label: 'École renommée' });

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByTestId('plan-menu-option-modifier'));
  await fireEvent.press(screen.getByTestId('plan-menu-option-modifier'));

  await waitFor(() => screen.getByTestId('plan-edit-form'));
  expect(screen.getByTestId('plan-edit-label').props.value).toBe('École 2026/2027');

  await fireEvent.changeText(screen.getByTestId('plan-edit-label'), 'École renommée');
  await fireEvent.press(screen.getByTestId('plan-edit-save'));

  await waitFor(() =>
    expect(mockedApi.updateFinancialPlan).toHaveBeenCalledWith('plan-1', {
      label: 'École renommée',
      periodStart: '2026-09-01',
      periodEnd: '2027-06-30',
    }),
  );
});

it('§3 — Dupliquer propose la sélection explicite des enfants, jamais héritée automatiquement', async () => {
  mockedApi.listChildren.mockResolvedValue([
    { id: 'c1', firstName: 'Aîné', lastName: 'D' },
    { id: 'c2', firstName: 'Cadette', lastName: 'D' },
  ]);
  mockedApi.duplicateFinancialPlan.mockResolvedValue({ id: 'plan-2' });

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByTestId('plan-menu-option-dupliquer'));
  await fireEvent.press(screen.getByTestId('plan-menu-option-dupliquer'));

  await waitFor(() => screen.getByTestId('plan-duplicate-child-c2'));
  // Aucun enfant pré-coché : sélection explicite, jamais héritée de l'original.
  await fireEvent.press(screen.getByTestId('plan-duplicate-child-c2'));
  await fireEvent.press(screen.getByTestId('plan-duplicate-confirm'));

  await waitFor(() =>
    expect(mockedApi.duplicateFinancialPlan).toHaveBeenCalledWith('plan-1', {
      label: 'École 2026/2027 (copie)',
      childIds: ['c2'],
    }),
  );
  expect(mockReplace).toHaveBeenCalledWith('FinancialPlanDetail', { id: 'plan-2' });
});

it("§2 — Supprimer appelle DELETE puis revient en arrière", async () => {
  mockedApi.deleteFinancialPlan.mockResolvedValue({ deleted: true });
  const RN = require('react-native');
  jest.spyOn(RN.Alert, 'alert').mockImplementation((...args: unknown[]) => {
    const buttons = args[2] as Array<{ text: string; onPress?: () => void }> | undefined;
    buttons?.find((b) => b.text === 'Supprimer')?.onPress?.();
  });

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByTestId('plan-menu-option-supprimer'));
  await fireEvent.press(screen.getByTestId('plan-menu-option-supprimer'));

  await waitFor(() => expect(mockedApi.deleteFinancialPlan).toHaveBeenCalledWith('plan-1'));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
});

it("§2 — Supprimer bloqué (paiements existants) affiche le message du backend, jamais un DELETE silencieux", async () => {
  mockedApi.deleteFinancialPlan.mockRejectedValue(
    new api.ApiError(400, "Ce plan a des paiements enregistrés — suppression impossible pour préserver l'historique financier."),
  );
  const RN = require('react-native');
  jest.spyOn(RN.Alert, 'alert').mockImplementation((...args: unknown[]) => {
    const buttons = args[2] as Array<{ text: string; onPress?: () => void }> | undefined;
    buttons?.find((b) => b.text === 'Supprimer')?.onPress?.();
  });

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByTestId('plan-menu-option-supprimer'));
  await fireEvent.press(screen.getByTestId('plan-menu-option-supprimer'));

  await waitFor(() => expect(screen.getByText(/paiements enregistrés/)).toBeTruthy());
  expect(mockGoBack).not.toHaveBeenCalled();
});
