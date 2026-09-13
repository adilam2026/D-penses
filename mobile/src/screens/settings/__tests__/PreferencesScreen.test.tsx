import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PreferencesScreen } from '../PreferencesScreen';
import * as api from '../../../api/client';

/**
 * Mini-lot weekStartDay foyer — sélecteur lisible (Lundi..Dimanche) au lieu
 * d'un champ numérique 1-7, avec mapping backend 1=lundi..7=dimanche
 * (RG-098, même convention que VariableBudget.weekStartDay). Ce réglage sert
 * uniquement de défaut aux NOUVEAUX budgets hebdomadaires — jamais rétroactif
 * sur les budgets existants, ce que le texte affiché doit dire explicitement.
 */
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, [cb]);
  },
}));

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));
jest.mock('../../../ui/useKeyboardAwareScroll', () => ({
  useKeyboardAwareScroll: () => ({ scrollRef: { current: null }, handleFocus: jest.fn() }),
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { ...actual, getMyHousehold: jest.fn(), updateHouseholdSettings: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

function householdFixture(weekStartDay: number) {
  return {
    id: 'h1',
    settings: {
      securityMarginAmount: 0,
      seuilAVenirDays: 30,
      seuilAPayerDays: 7,
      closingDay: 31,
      weekStartDay,
      variableBudgetProjectionMode: 'prudent_max',
    },
  };
}

async function flush() {
  await waitFor(() => screen.getByTestId('preferences-week-start-day-select'));
}

describe('PreferencesScreen — premier jour de la semaine du foyer (mini-lot)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.updateHouseholdSettings.mockResolvedValue({} as any);
  });

  it('le weekStartDay actuel (mercredi=3) est correctement affiché', async () => {
    mockedApi.getMyHousehold.mockResolvedValue(householdFixture(3));
    await render(<PreferencesScreen />);
    await flush();

    expect(screen.getByText('Mercredi')).toBeTruthy();
  });

  it('le texte précise explicitement que seuls les nouveaux budgets hebdomadaires sont concernés', async () => {
    mockedApi.getMyHousehold.mockResolvedValue(householdFixture(1));
    await render(<PreferencesScreen />);
    await flush();

    expect(
      screen.getByText('Utilisé pour les nouveaux budgets hebdomadaires. Les budgets existants ne sont pas modifiés.'),
    ).toBeTruthy();
  });

  it('lundi=1 : sélectionner Lundi puis Enregistrer envoie weekStartDay=1', async () => {
    mockedApi.getMyHousehold.mockResolvedValue(householdFixture(3));
    await render(<PreferencesScreen />);
    await flush();

    await fireEvent.press(screen.getByTestId('preferences-week-start-day-select'));
    await flush();
    await fireEvent.press(await screen.findByTestId('preferences-week-start-day-select-option-1'));
    await flush();

    await fireEvent.press(screen.getByText('Enregistrer'));
    await waitFor(() => expect(mockedApi.updateHouseholdSettings).toHaveBeenCalledWith(expect.objectContaining({ weekStartDay: 1 })));
  });

  it('dimanche=7 : sélectionner Dimanche puis Enregistrer envoie weekStartDay=7', async () => {
    mockedApi.getMyHousehold.mockResolvedValue(householdFixture(1));
    await render(<PreferencesScreen />);
    await flush();

    await fireEvent.press(screen.getByTestId('preferences-week-start-day-select'));
    await flush();
    await fireEvent.press(await screen.findByTestId('preferences-week-start-day-select-option-7'));
    await flush();

    await fireEvent.press(screen.getByText('Enregistrer'));
    await waitFor(() => expect(mockedApi.updateHouseholdSettings).toHaveBeenCalledWith(expect.objectContaining({ weekStartDay: 7 })));
  });

  it('non touché : la valeur actuelle (vendredi=5) est renvoyée telle quelle', async () => {
    mockedApi.getMyHousehold.mockResolvedValue(householdFixture(5));
    await render(<PreferencesScreen />);
    await flush();

    await fireEvent.press(screen.getByText('Enregistrer'));
    await waitFor(() => expect(mockedApi.updateHouseholdSettings).toHaveBeenCalledWith(expect.objectContaining({ weekStartDay: 5 })));
  });
});
