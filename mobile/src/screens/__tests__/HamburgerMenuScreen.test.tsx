import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { HamburgerMenuScreen } from '../HamburgerMenuScreen';

/**
 * Convergence V6 §8 — "Rejoindre un foyer" ne doit apparaître que si cela a
 * du sens pour l'utilisateur courant (≤1 foyer), jamais inconditionnellement
 * comme avant (UX §18). Déconnexion devient une entrée de menu visible en
 * bas de liste (même gabarit que les autres lignes), jamais un simple lien
 * flottant centré.
 */
jest.mock('../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));
jest.mock('../../ui/useTopInset', () => ({ useTopInset: () => 16 }));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => require('react').createElement(Text, null, props.name) };
});

const mockSignOut = jest.fn();
jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ signOut: mockSignOut }),
}));

const mockListHouseholdMemberships = jest.fn();
jest.mock('../../api/client', () => ({
  listHouseholdMemberships: () => mockListHouseholdMemberships(),
}));

beforeEach(() => {
  mockNavigate.mockClear();
  mockSignOut.mockClear();
  mockListHouseholdMemberships.mockReset();
  mockListHouseholdMemberships.mockResolvedValue([{ householdId: 'h1', name: 'Foyer A', role: 'admin', isActive: true }]);
});

describe('HamburgerMenuScreen — CTA "Rejoindre un foyer" (conditionnel)', () => {
  it('affiche le CTA quand l\'utilisateur n\'a qu\'un seul foyer (≤1 membership)', async () => {
    await render(<HamburgerMenuScreen />);
    await waitFor(() => expect(screen.getByTestId('menu-join-household-cta')).toBeTruthy());
    expect(screen.getByText('Rejoindre un foyer')).toBeTruthy();
  });

  it('masque le CTA quand l\'utilisateur jongle déjà entre plusieurs foyers (>1 membership)', async () => {
    mockListHouseholdMemberships.mockResolvedValue([
      { householdId: 'h1', name: 'Foyer A', role: 'admin', isActive: true },
      { householdId: 'h2', name: 'Foyer B', role: 'member', isActive: false },
    ]);
    await render(<HamburgerMenuScreen />);
    await waitFor(() => screen.getByText('Gestion'));
    expect(screen.queryByTestId('menu-join-household-cta')).toBeNull();
  });

  it('affiche le CTA par défaut si la récupération des foyers échoue (jamais un écran cassé)', async () => {
    mockListHouseholdMemberships.mockRejectedValue(new Error('network'));
    await render(<HamburgerMenuScreen />);
    await waitFor(() => expect(screen.getByTestId('menu-join-household-cta')).toBeTruthy());
  });

  it('affiche le CTA avant la première section ("Gestion")', async () => {
    const view = await render(<HamburgerMenuScreen />);
    await waitFor(() => screen.getByTestId('menu-join-household-cta'));
    const allTexts = view.getAllByText(/.*/).map((node) => node.props.children);
    const ctaIndex = allTexts.findIndex((t) => t === 'Rejoindre un foyer');
    const sectionIndex = allTexts.findIndex((t) => t === 'Gestion');
    expect(ctaIndex).toBeGreaterThanOrEqual(0);
    expect(sectionIndex).toBeGreaterThanOrEqual(0);
    expect(ctaIndex).toBeLessThan(sectionIndex);
  });

  it('navigue vers l\'écran existant "JoinHousehold" au tap, sans logique métier dupliquée', async () => {
    await render(<HamburgerMenuScreen />);
    await waitFor(() => screen.getByTestId('menu-join-household-cta'));
    await fireEvent.press(screen.getByTestId('menu-join-household-cta'));
    expect(mockNavigate).toHaveBeenCalledWith('JoinHousehold');
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('conserve l\'entrée "Mes foyers" dans la section "Autres"', async () => {
    await render(<HamburgerMenuScreen />);
    await waitFor(() => screen.getByText('Mes foyers'));
    expect(screen.getByText('Mes foyers')).toBeTruthy();
  });
});

describe('HamburgerMenuScreen — Déconnexion (entrée de menu visible)', () => {
  it('affiche Déconnexion comme une entrée de menu en bas de liste (icône + texte, même gabarit)', async () => {
    await render(<HamburgerMenuScreen />);
    await waitFor(() => screen.getByTestId('menu-logout-row'));
    expect(screen.getByText('Déconnexion')).toBeTruthy();
  });

  it('appelle signOut() au tap', async () => {
    await render(<HamburgerMenuScreen />);
    await waitFor(() => screen.getByTestId('menu-logout-row'));
    await fireEvent.press(screen.getByTestId('menu-logout-row'));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
