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
  return { ...actual, listCategories: jest.fn(), listCategoryTypes: jest.fn(), createVariableBudget: jest.fn() };
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

// M3 — le libellé est désormais requis avant toute soumission.
async function fillLabel() {
  fireEvent.changeText(screen.getByTestId('create-budget-label-input'), 'Courses');
  await flush();
}

describe('CreateBudgetScreen — mode du mois (Lot 6)', () => {
  beforeEach(() => {
    mockedApi.listCategories.mockResolvedValue(categories);
    mockedApi.listCategoryTypes.mockResolvedValue([]);
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
    await fillLabel();
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
    await fillLabel();
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
    await fillLabel();
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
    await fillLabel();
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

/**
 * Mini-lot includeInPrudentProjection — switch visible pour semaine ET mois
 * (jamais masqué selon la périodicité), activé par défaut (même défaut que le
 * backend), toujours envoyé explicitement (jamais omis du payload).
 */
describe('CreateBudgetScreen — includeInPrudentProjection (mini-lot)', () => {
  beforeEach(() => {
    mockedApi.listCategories.mockResolvedValue(categories);
    mockedApi.listCategoryTypes.mockResolvedValue([]);
    mockedApi.createVariableBudget.mockResolvedValue({ id: 'b1' } as any);
  });

  it('le switch est visible et activé par défaut', async () => {
    await render(<CreateBudgetScreen />);
    await waitFor(() => screen.getByTestId('create-budget-category-select'));
    const switchEl = screen.getByTestId('create-budget-include-prudent-switch');
    expect(switchEl).toBeTruthy();
    expect(switchEl.props.value).toBe(true);
  });

  it('non touché : includeInPrudentProjection=true envoyé au create', async () => {
    await render(<CreateBudgetScreen />);
    await waitFor(() => screen.getByTestId('create-budget-category-select'));
    await selectCategory();
    await fillLabel();
    fireEvent.changeText(screen.getByTestId('create-budget-amount-input'), '1000');
    await flush();

    await fireEvent.press(screen.getByTestId('create-budget-submit'));
    await waitFor(() =>
      expect(mockedApi.createVariableBudget).toHaveBeenCalledWith(expect.objectContaining({ includeInPrudentProjection: true })),
    );
  });

  it('désactivé : includeInPrudentProjection=false envoyé au create', async () => {
    await render(<CreateBudgetScreen />);
    await waitFor(() => screen.getByTestId('create-budget-category-select'));
    await selectCategory();
    await fillLabel();
    fireEvent.changeText(screen.getByTestId('create-budget-amount-input'), '1000');
    await flush();
    await fireEvent(screen.getByTestId('create-budget-include-prudent-switch'), 'valueChange', false);
    await flush();

    await fireEvent.press(screen.getByTestId('create-budget-submit'));
    await waitFor(() =>
      expect(mockedApi.createVariableBudget).toHaveBeenCalledWith(expect.objectContaining({ includeInPrudentProjection: false })),
    );
  });
});

/**
 * M3 — libellé libre requis, types suivis facultatifs (multi-CategoryType).
 */
describe('CreateBudgetScreen — M3 (libellé requis, types suivis)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedApi.listCategories.mockResolvedValue(categories);
    mockedApi.listCategoryTypes.mockResolvedValue([]);
    mockedApi.createVariableBudget.mockResolvedValue({ id: 'b1' } as any);
  });

  it('soumission bloquée sans libellé, aucun appel API', async () => {
    await render(<CreateBudgetScreen />);
    await waitFor(() => screen.getByTestId('create-budget-category-select'));
    await selectCategory();
    fireEvent.changeText(screen.getByTestId('create-budget-amount-input'), '1000');
    await flush();

    await fireEvent.press(screen.getByTestId('create-budget-submit'));
    await waitFor(() => screen.getByText('Le libellé est obligatoire'));
    expect(mockedApi.createVariableBudget).not.toHaveBeenCalled();
  });

  it('le libellé et categoryTypeIds=[] (toute la catégorie) sont envoyés au create', async () => {
    await render(<CreateBudgetScreen />);
    await waitFor(() => screen.getByTestId('create-budget-category-select'));
    await selectCategory();
    await fillLabel();
    fireEvent.changeText(screen.getByTestId('create-budget-amount-input'), '1000');
    await flush();

    await fireEvent.press(screen.getByTestId('create-budget-submit'));
    await waitFor(() =>
      expect(mockedApi.createVariableBudget).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Courses', categoryTypeIds: [] }),
      ),
    );
  });

  it('aucun sélecteur de types tant que la catégorie choisie ne compte aucun CategoryType', async () => {
    await render(<CreateBudgetScreen />);
    await waitFor(() => screen.getByTestId('create-budget-category-select'));
    await selectCategory();
    expect(screen.queryByTestId('create-budget-category-types')).toBeNull();
  });

  it('les types sélectionnés dans le MultiSelect sont envoyés dans categoryTypeIds', async () => {
    mockedApi.listCategoryTypes.mockResolvedValue([
      { id: 't1', name: 'Supermarché', active: true },
      { id: 't2', name: 'Marché', active: true },
    ]);
    await render(<CreateBudgetScreen />);
    await waitFor(() => screen.getByTestId('create-budget-category-select'));
    await selectCategory();
    await fillLabel();
    await waitFor(() => screen.getByTestId('create-budget-category-types'));

    await fireEvent.press(screen.getByTestId('create-budget-category-types'));
    await flush();
    await fireEvent.press(await screen.findByTestId('create-budget-category-types-option-t1'));
    await flush();

    fireEvent.changeText(screen.getByTestId('create-budget-amount-input'), '1000');
    await flush();
    await fireEvent.press(screen.getByTestId('create-budget-submit'));
    await waitFor(() =>
      expect(mockedApi.createVariableBudget).toHaveBeenCalledWith(expect.objectContaining({ categoryTypeIds: ['t1'] })),
    );
  });
});
