import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { CreateBudgetScreen } from '../CreateBudgetScreen';
import * as api from '../../../api/client';

/**
 * Lot 6 — mode du mois (CALENDAR/FINANCIAL/CUSTOM) sur l'écran de création de
 * budget. Le sélecteur de mode n'apparaît que pour period='mois' (inerte pour
 * 'semaine') ; le jour de départ personnalisé n'apparaît que pour monthMode=
 * 'personnalise' et est requis avant soumission.
 */
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));
jest.mock('../../../ui/useKeyboardAwareScroll', () => ({
  useKeyboardAwareScroll: () => ({ scrollRef: { current: null }, handleFocus: jest.fn() }),
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { ...actual, listCategories: jest.fn(), createVariableBudget: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

const categories = [{ id: 'cat-1', name: 'Alimentation', kind: 'expense' as const }];

/**
 * Barrière de synchronisation générique : cet environnement de test (jest-expo/
 * RNTL) ne garantit pas qu'un `fireEvent` isolé suffise à committer son état
 * avant l'interaction suivante lorsque plusieurs interactions s'enchaînent
 * rapidement (observé empiriquement — la mise à jour suivant immédiatement une
 * pression peut sinon être silencieusement perdue). `waitFor` sur un élément
 * toujours présent force le tick nécessaire sans dépendre d'un état particulier.
 */
async function flush() {
  await waitFor(() => screen.getByTestId('create-budget-submit'));
}

async function selectCategory() {
  await fireEvent.press(screen.getByTestId('create-budget-category-select'));
  await flush();
  await fireEvent.press(await screen.findByTestId('create-budget-category-select-option-cat-1'));
  await flush();
}

describe('CreateBudgetScreen — mode du mois (Lot 6)', () => {
  beforeEach(() => {
    mockedApi.listCategories.mockResolvedValue(categories);
    mockedApi.createVariableBudget.mockResolvedValue({ id: 'b1' } as any);
  });

  it("aucun sélecteur de mode du mois tant que period='semaine' (défaut)", async () => {
    await render(<CreateBudgetScreen />);
    await waitFor(() => screen.getByTestId('create-budget-category-select'));
    expect(screen.queryByText('Mode du mois')).toBeNull();
  });

  it("le sélecteur de mode apparaît pour period='mois', calendaire par défaut", async () => {
    await render(<CreateBudgetScreen />);
    await waitFor(() => screen.getByTestId('create-budget-category-select'));
    await fireEvent.press(screen.getByText('Mois'));
    await flush();
    expect(screen.getByText('Mode du mois')).toBeTruthy();
    expect(screen.queryByTestId('create-budget-custom-start-day-input')).toBeNull();
  });

  it("sélectionner Personnalisé affiche le champ jour de départ ; le choisir Financier le masque", async () => {
    await render(<CreateBudgetScreen />);
    await waitFor(() => screen.getByTestId('create-budget-category-select'));
    await fireEvent.press(screen.getByText('Mois'));
    await flush();
    await fireEvent.press(await screen.findByTestId('create-budget-month-mode-personnalise'));
    await flush();
    expect(screen.getByTestId('create-budget-custom-start-day-input')).toBeTruthy();

    await fireEvent.press(await screen.findByTestId('create-budget-month-mode-financier'));
    await flush();
    expect(screen.queryByTestId('create-budget-custom-start-day-input')).toBeNull();
  });

  it("monthMode=personnalise sans jour de départ : erreur, aucun appel API", async () => {
    await render(<CreateBudgetScreen />);
    await waitFor(() => screen.getByTestId('create-budget-category-select'));
    await selectCategory();
    fireEvent.changeText(screen.getByTestId('create-budget-amount-input'), '1000');
    await flush();
    await fireEvent.press(screen.getByText('Mois'));
    await flush();
    await fireEvent.press(screen.getByTestId('create-budget-month-mode-personnalise'));
    await flush();
    // Confirme que l'état monthMode='personnalise' est bien commis avant de
    // soumettre (le champ ne s'affiche QUE dans ce mode).
    expect(screen.getByTestId('create-budget-custom-start-day-input')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('create-budget-submit'));
    await waitFor(() => screen.getByText('Indiquez le jour de départ personnalisé'));
    expect(mockedApi.createVariableBudget).not.toHaveBeenCalled();
  });

  it("monthMode=financier soumis correctement, customStartDay omis", async () => {
    await render(<CreateBudgetScreen />);
    await waitFor(() => screen.getByTestId('create-budget-category-select'));
    await selectCategory();
    fireEvent.changeText(screen.getByTestId('create-budget-amount-input'), '1000');
    await flush();
    await fireEvent.press(screen.getByText('Mois'));
    await flush();
    await fireEvent.press(screen.getByTestId('create-budget-month-mode-financier'));
    await flush();

    await fireEvent.press(screen.getByTestId('create-budget-submit'));
    await waitFor(() =>
      expect(mockedApi.createVariableBudget).toHaveBeenCalledWith(
        expect.objectContaining({ monthMode: 'financier', customStartDay: undefined }),
      ),
    );
  });

  it("monthMode=personnalise avec jour de départ 25 : soumis avec customStartDay=25", async () => {
    await render(<CreateBudgetScreen />);
    await waitFor(() => screen.getByTestId('create-budget-category-select'));
    await selectCategory();
    fireEvent.changeText(screen.getByTestId('create-budget-amount-input'), '1000');
    await flush();
    await fireEvent.press(screen.getByText('Mois'));
    await flush();
    await fireEvent.press(screen.getByTestId('create-budget-month-mode-personnalise'));
    await flush();
    const dayInput = screen.getByTestId('create-budget-custom-start-day-input');
    fireEvent.changeText(dayInput, '25');
    await flush();

    await fireEvent.press(screen.getByTestId('create-budget-submit'));
    await waitFor(() =>
      expect(mockedApi.createVariableBudget).toHaveBeenCalledWith(
        expect.objectContaining({ monthMode: 'personnalise', customStartDay: 25 }),
      ),
    );
  });

  it("period='semaine' : monthMode/customStartDay jamais envoyés, même si le formulaire a d'abord été rempli", async () => {
    await render(<CreateBudgetScreen />);
    await waitFor(() => screen.getByTestId('create-budget-category-select'));
    await selectCategory();
    fireEvent.changeText(screen.getByTestId('create-budget-amount-input'), '1000');
    await flush();

    await fireEvent.press(screen.getByTestId('create-budget-submit'));
    await waitFor(() =>
      expect(mockedApi.createVariableBudget).toHaveBeenCalledWith(
        expect.objectContaining({ referencePeriod: 'semaine', monthMode: undefined, customStartDay: undefined }),
      ),
    );
  });
});
