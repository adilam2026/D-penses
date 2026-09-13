import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { CategoriesScreen } from '../CategoriesScreen';
import * as api from '../../../api/client';

/**
 * Mini-lot Référentiels — Supprimer une catégorie (foyer uniquement, jamais
 * système), confirmation explicite (§12 — jamais un DELETE silencieux),
 * message d'erreur backend affiché tel quel (jamais un contrôle dupliqué
 * côté mobile — le backend porte seul la règle "catégorie utilisée").
 */
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));
jest.mock('../../../ui/useKeyboardAwareScroll', () => ({
  useKeyboardAwareScroll: () => ({ scrollRef: { current: null }, handleFocus: jest.fn() }),
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    listCategories: jest.fn(),
    createCategory: jest.fn(),
    deleteCategory: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

const SYSTEM_CATEGORY = { id: 'cat-sys', name: 'Alimentation', kind: 'expense' as const, isSystem: true };
const HOUSEHOLD_CATEGORY = { id: 'cat-h1', name: 'Cadeaux', kind: 'expense' as const, isSystem: false };

function mockConfirmAlert(buttonText: string) {
  const RN = require('react-native');
  return jest.spyOn(RN.Alert, 'alert').mockImplementation((...args: unknown[]) => {
    const buttons = args[2] as Array<{ text: string; onPress?: () => void }> | undefined;
    buttons?.find((b) => b.text === buttonText)?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('une catégorie système n\'affiche aucune action Supprimer', async () => {
  mockedApi.listCategories.mockResolvedValue([SYSTEM_CATEGORY]);
  await render(<CategoriesScreen />);

  await waitFor(() => screen.getByText('Alimentation'));
  expect(screen.queryByTestId(`category-delete-${SYSTEM_CATEGORY.id}`)).toBeNull();
});

it('une catégorie du foyer inutilisée se supprime après confirmation, la liste est rafraîchie', async () => {
  mockedApi.listCategories
    .mockResolvedValueOnce([HOUSEHOLD_CATEGORY])
    .mockResolvedValueOnce([]);
  mockedApi.deleteCategory.mockResolvedValue(undefined);
  const alertSpy = mockConfirmAlert('Supprimer');

  await render(<CategoriesScreen />);
  await waitFor(() => screen.getByTestId(`category-delete-${HOUSEHOLD_CATEGORY.id}`));

  await fireEvent.press(screen.getByTestId(`category-delete-${HOUSEHOLD_CATEGORY.id}`));

  expect(alertSpy).toHaveBeenCalledWith('Supprimer cette catégorie ?', expect.stringContaining('Cadeaux'), expect.any(Array));
  await waitFor(() => expect(mockedApi.deleteCategory).toHaveBeenCalledWith('cat-h1'));
  await waitFor(() => expect(mockedApi.listCategories).toHaveBeenCalledTimes(2)); // chargement initial + refresh
  await waitFor(() => expect(screen.queryByText('Cadeaux')).toBeNull());
});

it('une catégorie utilisée : le message d\'erreur backend est affiché tel quel', async () => {
  mockedApi.listCategories.mockResolvedValue([HOUSEHOLD_CATEGORY]);
  mockedApi.deleteCategory.mockRejectedValue(
    new api.ApiError(400, 'Cette catégorie est utilisée par 3 élément(s) (revenus, charges, budgets ou dépenses réelles) — suppression impossible pour préserver l\'historique financier.'),
  );
  mockConfirmAlert('Supprimer');

  await render(<CategoriesScreen />);
  await waitFor(() => screen.getByTestId('category-delete-cat-h1'));

  await fireEvent.press(screen.getByTestId('category-delete-cat-h1'));

  await waitFor(() =>
    expect(
      screen.getByText("Cette catégorie est utilisée par 3 élément(s) (revenus, charges, budgets ou dépenses réelles) — suppression impossible pour préserver l'historique financier."),
    ).toBeTruthy(),
  );
  // La catégorie n'a jamais été retirée de la liste — la suppression a échoué.
  expect(screen.getByText('Cadeaux')).toBeTruthy();
});

it('annuler la confirmation n\'appelle jamais deleteCategory', async () => {
  mockedApi.listCategories.mockResolvedValue([HOUSEHOLD_CATEGORY]);
  mockConfirmAlert('Annuler');

  await render(<CategoriesScreen />);
  await waitFor(() => screen.getByTestId('category-delete-cat-h1'));

  await fireEvent.press(screen.getByTestId('category-delete-cat-h1'));

  expect(mockedApi.deleteCategory).not.toHaveBeenCalled();
});
