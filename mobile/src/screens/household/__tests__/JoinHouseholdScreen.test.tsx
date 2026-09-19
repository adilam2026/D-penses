import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { JoinHouseholdScreen } from '../JoinHouseholdScreen';
import { ApiError } from '../../../api/client';

/**
 * Corrections consolidées §16/§17 — deux concepts distincts, jamais mélangés :
 * "Rejoindre un foyer" reste atteignable à tout moment post-authentification
 * (pas seulement au premier onboarding), sans déconnexion forcée ni
 * redémarrage de l'onboarding : la jonction bascule le foyer actif et ramène
 * à l'Accueil (rafraîchissement des données). "Vos foyers" bascule parmi les
 * memberships EXISTANTS, sans jamais redemander de code d'invitation.
 */
jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

const mockReset = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ reset: mockReset }),
}));

const mockJoinHousehold = jest.fn();
const mockSwitchActiveHousehold = jest.fn();
jest.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ joinHousehold: mockJoinHousehold, switchActiveHousehold: mockSwitchActiveHousehold }),
}));

const mockListHouseholdMemberships = jest.fn();
jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { ...actual, listHouseholdMemberships: () => mockListHouseholdMemberships() };
});

beforeEach(() => {
  jest.clearAllMocks();
  // Par défaut, aucun autre foyer à proposer — comportement d'origine pour les
  // tests existants (section "Vos foyers" jamais affichée avec 0 ou 1 membership).
  mockListHouseholdMemberships.mockResolvedValue([]);
  jest.spyOn(Alert, 'alert').mockImplementation((...args: unknown[]) => {
    const buttons = args[2] as Array<{ text: string; onPress?: () => void }> | undefined;
    const confirmLabel = buttons?.find((b) => b.text === 'Rejoindre' || b.text === 'Changer');
    confirmLabel?.onPress?.();
  });
});

it('rejoint le foyer après confirmation puis réinitialise la navigation sur Accueil (rafraîchit les données)', async () => {
  mockJoinHousehold.mockResolvedValue(undefined);
  await render(<JoinHouseholdScreen />);

  await fireEvent.changeText(screen.getByTestId('join-household-code-input'), 'abc123');
  await fireEvent.press(screen.getByTestId('join-household-submit'));

  expect(Alert.alert).toHaveBeenCalled();
  await waitFor(() => expect(mockJoinHousehold).toHaveBeenCalledWith('abc123'));
  await waitFor(() => expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Tabs' }] }));
});

it('affiche une erreur claire pour un code invalide ou expiré, sans jamais déconnecter', async () => {
  mockJoinHousehold.mockRejectedValue(new ApiError(404, 'Code invalide ou expiré'));
  await render(<JoinHouseholdScreen />);

  await fireEvent.changeText(screen.getByTestId('join-household-code-input'), 'BADCODE');
  await fireEvent.press(screen.getByTestId('join-household-submit'));

  await waitFor(() => screen.getByText('Code invalide ou expiré'));
  expect(mockReset).not.toHaveBeenCalled();
});

it('refuse la soumission sans code', async () => {
  await render(<JoinHouseholdScreen />);

  await fireEvent.press(screen.getByTestId('join-household-submit'));

  await waitFor(() => screen.getByText("Un code d'invitation est requis"));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(mockJoinHousehold).not.toHaveBeenCalled();
});

/**
 * Corrections consolidées §17 — "Vos foyers" (changement de foyer actif parmi
 * les memberships existants) est un bloc distinct de "Rejoindre un nouveau
 * foyer" (ci-dessus, inchangé) : jamais mélangés, jamais de code d'invitation
 * requis pour retrouver un foyer déjà membre.
 */
describe('Corrections consolidées §17 — "Vos foyers" (changement de foyer actif)', () => {
  const MEMBERSHIPS = [
    { householdId: 'hh-a', name: 'Foyer A', role: 'admin', isActive: true },
    { householdId: 'hh-b', name: 'Foyer B', role: 'member', isActive: false },
  ];

  it('n\'affiche jamais la section "Vos foyers" quand il n\'y a qu\'un seul foyer (ou aucun)', async () => {
    mockListHouseholdMemberships.mockResolvedValue([{ householdId: 'hh-a', name: 'Foyer A', role: 'admin', isActive: true }]);
    await render(<JoinHouseholdScreen />);

    await waitFor(() => expect(screen.getByTestId('join-household-submit')).toBeTruthy());
    expect(screen.queryByTestId('household-switcher-section')).toBeNull();
  });

  it('affiche "Vos foyers" avec le foyer actif marqué, et bascule vers un autre foyer SANS code d\'invitation après confirmation', async () => {
    mockListHouseholdMemberships.mockResolvedValue(MEMBERSHIPS);
    mockSwitchActiveHousehold.mockResolvedValue(undefined);
    await render(<JoinHouseholdScreen />);

    await waitFor(() => expect(screen.getByTestId('household-switcher-section')).toBeTruthy());
    expect(screen.getByText('Foyer A')).toBeTruthy();
    expect(screen.getByText('Foyer B')).toBeTruthy();
    expect(screen.getByText('Actif')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('household-switch-row-hh-b'));

    expect(Alert.alert).toHaveBeenCalled();
    await waitFor(() => expect(mockSwitchActiveHousehold).toHaveBeenCalledWith('hh-b'));
    // Jamais un appel à joinHousehold — concept distinct, aucun code d'invitation en jeu.
    expect(mockJoinHousehold).not.toHaveBeenCalled();
    await waitFor(() => expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Tabs' }] }));
  });

  it('le foyer déjà ACTIF n\'est jamais cliquable (rien à changer)', async () => {
    mockListHouseholdMemberships.mockResolvedValue(MEMBERSHIPS);
    await render(<JoinHouseholdScreen />);

    await waitFor(() => expect(screen.getByTestId('household-switcher-section')).toBeTruthy());
    fireEvent.press(screen.getByTestId('household-switch-row-hh-a'));

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockSwitchActiveHousehold).not.toHaveBeenCalled();
  });

  it('affiche une erreur claire si le changement de foyer échoue, sans jamais naviguer', async () => {
    mockListHouseholdMemberships.mockResolvedValue(MEMBERSHIPS);
    mockSwitchActiveHousehold.mockRejectedValue(new ApiError(404, "Vous n'êtes pas membre de ce foyer"));
    await render(<JoinHouseholdScreen />);

    await waitFor(() => expect(screen.getByTestId('household-switcher-section')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('household-switch-row-hh-b'));

    await waitFor(() => screen.getByText("Vous n'êtes pas membre de ce foyer"));
    expect(mockReset).not.toHaveBeenCalled();
  });
});
