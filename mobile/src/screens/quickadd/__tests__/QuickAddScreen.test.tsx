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
jest.mock('../../../ui/useTopInset', () => ({ useTopInset: () => 16 }));
// La résolution réelle de @expo/vector-icons entraîne expo-font -> expo-asset
// (non installé dans ce projet) : mock minimal, comme dans HomeScreen.test.tsx.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return { Ionicons: (props: any) => React.createElement('Ionicons', props) };
});

jest.mock('../../../ui/DateField', () => {
  const { TextInput } = require('react-native');
  return {
    DateField: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) => (
      <TextInput testID={label ? `date-${label}` : 'date-field'} value={value} onChangeText={onChange} />
    ),
  };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: { mode?: string; accountId?: string } = {};
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
    createRecurringTransfer: jest.fn(),
    createIncomeSource: jest.fn(),
    createIncomeOccurrence: jest.fn(),
    confirmIncomeOccurrence: jest.fn(),
    createChargePlan: jest.fn(),
    createDeadline: jest.fn(),
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
  mockedApi.createIncomeSource.mockResolvedValue({ id: 'src-1' });
  mockedApi.createIncomeOccurrence.mockResolvedValue({ id: 'occ-1' });
  mockedApi.confirmIncomeOccurrence.mockResolvedValue({});
  mockedApi.createChargePlan.mockResolvedValue({ id: 'plan-1' });
  mockedApi.createDeadline.mockResolvedValue({});
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
// Corrections consolidées §7 — arrivée depuis "AJOUTER UNE TRANSACTION" sur la
// fiche compte : préremplit ce compte, sans jamais l'imposer (Select modifiable).
it('corrections consolidées §7 — accountId en paramètre de route préremplit le compte, en priorité sur le compte favori', async () => {
  mockRouteParams = { mode: 'depense', accountId: 'acc-2' };
  mockedApi.listAccounts.mockResolvedValue([
    { id: 'acc-1', name: 'Compte SG' },
    { id: 'acc-2', name: 'Compte BP' },
  ]);
  mockedApi.getQuickAddDefaultAccount.mockResolvedValue({ accountId: 'acc-1' });
  mockedApi.listCategoryTypes.mockResolvedValue([]);
  await renderScreen();

  await waitFor(() => expect(screen.getByText('Compte BP')).toBeTruthy());
});

// Correction UX (date réelle éditable) : "+ Ajouter une dépense" n'avait aucun
// champ date (toujours aujourd'hui, silencieusement) — désormais pré-rempli
// avec aujourd'hui mais modifiable, envoyé comme spentDate.
it("la date de la dépense est pré-remplie avec aujourd'hui, mais reste modifiable — envoie la date corrigée à createExpense", async () => {
  mockRouteParams = { mode: 'depense' };
  mockedApi.listCategoryTypes.mockResolvedValue([]);
  await renderScreen();

  await waitFor(() => expect(screen.getByTestId('date-Date de la dépense')).toBeTruthy());
  expect(screen.getByTestId('date-Date de la dépense').props.value).toBeTruthy();

  await fireEvent.changeText(screen.getByTestId('date-Date de la dépense'), '2026-09-10');
  await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '100');
  await fireEvent.press(screen.getByText('Enregistrer'));

  await waitFor(() => expect(mockedApi.createExpense).toHaveBeenCalledWith(expect.objectContaining({ spentDate: '2026-09-10' })));
});

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

  it('R6.2 §10-12 : basculer sur "Récurrent" crée un RecurringTransfer (objet séparé), jamais un transfert ponctuel', async () => {
    mockedApi.createRecurringTransfer.mockResolvedValue({ id: 'rt-1' });
    await render(<QuickAddScreen />);
    await waitFor(() => screen.getByTestId('quickadd-transfer-kind-recurrent'));

    await fireEvent.press(screen.getByTestId('quickadd-transfer-kind-recurrent'));
    await fireEvent.changeText(screen.getByTestId('quickadd-transfer-label-input'), 'Épargne Lamiaa');
    await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '1000');
    await fireEvent.press(screen.getByTestId('quickadd-dest-account-select'));
    await fireEvent.press(await screen.findByTestId('quickadd-dest-account-select-option-acc-2'));
    await fireEvent.changeText(screen.getByTestId('date-Prochain transfert'), '2026-09-28');

    await fireEvent.press(screen.getByText('CRÉER LE TRANSFERT RÉCURRENT'));

    await waitFor(() =>
      expect(mockedApi.createRecurringTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Épargne Lamiaa',
          fromAccountId: 'acc-1',
          toAccountId: 'acc-2',
          amount: 1000,
          recurrenceRule: 'mensuel',
          recurrenceAnchorDate: '2026-09-28',
        }),
      ),
    );
    expect(mockedApi.createTransfer).not.toHaveBeenCalled();
  });
});

/**
 * NOUVELLE ÉVOLUTION — Réalisé/Reçu vs À venir : les 4 cas doivent réutiliser
 * exactement les moteurs existants (AdHocExpense/BudgetExpense, IncomeOccurrence,
 * ChargePlan+Deadline ponctuel via le même chemin que "Charge prévisionnelle"),
 * jamais un second moteur de prévision.
 */
