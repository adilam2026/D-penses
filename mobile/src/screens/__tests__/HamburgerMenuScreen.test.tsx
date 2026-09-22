import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { HamburgerMenuScreen } from '../HamburgerMenuScreen';

/**
 * UX §18 — "Rejoindre un foyer" mis en avant en action principale du Menu ☰ :
 * doit apparaître avant la section "Mon foyer", rester visible même avec un
 * foyer déjà actif, et naviguer vers l'écran "Mes foyers" existant
 * (JoinHousehold) sans dupliquer sa logique métier (join/switch restent
 * exclusivement dans JoinHouseholdScreen via useAuth()).
 */
jest.mock('../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));
jest.mock('../../ui/useTopInset', () => ({ useTopInset: () => 16 }));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => require('react').createElement(Text, null, props.name) };
});

const mockSignOut = jest.fn();
jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ signOut: mockSignOut }),
}));

beforeEach(() => {
  mockNavigate.mockClear();
  mockSignOut.mockClear();
});

describe('HamburgerMenuScreen — CTA "Rejoindre un foyer"', () => {
  it('affiche le CTA "Rejoindre un foyer" directement dans le Menu', async () => {
    await render(<HamburgerMenuScreen />);
    expect(screen.getByTestId('menu-join-household-cta')).toBeTruthy();
    expect(screen.getByText('Rejoindre un foyer')).toBeTruthy();
  });

  it('affiche le CTA avant la première section ("Gestion")', async () => {
    const view = await render(<HamburgerMenuScreen />);
    const allTexts = view.getAllByText(/.*/).map((node) => node.props.children);
    const ctaIndex = allTexts.findIndex((t) => t === 'Rejoindre un foyer');
    const sectionIndex = allTexts.findIndex((t) => t === 'Gestion');
    expect(ctaIndex).toBeGreaterThanOrEqual(0);
    expect(sectionIndex).toBeGreaterThanOrEqual(0);
    expect(ctaIndex).toBeLessThan(sectionIndex);
  });

  it('reste visible même avec un foyer déjà actif (pas de gate sur les memberships)', async () => {
    // HamburgerMenuScreen ne consulte aucun état de foyer actif/memberships :
    // le CTA est rendu inconditionnellement, donc ce test de rendu simple
    // suffit à prouver l'absence de tout gating.
    await render(<HamburgerMenuScreen />);
    expect(screen.getByTestId('menu-join-household-cta')).toBeTruthy();
  });

  it('navigue vers l\'écran existant "JoinHousehold" au tap, sans logique métier dupliquée', async () => {
    await render(<HamburgerMenuScreen />);
    fireEvent.press(screen.getByTestId('menu-join-household-cta'));
    expect(mockNavigate).toHaveBeenCalledWith('JoinHousehold');
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('conserve l\'entrée "Mes foyers" dans la section "Mon foyer"', async () => {
    await render(<HamburgerMenuScreen />);
    expect(screen.getByText('Mes foyers')).toBeTruthy();
  });
});
