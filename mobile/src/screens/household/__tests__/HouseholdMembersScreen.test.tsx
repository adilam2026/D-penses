import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { HouseholdMembersScreen } from '../HouseholdMembersScreen';
import { personColor } from '../../../ui/personPalette';

/**
 * Couleur d'une personne (User.color) depuis « Membres » : pastille visible
 * par tous, modification réservée à un admin du foyer, palette des personnes.
 */
jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockGetMyHousehold = jest.fn();
const mockGetMe = jest.fn();
const mockUpdateMemberColor = jest.fn();
jest.mock('../../../api/client', () => ({
  getMyHousehold: () => mockGetMyHousehold(),
  getMe: () => mockGetMe(),
  createInvite: jest.fn(),
  updateMemberColor: (...args: unknown[]) => mockUpdateMemberColor(...args),
}));

function household(adilColor: string | null, lamiaaColor: string | null) {
  return {
    id: 'h1',
    name: 'Foyer',
    memberships: [
      { id: 'm-adil', userId: 'u-adil', role: 'admin', user: { id: 'u-adil', firstName: 'Adil', lastName: 'A', email: 'adil@test.local', color: adilColor } },
      { id: 'm-lamiaa', userId: 'u-lamiaa', role: 'member', user: { id: 'u-lamiaa', firstName: 'Lamiaa', lastName: 'L', email: 'lamiaa@test.local', color: lamiaaColor } },
    ],
  };
}

const dotColor = (memberId: string) => StyleSheet.flatten(screen.getByTestId(`member-color-dot-${memberId}`).props.style).backgroundColor;

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateMemberColor.mockResolvedValue({});
});

it('pastille = couleur de la personne (User.color) ; sans couleur, pastille neutre', async () => {
  mockGetMyHousehold.mockResolvedValue(household('bleu', null));
  mockGetMe.mockResolvedValue({ sub: 'u-adil' });
  render(<HouseholdMembersScreen />);
  await waitFor(() => screen.getByTestId('member-color-dot-m-adil'));
  expect(dotColor('m-adil')).toBe(personColor('bleu'));
  expect(dotColor('m-lamiaa')).toBeUndefined();
});

it("admin : choisit la couleur d'un membre dans la palette des personnes et l'enregistre par son memberId", async () => {
  mockGetMyHousehold.mockResolvedValueOnce(household(null, null)).mockResolvedValueOnce(household(null, 'rose'));
  mockGetMe.mockResolvedValue({ sub: 'u-adil' });
  render(<HouseholdMembersScreen />);
  await waitFor(() => screen.getByTestId('member-color-edit-m-lamiaa'));
  await fireEvent.press(screen.getByTestId('member-color-edit-m-lamiaa'));
  await waitFor(() => screen.getByText('Couleur de Lamiaa'));
  // Palette des personnes uniquement (jamais celle des comptes).
  expect(screen.getByTestId('person-color-rose')).toBeTruthy();
  expect(screen.queryByTestId('account-color-fuchsia')).toBeNull();
  await fireEvent.press(screen.getByTestId('person-color-rose'));
  await fireEvent.press(screen.getByTestId('color-picker-submit'));
  await waitFor(() => expect(mockUpdateMemberColor).toHaveBeenCalledWith('m-lamiaa', 'rose'));
  await waitFor(() => expect(dotColor('m-lamiaa')).toBe(personColor('rose')));
});

it('non-admin : voit les pastilles mais aucun bouton de modification', async () => {
  mockGetMyHousehold.mockResolvedValue(household('bleu', 'rose'));
  mockGetMe.mockResolvedValue({ sub: 'u-lamiaa' });
  render(<HouseholdMembersScreen />);
  await waitFor(() => screen.getByTestId('member-color-dot-m-lamiaa'));
  expect(screen.queryByTestId('member-color-edit-m-adil')).toBeNull();
  expect(screen.queryByTestId('member-color-edit-m-lamiaa')).toBeNull();
  expect(mockUpdateMemberColor).not.toHaveBeenCalled();
});
