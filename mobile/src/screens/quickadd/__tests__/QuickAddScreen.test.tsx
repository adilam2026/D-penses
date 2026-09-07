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
let mockRouteParams: { mode?: string } = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: mockRouteParams }),
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
    createTransfer: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

const CATEGORY_ALIMENTATION = { id: 'cat-alim', name: 'Alimentation', kind: 'expense' as const };
const CATEGORY_TRANSPORT = { id: 'cat-transport', name: 'Transport', kind: 'expense' as const };

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = {};
  mockedApi.listAccounts.mockResolvedValue([{ id: 'acc-1', name: 'Compte SG' }]);
  mockedApi.getQuickAddDefaultAccount.mockResolvedValue({ accountId: 'acc-1' });
  mockedApi.listCategories.mockResolvedValue([CATEGORY_ALIMENTATION, CATEGORY_TRANSPORT]);
  mockedApi.listOpenDeadlines.mockResolvedValue([]);
  mockedApi.findActiveBudgetsForCategory.mockResolvedValue([]);
  mockedApi.createExpense.mockResolvedValue({ kind: 'adhoc_expense', expense: {}, soldeCourant: 0 });
});

async function renderScreen() {
  await render(<QuickAddScreen />);
  await waitFor(() => screen.getByTestId('quickadd-category-select'));
}

// §8 (recette téléphone réel) : la catégorie est désormais un Select compact
// (bottom sheet), plus une liste de chips permanente — ouvrir puis choisir.
async function selectCategory(categoryId: string) {
  await fireEvent.press(screen.getByTestId('quickadd-category-select'));
  await fireEvent.press(await screen.findByTestId(`quickadd-category-select-option-${categoryId}`));
}

// R6 finition UX/UI §2 — au-delà de 4 types actifs, sélecteur compact plutôt qu'un mur de chips.
describe('QuickAddScreen — Type en sélecteur compact au-delà de 4 choix', () => {
  it('plus de 4 types actifs → Select au lieu des chips', async () => {
    mockedApi.listCategoryTypes.mockResolvedValue([
      { id: 't1', name: 'Courses', active: true, subtypes: [] },
      { id: 't2', name: 'Restaurant', active: true, subtypes: [] },
      { id: 't3', name: 'Carburant', active: true, subtypes: [] },
      { id: 't4', name: 'Loisirs', active: true, subtypes: [] },
      { id: 't5', name: 'Santé', active: true, subtypes: [] },
    ]);
    await renderScreen();
    await selectCategory('cat-alim');

    await waitFor(() => expect(screen.getByTestId('quickadd-type-select')).toBeTruthy());
    expect(screen.queryByTestId('type-chip-Courses')).toBeNull();

    fireEvent.press(screen.getByTestId('quickadd-type-select'));
    await waitFor(() => expect(screen.getByTestId('quickadd-type-select-option-t3')).toBeTruthy());
  });
});