describe('QuickAddScreen — Réalisé/Reçu vs À venir', () => {
  it('le segment Réalisé/À venir n\'apparaît ni pour Transfert ni pour la sélection d\'Échéance', async () => {
    mockRouteParams = { mode: 'transfert' };
    mockedApi.listAccounts.mockResolvedValue([{ id: 'acc-1', name: 'Compte SG', soldeCourant: 1000 }]);
    await render(<QuickAddScreen />);
    await waitFor(() => screen.getByTestId('quickadd-account-select'));
    expect(screen.queryByTestId('quickadd-status-toggle')).toBeNull();

    mockRouteParams = { mode: 'paiement' };
    await render(<QuickAddScreen />);
    await waitFor(() => screen.getByText("Aucune échéance ouverte pour l'instant."));
    expect(screen.queryByTestId('quickadd-status-toggle')).toBeNull();
  });

  it('Cas A — Dépense réalisée (par défaut) : createExpense, jamais un ChargePlan', async () => {
    mockRouteParams = { mode: 'depense' };
    mockedApi.listCategoryTypes.mockResolvedValue([]);
    await renderScreen();

    await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '100');
    await fireEvent.press(screen.getByText('Enregistrer'));

    await waitFor(() => expect(mockedApi.createExpense).toHaveBeenCalled());
    expect(mockedApi.createChargePlan).not.toHaveBeenCalled();
  });

  it('Cas C — Dépense à venir : réutilise EXACTEMENT le moteur ChargePlan+Deadline ponctuel, jamais createExpense', async () => {
    mockRouteParams = { mode: 'depense' };
    mockedApi.listCategoryTypes.mockResolvedValue([]);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('quickadd-status-a_venir'));
    await waitFor(() => screen.getByTestId('quickadd-label-input'));
    await fireEvent.changeText(screen.getByTestId('quickadd-label-input'), 'Loyer');
    await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '1200');
    await fireEvent.press(screen.getByText('Planifier'));

    await waitFor(() => expect(mockedApi.createChargePlan).toHaveBeenCalled());
    expect(mockedApi.createChargePlan).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Loyer', defaultAccountId: 'acc-1' }),
    );
    expect(mockedApi.createDeadline).toHaveBeenCalledWith(
      'plan-1',
      expect.objectContaining({ amountStatus: 'confirme', amountCurrent: 1200 }),
    );
    expect(mockedApi.createExpense).not.toHaveBeenCalled();
  });

  it('Cas C — le libellé est obligatoire (comme pour "Charge prévisionnelle")', async () => {
    mockRouteParams = { mode: 'depense' };
    mockedApi.listCategoryTypes.mockResolvedValue([]);
    await renderScreen();

    await fireEvent.press(screen.getByTestId('quickadd-status-a_venir'));
    await waitFor(() => screen.getByTestId('quickadd-label-input'));
    await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '1200');
    await fireEvent.press(screen.getByText('Planifier'));

    await waitFor(() => screen.getByText('Un libellé est requis'));
    expect(mockedApi.createChargePlan).not.toHaveBeenCalled();
  });

  it('Cas B — Revenu reçu : source + occurrence + confirmation immédiate (comportement historique)', async () => {
    mockRouteParams = { mode: 'revenu' };
    await render(<QuickAddScreen />);
    await waitFor(() => screen.getByTestId('quickadd-label-input'));

    await fireEvent.changeText(screen.getByTestId('quickadd-label-input'), 'Salaire');
    await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '10000');
    await fireEvent.press(screen.getByText('Enregistrer'));

    await waitFor(() => expect(mockedApi.confirmIncomeOccurrence).toHaveBeenCalled());
    expect(mockedApi.createIncomeSource).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Salaire', usualAmount: 10000, defaultAccountId: 'acc-1' }),
    );
    expect(mockedApi.createIncomeOccurrence).toHaveBeenCalledWith('src-1', expect.objectContaining({ plannedAmount: 10000 }));
    expect(mockedApi.confirmIncomeOccurrence).toHaveBeenCalledWith('occ-1', expect.objectContaining({ actualAmount: 10000, accountId: 'acc-1' }));
  });

  it('Cas D — Revenu à venir : source + occurrence "prevu", JAMAIS de confirmation (le compte n\'est pas crédité)', async () => {
    mockRouteParams = { mode: 'revenu' };
    await render(<QuickAddScreen />);
    await waitFor(() => screen.getByTestId('quickadd-status-a_venir'));

    await fireEvent.press(screen.getByTestId('quickadd-status-a_venir'));
    expect(screen.getByText('Compte à créditer')).toBeTruthy();

    await waitFor(() => screen.getByTestId('date-Date prévue'));
    await fireEvent.changeText(screen.getByTestId('quickadd-label-input'), 'Prime');
    await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '5000');
    await fireEvent.changeText(screen.getByTestId('date-Date prévue'), '2026-10-15');
    await fireEvent.press(screen.getByText('Planifier'));

    await waitFor(() => expect(mockedApi.createIncomeOccurrence).toHaveBeenCalled());
    expect(mockedApi.createIncomeOccurrence).toHaveBeenCalledWith('src-1', { usualDate: '2026-10-15', plannedAmount: 5000 });
    expect(mockedApi.confirmIncomeOccurrence).not.toHaveBeenCalled();
  });

  it('la date de réception d\'un revenu reçu est pré-remplie avec aujourd\'hui mais reste modifiable', async () => {
    mockRouteParams = { mode: 'revenu' };
    await render(<QuickAddScreen />);
    await waitFor(() => screen.getByTestId('date-Date de réception'));
    expect(screen.getByTestId('date-Date de réception').props.value).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('date-Date de réception'), '2026-09-12');
    await fireEvent.changeText(screen.getByTestId('quickadd-label-input'), 'Salaire');
    await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '9000');
    await fireEvent.press(screen.getByText('Enregistrer'));

    await waitFor(() =>
      expect(mockedApi.confirmIncomeOccurrence).toHaveBeenCalledWith('occ-1', expect.objectContaining({ actualDate: '2026-09-12' })),
    );
  });
});
