import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QuickAddScreen } from '../QuickAddScreen';
import * as api from '../../../api/client';

/**
 * Tests des pickers Catégorie → Type → Sous-type dans la saisie rapide
 * (Vague 2 §21) : filtrage en cascade, masquage du champ sous-type quand
 * aucun sous-type n'existe, création de type personnalisé.
 */
jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: {} }),
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    listAccounts: jest.fn(),
    getQuickAddDefaultAccount: jest.fn(),
    listCategories: jest.fn(),
    listOpenDeadlines: jest.fn(),
    findActiveBudgetsForCategory: jest.fn(),
    listCategoryTypes: jest.fn(),
    createCategoryType: jest.fn(),
    createCategorySubtype: jest.fn(),
    createExpense: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

const CATEGORY_ALIMENTATION = { id: 'cat-alim', name: 'Alimentation', kind: 'expense' as const };
const CATEGORY_TRANSPORT = { id: 'cat-transport', name: 'Transport', kind: 'expense' as const };

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listAccounts.mockResolvedValue([{ id: 'acc-1', name: 'Compte SG' }]);
  mockedApi.getQuickAddDefaultAccount.mockResolvedValue({ accountId: 'acc-1' });
  mockedApi.listCategories.mockResolvedValue([CATEGORY_ALIMENTATION, CATEGORY_TRANSPORT]);
  mockedApi.listOpenDeadlines.mockResolvedValue([]);
  mockedApi.findActiveBudgetsForCategory.mockResolvedValue([]);
  mockedApi.createExpense.mockResolvedValue({ kind: 'adhoc_expense', expense: {}, soldeCourant: 0 });
});

async function renderScreen() {
  await render(<QuickAddScreen />);
  await waitFor(() => screen.getByText('Alimentation'));
}

describe('QuickAddScreen — Catégorie → Type → Sous-type (Vague 2 §21)', () => {
  it('sélectionner une catégorie charge et affiche uniquement les types de CETTE catégorie', async () => {
    mockedApi.listCategoryTypes.mockResolvedValue([
      { id: 'type-courses', name: 'Courses', active: true, subtypes: [] },
      { id: 'type-restaurant', name: 'Restaurant', active: true, subtypes: [] },
    ]);
    await renderScreen();

    await fireEvent.press(screen.getByText('Alimentation'));

    await waitFor(() => expect(mockedApi.listCategoryTypes).toHaveBeenCalledWith('cat-alim'));
    expect(await screen.findByTestId('type-chip-Courses')).toBeTruthy();
    expect(screen.getByTestId('type-chip-Restaurant')).toBeTruthy();
  });

  it('sélectionner un type affiche uniquement SES sous-types, jamais ceux d\'un autre type', async () => {
    mockedApi.listCategoryTypes.mockResolvedValue([
      { id: 'type-courses', name: 'Courses', active: true, subtypes: [{ id: 'sub-viande', name: 'Viande', active: true }] },
      { id: 'type-restaurant', name: 'Restaurant', active: true, subtypes: [{ id: 'sub-fastfood', name: 'Fast-food', active: true }] },
    ]);
    await renderScreen();
    await fireEvent.press(screen.getByText('Alimentation'));
    await screen.findByTestId('type-chip-Courses');

    await fireEvent.press(screen.getByTestId('type-chip-Courses'));

    expect(await screen.findByTestId('subtype-chip-Viande')).toBeTruthy();
    expect(screen.queryByTestId('subtype-chip-Fast-food')).toBeNull();
  });

  it("aucun sous-type existant → le champ sous-type n'affiche pas de chips, seulement le lien pour en créer un", async () => {
    mockedApi.listCategoryTypes.mockResolvedValue([{ id: 'type-courses', name: 'Courses', active: true, subtypes: [] }]);
    await renderScreen();
    await fireEvent.press(screen.getByText('Alimentation'));
    await screen.findByTestId('type-chip-Courses');

    await fireEvent.press(screen.getByTestId('type-chip-Courses'));

    expect(screen.queryByText('Sous-type (facultatif)')).toBeNull();
    expect(await screen.findByText('+ Ajouter un sous-type pour ce type')).toBeTruthy();
  });

  it('changer de catégorie réinitialise le type sélectionné et recharge la liste de types', async () => {
    mockedApi.listCategoryTypes.mockImplementation((categoryId: string) =>
      Promise.resolve(
        categoryId === 'cat-alim'
          ? [{ id: 'type-courses', name: 'Courses', active: true, subtypes: [] }]
          : [{ id: 'type-carburant', name: 'Carburant', active: true, subtypes: [] }],
      ),
    );
    await renderScreen();
    await fireEvent.press(screen.getByText('Alimentation'));
    await fireEvent.press(await screen.findByTestId('type-chip-Courses'));

    await fireEvent.press(screen.getByText('Transport'));

    await waitFor(() => expect(mockedApi.listCategoryTypes).toHaveBeenCalledWith('cat-transport'));
    expect(await screen.findByTestId('type-chip-Carburant')).toBeTruthy();
    expect(screen.queryByTestId('type-chip-Courses')).toBeNull();
  });

  it('création de type personnalisé : sélectionné automatiquement et transmis à la création de la dépense', async () => {
    mockedApi.listCategoryTypes
      .mockResolvedValueOnce([]) // au chargement initial de la catégorie
      .mockResolvedValueOnce([{ id: 'type-jardinier', name: 'Jardinier', active: true, subtypes: [] }]); // après création
    mockedApi.createCategoryType.mockResolvedValue({ id: 'type-jardinier', name: 'Jardinier', active: true, isSystem: false });
    await renderScreen();
    await fireEvent.press(screen.getByText('Alimentation'));
    await screen.findByText('+ Ajouter un type pour cette catégorie');

    await fireEvent.press(screen.getByTestId('add-type-toggle'));
    await fireEvent.changeText(screen.getByTestId('add-type-input'), 'Jardinier');
    await fireEvent.press(screen.getByTestId('add-type-submit'));

    await waitFor(() => expect(mockedApi.createCategoryType).toHaveBeenCalledWith('cat-alim', { name: 'Jardinier' }));

    await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '150');
    await fireEvent.press(screen.getByText('Enregistrer'));

    await waitFor(() =>
      expect(mockedApi.createExpense).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: 'cat-alim', categoryTypeId: 'type-jardinier' }),
      ),
    );
  });
});