describe('QuickAddScreen — Catégorie → Type → Sous-type (Vague 2 §21)', () => {
  it('sélectionner une catégorie charge et affiche uniquement les types de CETTE catégorie', async () => {
    mockedApi.listCategoryTypes.mockResolvedValue([
      { id: 'type-courses', name: 'Courses', active: true, subtypes: [] },
      { id: 'type-restaurant', name: 'Restaurant', active: true, subtypes: [] },
    ]);
    await renderScreen();

    await selectCategory('cat-alim');

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
    await selectCategory('cat-alim');
    await screen.findByTestId('type-chip-Courses');

    await fireEvent.press(screen.getByTestId('type-chip-Courses'));

    expect(await screen.findByTestId('subtype-chip-Viande')).toBeTruthy();
    expect(screen.queryByTestId('subtype-chip-Fast-food')).toBeNull();
  });

  it("aucun sous-type existant → le champ sous-type n'affiche pas de chips, seulement le lien pour en créer un", async () => {
    mockedApi.listCategoryTypes.mockResolvedValue([{ id: 'type-courses', name: 'Courses', active: true, subtypes: [] }]);
    await renderScreen();
    await selectCategory('cat-alim');
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
    await selectCategory('cat-alim');
    await fireEvent.press(await screen.findByTestId('type-chip-Courses'));

    await selectCategory('cat-transport');

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
    await selectCategory('cat-alim');
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

/**
 * Recette téléphone réel §10 (BUG BLOQUANT corrigé) : sélectionner une échéance
 * dans "Ajouter > Échéance" ouvrait un formulaire inline sans retour visuel
 * clair — désormais un seul parcours de paiement partagé (DeadlineDetailScreen,
 * le même qu'Accueil/Plan financier/Calendrier) : sélectionner navigue
 * IMMÉDIATEMENT, jamais une sélection silencieuse.
 */
describe('QuickAddScreen — Ajouter > Échéance (§10, bug bloquant corrigé)', () => {
  beforeEach(() => {
    mockRouteParams = { mode: 'paiement' };
    mockedApi.listOpenDeadlines.mockResolvedValue([
      { id: 'dl-1', dueDate: '2026-09-30', resteAPayer: 1950, provisionId: null, chargePlan: { label: 'Restauration T1' } },
    ]);
  });

  it('sélectionner une échéance navigue directement vers DeadlineDetail (parcours de paiement unique)', async () => {
    await render(<QuickAddScreen />);
    await waitFor(() => screen.getByTestId('pick-deadline-dl-1'));

    await fireEvent.press(screen.getByTestId('pick-deadline-dl-1'));

    expect(mockNavigate).toHaveBeenCalledWith('DeadlineDetail', { id: 'dl-1' });
  });

  it('aucune échéance ouverte → message explicite, jamais une liste vide silencieuse', async () => {
    mockedApi.listOpenDeadlines.mockResolvedValue([]);
    await render(<QuickAddScreen />);

    await waitFor(() => screen.getByText("Aucune échéance ouverte pour l'instant."));
    expect(screen.queryByText('Enregistrer')).toBeNull();
  });
});

/**
 * Recette téléphone réel §11 : le transfert affiche désormais les soldes réels
 * par compte et un aperçu "avant/après" recalculé en direct, jamais après coup.
 */
describe('QuickAddScreen — Transfert entre comptes (§11)', () => {
  beforeEach(() => {
    mockRouteParams = { mode: 'transfert' };
    mockedApi.listAccounts.mockResolvedValue([
      { id: 'acc-1', name: 'Compte courant', soldeCourant: 4750 },
      { id: 'acc-2', name: 'Maison', soldeCourant: 700 },
    ]);
    mockedApi.getQuickAddDefaultAccount.mockResolvedValue({ accountId: 'acc-1' });
  });

  it('affiche le solde de chaque compte source/destination (sélecteur compact §6)', async () => {
    await render(<QuickAddScreen />);
    await waitFor(() => screen.getByTestId('quickadd-account-select'));

    await fireEvent.press(screen.getByTestId('quickadd-account-select'));
    expect(await screen.findByTestId('quickadd-account-select-option-acc-1')).toBeTruthy();
    expect(screen.getByText('4 750 DH')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('quickadd-account-select-option-acc-1'));

    await fireEvent.press(screen.getByTestId('quickadd-dest-account-select'));
    expect(await screen.findByTestId('quickadd-dest-account-select-option-acc-2')).toBeTruthy();
    expect(screen.getByText('700 DH')).toBeTruthy();
  });

  it('saisir un montant + choisir une destination affiche l\'aperçu avant/après, recalculé en direct', async () => {
    await render(<QuickAddScreen />);
    await waitFor(() => screen.getByTestId('quickadd-dest-account-select'));

    await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '1000');
    await fireEvent.press(screen.getByTestId('quickadd-dest-account-select'));
    await fireEvent.press(await screen.findByTestId('quickadd-dest-account-select-option-acc-2'));

    const preview = screen.getByTestId('transfer-preview');
    expect(preview).toBeTruthy();
    expect(screen.getByText('4 750 → 3 750 DH')).toBeTruthy();
    expect(screen.getByText('700 → 1 700 DH')).toBeTruthy();

    // Changer le montant recalcule immédiatement l'aperçu.
    await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '2000');
    expect(screen.getByText('4 750 → 2 750 DH')).toBeTruthy();
    expect(screen.getByText('700 → 2 700 DH')).toBeTruthy();
  });

  it('le compte source n\'apparaît jamais dans la liste des destinations possibles', async () => {
    await render(<QuickAddScreen />);
    await waitFor(() => screen.getByTestId('quickadd-dest-account-select'));

    await fireEvent.press(screen.getByTestId('quickadd-dest-account-select'));

    // "Compte courant" (source par défaut, acc-1) doit être absent des options de destination.
    expect(await screen.findByTestId('quickadd-dest-account-select-option-acc-2')).toBeTruthy();
    expect(screen.queryByTestId('quickadd-dest-account-select-option-acc-1')).toBeNull();
  });

  it('bouton de confirmation libellé "CONFIRMER LE TRANSFERT" et interdit montant<=0', async () => {
    await render(<QuickAddScreen />);
    await waitFor(() => screen.getByText('CONFIRMER LE TRANSFERT'));

    await fireEvent.press(screen.getByText('CONFIRMER LE TRANSFERT'));

    await waitFor(() => screen.getByText('Montant invalide'));
    expect(mockedApi.createTransfer).not.toHaveBeenCalled();
  });
});
