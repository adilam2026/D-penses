import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { CategoriesScreen } from '../CategoriesScreen';
import * as api from '../../../api/client';

/**
 * Corrections UI/UX finales §10 — Ajouter/Modifier/Supprimer, y compris pour
 * une catégorie Système (jamais bloquée en lecture seule) : chaque catégorie
 * a un menu "..." (Modifier/Supprimer), la confirmation destructive reste
 * explicite (§12 — jamais un DELETE silencieux), le message d'erreur backend
 * réel (400, hors "utilisée") est affiché tel quel.
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
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => require('react').createElement(Text, null, props.name) };
});

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    listCategories: jest.fn(),
    createCategory: jest.fn(),
    updateCategory: jest.fn(),
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

it('une catégorie système affiche aussi le menu "..." (Modifier/Supprimer) — jamais en lecture seule', async () => {
  mockedApi.listCategories.mockResolvedValue([SYSTEM_CATEGORY]);
  await render(<CategoriesScreen />);

  await waitFor(() => screen.getByText('Alimentation'));
  await fireEvent.press(screen.getByTestId(`category-menu-${SYSTEM_CATEGORY.id}`));

  await waitFor(() => expect(screen.getByTestId('category-menu-option-modifier')).toBeTruthy());
  expect(screen.getByTestId('category-menu-option-supprimer')).toBeTruthy();
});

it('Modifier renomme une catégorie système via updateCategory', async () => {
  mockedApi.listCategories.mockResolvedValue([SYSTEM_CATEGORY]);
  mockedApi.updateCategory.mockResolvedValue({ ...SYSTEM_CATEGORY, name: 'Courses' });
  await render(<CategoriesScreen />);

  await waitFor(() => screen.getByText('Alimentation'));
  await fireEvent.press(screen.getByTestId(`category-menu-${SYSTEM_CATEGORY.id}`));
  await waitFor(() => expect(screen.getByTestId('category-menu-option-modifier')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('category-menu-option-modifier'));

  await waitFor(() => expect(screen.getByTestId('category-edit-form')).toBeTruthy());
  await fireEvent.changeText(screen.getByTestId('category-edit-name-input'), 'Courses');
  await fireEvent.press(screen.getByTestId('category-edit-kind-income'));
  await fireEvent.press(screen.getByTestId('category-edit-save'));

  await waitFor(() => expect(mockedApi.updateCategory).toHaveBeenCalledWith('cat-sys', { name: 'Courses', kind: 'income' }));
});

it('une catégorie du foyer inutilisée se retire après confirmation (deleteCategory), la liste est rafraîchie', async () => {
  mockedApi.listCategories.mockResolvedValueOnce([HOUSEHOLD_CATEGORY]).mockResolvedValueOnce([]);
  mockedApi.deleteCategory.mockResolvedValue({ archived: false });
  const alertSpy = mockConfirmAlert('Retirer');

  await render(<CategoriesScreen />);
  await waitFor(() => screen.getByTestId(`category-menu-${HOUSEHOLD_CATEGORY.id}`));
  await fireEvent.press(screen.getByTestId(`category-menu-${HOUSEHOLD_CATEGORY.id}`));
  await waitFor(() => expect(screen.getByTestId('category-menu-option-supprimer')).toBeTruthy());

  await fireEvent.press(screen.getByTestId('category-menu-option-supprimer'));

  expect(alertSpy).toHaveBeenCalledWith('Retirer cette catégorie ?', expect.stringContaining('Cadeaux'), expect.any(Array));
  await waitFor(() => expect(mockedApi.deleteCategory).toHaveBeenCalledWith('cat-h1'));
  await waitFor(() => expect(mockedApi.listCategories).toHaveBeenCalledTimes(2)); // chargement initial + refresh
  await waitFor(() => expect(screen.queryByText('Cadeaux')).toBeNull());
});

// Corrections UI/UX finales §10 — une catégorie déjà utilisée n'est plus
// jamais un refus bloquant côté backend (archivage silencieux, {archived:
// true}) : elle disparaît simplement de la liste comme n'importe quelle
// suppression réussie, aucun message d'erreur ici.
it('une catégorie déjà utilisée est archivée (deleteCategory résout {archived:true}), disparaît de la liste sans erreur', async () => {
  mockedApi.listCategories.mockResolvedValueOnce([HOUSEHOLD_CATEGORY]).mockResolvedValueOnce([]);
  mockedApi.deleteCategory.mockResolvedValue({ archived: true });
  mockConfirmAlert('Retirer');

  await render(<CategoriesScreen />);
  await waitFor(() => screen.getByTestId(`category-menu-${HOUSEHOLD_CATEGORY.id}`));
  await fireEvent.press(screen.getByTestId(`category-menu-${HOUSEHOLD_CATEGORY.id}`));
  await waitFor(() => expect(screen.getByTestId('category-menu-option-supprimer')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('category-menu-option-supprimer'));

  await waitFor(() => expect(mockedApi.deleteCategory).toHaveBeenCalledWith('cat-h1'));
  await waitFor(() => expect(screen.queryByText('Cadeaux')).toBeNull());
});

it('une erreur backend réelle (hors archivage) est affichée telle quelle', async () => {
  mockedApi.listCategories.mockResolvedValue([HOUSEHOLD_CATEGORY]);
  mockedApi.deleteCategory.mockRejectedValue(new api.ApiError(403, "Impossible de supprimer une catégorie d'un autre foyer"));
  mockConfirmAlert('Retirer');

  await render(<CategoriesScreen />);
  await waitFor(() => screen.getByTestId('category-menu-cat-h1'));
  await fireEvent.press(screen.getByTestId('category-menu-cat-h1'));
  await waitFor(() => expect(screen.getByTestId('category-menu-option-supprimer')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('category-menu-option-supprimer'));

  await waitFor(() => expect(screen.getByText("Impossible de supprimer une catégorie d'un autre foyer")).toBeTruthy());
  // La catégorie n'a jamais été retirée de la liste — la suppression a échoué.
  expect(screen.getByText('Cadeaux')).toBeTruthy();
});

it('annuler la confirmation n\'appelle jamais deleteCategory', async () => {
  mockedApi.listCategories.mockResolvedValue([HOUSEHOLD_CATEGORY]);
  mockConfirmAlert('Annuler');

  await render(<CategoriesScreen />);
  await waitFor(() => screen.getByTestId('category-menu-cat-h1'));
  await fireEvent.press(screen.getByTestId('category-menu-cat-h1'));
  await waitFor(() => expect(screen.getByTestId('category-menu-option-supprimer')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('category-menu-option-supprimer'));

  expect(mockedApi.deleteCategory).not.toHaveBeenCalled();
});
