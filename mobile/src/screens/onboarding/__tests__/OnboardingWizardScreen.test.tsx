import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { OnboardingWizardScreen } from '../OnboardingWizardScreen';
import * as api from '../../../api/client';

/**
 * Assistant de démarrage (Vague 3 §26-28/§31) : parcours nouveau foyer, "Je n'en
 * ai pas" (persisté), "Plus tard" (non persisté), multi-création, reprise.
 */
jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  // Le composant passe useFocusEffect(useCallback(fn, [step])) — sa référence ne
  // change exactement que lorsque `step` change. En dépendant de `cb` lui-même,
  // ce mock réexécute la vérification à chaque changement d'étape, comme le
  // ferait un vrai re-focus, sans tenter de simuler un aller-retour de navigation
  // hors du composant (non réalisable sans un vrai conteneur de navigation).
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, [cb]);
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    listAccounts: jest.fn(),
    listIncomeSources: jest.fn(),
    listOpenDeadlines: jest.fn(),
    listChildren: jest.fn(),
    listVariableBudgets: jest.fn(),
    listPockets: jest.fn(),
    listProvisions: jest.fn(),
    listFinancialPlans: jest.fn(),
    skipOnboardingStep: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listAccounts.mockResolvedValue([]);
  mockedApi.listIncomeSources.mockResolvedValue([]);
  mockedApi.listOpenDeadlines.mockResolvedValue([]);
  mockedApi.listChildren.mockResolvedValue([]);
  mockedApi.listVariableBudgets.mockResolvedValue([]);
  mockedApi.listPockets.mockResolvedValue([]);
  mockedApi.listProvisions.mockResolvedValue([]);
  mockedApi.listFinancialPlans.mockResolvedValue([]);
});

it("nouveau foyer : l'étape 1 (Comptes) ne propose PAS 'Je n'en ai pas' (compte indispensable)", async () => {
  await render(<OnboardingWizardScreen />);
  await waitFor(() => screen.getByText('Comptes'));
  expect(screen.queryByTestId('onboarding-not-applicable')).toBeNull();
});

it("étape 2 (Revenus) sans donnée propose 'Je n'en ai pas', qui persiste le skip et avance", async () => {
  await render(<OnboardingWizardScreen />);
  await waitFor(() => screen.getByText('Comptes'));
  await fireEvent.press(screen.getByTestId('onboarding-later'));
  await waitFor(() => screen.getByText('Revenus'));

  await fireEvent.press(screen.getByTestId('onboarding-not-applicable'));

  await waitFor(() => expect(mockedApi.skipOnboardingStep).toHaveBeenCalledWith('income'));
  await waitFor(() => screen.getByText('Charges'));
});

it("'Plus tard' avance sans appeler skipOnboardingStep", async () => {
  await render(<OnboardingWizardScreen />);
  await waitFor(() => screen.getByText('Comptes'));

  await fireEvent.press(screen.getByTestId('onboarding-later'));

  await waitFor(() => screen.getByText('Revenus'));
  expect(mockedApi.skipOnboardingStep).not.toHaveBeenCalled();
});

it('un compte déjà créé affiche "Ajouter un autre compte" et "Continuer" (pattern multi-création §27)', async () => {
  mockedApi.listAccounts.mockResolvedValue([{ id: 'a1', name: 'CIH' }]);
  await render(<OnboardingWizardScreen />);

  await waitFor(() => expect(screen.getByText('Ajouter un autre compte')).toBeTruthy());
  expect(screen.getByTestId('onboarding-continue')).toBeTruthy();
});

it('un compte créé entre deux passages sur l\'étape affiche la confirmation "Compte ajouté." (multi-création §27)', async () => {
  mockedApi.listAccounts.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'a1', name: 'CIH' }]);
  await render(<OnboardingWizardScreen />);
  await waitFor(() => screen.getByText("Rien de configuré pour l'instant"));

  await fireEvent.press(screen.getByTestId('onboarding-action-accounts'));
  expect(mockNavigate).toHaveBeenCalledWith('QuickCreateAccount', undefined);

  // Aller à l'étape suivante puis revenir déclenche un nouveau re-focus sur "Comptes" —
  // le compteur, re-vérifié en direct, est cette fois passé de 0 à 1 (§26 : jamais stocké).
  await fireEvent.press(screen.getByTestId('onboarding-later'));
  await waitFor(() => screen.getByText('Revenus'));
  await fireEvent.press(screen.getByText('Précédent'));

  await waitFor(() => expect(screen.getByText('✓ Compte ajouté.')).toBeTruthy());
});

it('parcourir les 7 étapes jusqu\'au bout et appuyer sur "Terminer" referme l\'assistant (onboarding terminé)', async () => {
  await render(<OnboardingWizardScreen />);
  await waitFor(() => screen.getByText('Comptes'));
  for (let i = 0; i < 6; i++) {
    await fireEvent.press(screen.getByTestId('onboarding-later'));
  }
  await waitFor(() => screen.getByText('Projets importants'));

  await fireEvent.press(screen.getByText('Terminer'));

  expect(mockGoBack).toHaveBeenCalled();
});

it('navigation Précédent revient à l\'étape précédente sans perdre la progression', async () => {
  await render(<OnboardingWizardScreen />);
  await waitFor(() => screen.getByText('Comptes'));
  await fireEvent.press(screen.getByTestId('onboarding-later'));
  await waitFor(() => screen.getByText('Revenus'));

  await fireEvent.press(screen.getByText('Précédent'));

  await waitFor(() => screen.getByText('Comptes'));
});

it('"Fermer" sur la première étape referme l\'assistant (reprise possible plus tard, §28)', async () => {
  await render(<OnboardingWizardScreen />);
  await waitFor(() => screen.getByText('Comptes'));
  await fireEvent.press(screen.getByText('Fermer'));
  expect(mockGoBack).toHaveBeenCalled();
});
