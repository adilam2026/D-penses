import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { FinancialPlanDetailScreen } from '../FinancialPlanDetailScreen';
import * as api from '../../../api/client';

/**
 * Correctif critique post-Vague 3 (§11/§12) — le bouton "Payer" et le tap sur
 * une échéance à confirmer utilisaient `navigation.getParent()?.navigate(...)`.
 * FinancialPlanDetailScreen est un Stack.Screen RACINE (RootNavigator), pas un
 * écran imbriqué dans RootTabs : `getParent()` y retourne toujours undefined,
 * donc `?.navigate(...)` ne faisait STRICTEMENT rien (bug identique à celui
 * déjà corrigé sur EpargneScreen). Ces tests prouvent que le tap déclenche
 * réellement la navigation (plain `navigate`), pas seulement qu'aucune erreur
 * n'est levée.
 */
jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockGoBack = jest.fn();
const mockGetParent = jest.fn(() => undefined); // simule fidèlement un Stack.Screen racine
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, replace: mockReplace, goBack: mockGoBack, getParent: mockGetParent }),
  useRoute: () => ({ params: { id: 'plan-1' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

// expo-font/expo-asset ne résolvent pas sous Jest dans cet environnement (frontière
// mockée, pas le comportement — seule l'icône réellement affichée nous importe ici).
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => Text != null && require('react').createElement(Text, null, props.name) };
});

jest.mock('../../../ui/DateField', () => {
  const { TextInput } = require('react-native');
  return {
    DateField: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) => (
      <TextInput testID={label ? `date-${label}` : 'date-field'} value={value} onChangeText={onChange} />
    ),
  };
});

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    getFinancialPlan: jest.fn(),
    updateFinancialPlan: jest.fn(),
    deleteFinancialPlan: jest.fn(),
    duplicateFinancialPlan: jest.fn(),
    listChildren: jest.fn(),
    listCategories: jest.fn(),
    createChargePlan: jest.fn(),
    createDeadline: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

const PLAN = {
  id: 'plan-1',
  periodStart: '2026-09-01',
  periodEnd: '2027-06-30',
  planType: 'school' as const,
  label: 'École 2026/2027',
  knownPlanCost: 20000,
  paidAmount: 0,
  remainingDue: 20000,
  provisionCoverage: 0,
  remainingToFund: 20000,
  tauxCouverture: 0,
  completude: 'complet' as const,
  deadlinesCertain: [
    {
      id: 'd1',
      chargePlanId: 'cp-t1',
      dueDate: '2026-09-30',
      chargePlanLabel: 'Scolarité T1',
      amountCurrent: 21800,
      amountStatus: 'confirme' as const,
      resteAPayer: 21800,
      financialStatus: 'ouverte' as const,
      provisionId: null,
      coverageAffectee: 0,
      engagementNonCouvert: 21800,
      coverageStatus: 'non_couverte' as const,
    },
    {
      id: 'd2',
      chargePlanId: 'cp-garderie',
      dueDate: '2026-10-15',
      chargePlanLabel: 'Garderie',
      amountCurrent: 500,
      amountStatus: 'estime' as const,
      resteAPayer: 500,
      financialStatus: 'ouverte' as const,
      provisionId: null,
      coverageAffectee: 0,
      engagementNonCouvert: 500,
      coverageStatus: 'non_couverte' as const,
    },
  ],
  envisagedItems: [],
  envisagedTotal: 0,
  unknownItems: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.getFinancialPlan.mockResolvedValue(PLAN);
  mockedApi.listChildren.mockResolvedValue([]);
  mockedApi.listCategories.mockResolvedValue([]);
});

// Correction (Plan financier — affichage des postes) : l'écran ne liste plus
// jamais les échéances individuelles (Payer/deadline-row disparaissent d'ici,
// même comportement de navigation déplacé et réutilisé tel quel dans
// ChargePlanDetailScreen, cf. son propre test file).
it("n'affiche plus les échéances individuelles directement dans le Plan financier (seul le résumé du poste est visible)", async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('poste-cp-t1'));

  expect(screen.queryByTestId('pay-deadline-d1')).toBeNull();
  expect(screen.queryByTestId('deadline-row-d1')).toBeNull();
  expect(screen.queryByTestId('pay-deadline-d2')).toBeNull();
  expect(screen.queryByTestId('deadline-row-d2')).toBeNull();
});

it('"Voir les échéances" navigue vers ChargePlanDetail (réutilise l\'écran existant, aucun nouveau moteur)', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('poste-view-deadlines-cp-t1'));

  await fireEvent.press(screen.getByTestId('poste-view-deadlines-cp-t1'));

  expect(mockNavigate).toHaveBeenCalledWith('ChargePlanDetail', { id: 'cp-t1' });
});

/**
 * Recette téléphone réel §1 — le bas de l'écran utilise désormais useBottomInset()
 * (source unique des marges système, cf. ui/useBottomInset.ts) au lieu d'un padding
 * fixe : jamais une valeur magique propre à un téléphone.
 */
it('le padding bas du ScrollView provient de useBottomInset(), jamais d\'une valeur fixe (§1)', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-detail-scroll'));

  const scroll = screen.getByTestId('plan-detail-scroll');
  const flatStyle = [scroll.props.contentContainerStyle].flat();
  expect(flatStyle.some((s: any) => s && s.paddingBottom === 16)).toBe(true);
});

/**
 * R5 §2 — menu "..." (Modifier/Dupliquer/Supprimer), pattern réutilisable (§19).
 */
it('§2 — le menu "..." propose Modifier/Dupliquer/Supprimer', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));

  await fireEvent.press(screen.getByTestId('plan-menu-button'));

  await waitFor(() => screen.getByTestId('plan-menu-option-modifier'));
  expect(screen.getByTestId('plan-menu-option-dupliquer')).toBeTruthy();
  expect(screen.getByTestId('plan-menu-option-supprimer')).toBeTruthy();
});

it("§2 — Modifier pré-remplit le formulaire et enregistre via PATCH", async () => {
  mockedApi.updateFinancialPlan.mockResolvedValue({ ...PLAN, label: 'École renommée' });

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByTestId('plan-menu-option-modifier'));
  await fireEvent.press(screen.getByTestId('plan-menu-option-modifier'));

  await waitFor(() => screen.getByTestId('plan-edit-form'));
  expect(screen.getByTestId('plan-edit-label').props.value).toBe('École 2026/2027');

  await fireEvent.changeText(screen.getByTestId('plan-edit-label'), 'École renommée');
  await fireEvent.press(screen.getByTestId('plan-edit-save'));

  await waitFor(() =>
    expect(mockedApi.updateFinancialPlan).toHaveBeenCalledWith('plan-1', {
      label: 'École renommée',
      periodStart: '2026-09-01',
      periodEnd: '2027-06-30',
    }),
  );
});

it('§3 — Dupliquer propose la sélection explicite des enfants, jamais héritée automatiquement', async () => {
  mockedApi.listChildren.mockResolvedValue([
    { id: 'c1', firstName: 'Aîné', lastName: 'D' },
    { id: 'c2', firstName: 'Cadette', lastName: 'D' },
  ]);
  mockedApi.duplicateFinancialPlan.mockResolvedValue({ id: 'plan-2' });

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByTestId('plan-menu-option-dupliquer'));
  await fireEvent.press(screen.getByTestId('plan-menu-option-dupliquer'));

  await waitFor(() => screen.getByTestId('plan-duplicate-children-select'));
  // Aucun enfant pré-coché : sélection explicite, jamais héritée de l'original.
  fireEvent.press(screen.getByTestId('plan-duplicate-children-select'));
  await fireEvent.press(await screen.findByTestId('plan-duplicate-children-select-option-c2'));
  await fireEvent.press(screen.getByTestId('plan-duplicate-children-select-done'));
  await fireEvent.press(screen.getByTestId('plan-duplicate-next'));

  // Clôture §10 — récapitulatif explicite obligatoire avant toute écriture :
  // jamais une duplication immédiatement déclenchée depuis le choix de l'enfant.
  await waitFor(() => screen.getByTestId('plan-duplicate-recap'));
  expect(mockedApi.duplicateFinancialPlan).not.toHaveBeenCalled();
  expect(screen.getByText('Cadette D')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('plan-duplicate-confirm'));

  await waitFor(() =>
    expect(mockedApi.duplicateFinancialPlan).toHaveBeenCalledWith('plan-1', {
      label: 'École 2026/2027 (copie)',
      childIds: ['c2'],
    }),
  );
  expect(mockReplace).toHaveBeenCalledWith('FinancialPlanDetail', { id: 'plan-2' });
});

it("§2 — Supprimer appelle DELETE puis revient en arrière", async () => {
  mockedApi.deleteFinancialPlan.mockResolvedValue({ deleted: true });
  const RN = require('react-native');
  jest.spyOn(RN.Alert, 'alert').mockImplementation((...args: unknown[]) => {
    const buttons = args[2] as Array<{ text: string; onPress?: () => void }> | undefined;
    buttons?.find((b) => b.text === 'Supprimer')?.onPress?.();
  });

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByTestId('plan-menu-option-supprimer'));
  await fireEvent.press(screen.getByTestId('plan-menu-option-supprimer'));

  await waitFor(() => expect(mockedApi.deleteFinancialPlan).toHaveBeenCalledWith('plan-1'));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
});

it('§10 — le récapitulatif affiche le nombre d\'échéances copiées et "Retour" permet de rajuster le formulaire', async () => {
  mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Aîné', lastName: 'D' }]);

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByTestId('plan-menu-option-dupliquer'));
  await fireEvent.press(screen.getByTestId('plan-menu-option-dupliquer'));
  await waitFor(() => screen.getByTestId('plan-duplicate-form'));
  await fireEvent.press(screen.getByTestId('plan-duplicate-next'));

  await waitFor(() => screen.getByTestId('plan-duplicate-recap'));
  expect(screen.getByText('2')).toBeTruthy(); // PLAN.deadlinesCertain a 2 lignes (d1, d2)
  expect(screen.getByText('Aucun')).toBeTruthy(); // aucun enfant sélectionné

  await fireEvent.press(screen.getByTestId('plan-duplicate-back'));

  await waitFor(() => screen.getByTestId('plan-duplicate-form'));
  expect(mockedApi.duplicateFinancialPlan).not.toHaveBeenCalled();
});

it("§2 — Supprimer bloqué (paiements existants) affiche le message du backend, jamais un DELETE silencieux", async () => {
  mockedApi.deleteFinancialPlan.mockRejectedValue(
    new api.ApiError(400, "Ce plan a des paiements enregistrés — suppression impossible pour préserver l'historique financier."),
  );
  const RN = require('react-native');
  jest.spyOn(RN.Alert, 'alert').mockImplementation((...args: unknown[]) => {
    const buttons = args[2] as Array<{ text: string; onPress?: () => void }> | undefined;
    buttons?.find((b) => b.text === 'Supprimer')?.onPress?.();
  });

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByTestId('plan-menu-option-supprimer'));
  await fireEvent.press(screen.getByTestId('plan-menu-option-supprimer'));

  await waitFor(() => expect(screen.getByText(/paiements enregistrés/)).toBeTruthy());
  expect(mockGoBack).not.toHaveBeenCalled();
});

// Point 14.3 — "Ajouter un poste" propose désormais explicitement une
// Périodicité (Ponctuel par défaut ou une récurrence), sans redemander la
// date de fin du plan (automatiquement liée à periodEnd, garde-fou backend).
it('14.3 — "Ajouter un poste" en Ponctuel (par défaut) crée un ChargePlan calendrier_manuel, comportement historique inchangé', async () => {
  mockedApi.createChargePlan.mockResolvedValue({ id: 'cp-new' });
  mockedApi.createDeadline.mockResolvedValue({ id: 'd-new' });

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByTestId('plan-menu-option-ajouter'));
  await fireEvent.press(screen.getByTestId('plan-menu-option-ajouter'));

  await waitFor(() => screen.getByTestId('plan-add-deadline-form'));
  await fireEvent.changeText(screen.getByTestId('plan-add-deadline-label'), 'Fournitures');
  await fireEvent.changeText(screen.getByTestId('plan-add-deadline-amount'), '120');
  await fireEvent.changeText(screen.getByTestId("date-Date d'échéance"), '2026-10-05');
  await fireEvent.press(screen.getByTestId('plan-add-deadline-save'));

  await waitFor(() =>
    expect(mockedApi.createChargePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Fournitures',
        financialPlanId: 'plan-1',
        generationMode: 'calendrier_manuel',
        recurrenceRule: undefined,
        recurrenceAnchorDate: undefined,
      }),
    ),
  );
  await waitFor(() => expect(mockedApi.createDeadline).toHaveBeenCalledWith('cp-new', expect.objectContaining({ dueDate: '2026-10-05' })));
});

it("14.3 — choisir une périodicité récurrente crée un ChargePlan auto_frequence, ancré sur la date de début, sans redemander la fin du plan", async () => {
  mockedApi.createChargePlan.mockResolvedValue({ id: 'cp-recurring' });
  mockedApi.createDeadline.mockResolvedValue({ id: 'd-recurring' });

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByTestId('plan-menu-option-ajouter'));
  await fireEvent.press(screen.getByTestId('plan-menu-option-ajouter'));

  await waitFor(() => screen.getByTestId('plan-add-deadline-form'));
  await fireEvent.changeText(screen.getByTestId('plan-add-deadline-label'), 'Activité mensuelle');
  await fireEvent.press(screen.getByTestId('plan-add-deadline-periodicity'));
  await waitFor(() => screen.getByTestId('plan-add-deadline-periodicity-option-mensuel'));
  await fireEvent.press(screen.getByTestId('plan-add-deadline-periodicity-option-mensuel'));

  // Le libellé du champ date passe à "Date de début" et la date de fin
  // n'est JAMAIS redemandée — seulement affichée en information (periodEnd).
  await waitFor(() => screen.getByTestId('date-Date de début'));
  expect(screen.getByText(/Se termine automatiquement à la fin du plan/)).toBeTruthy();
  expect(screen.getByText(/30 juin 2027/)).toBeTruthy();

  await fireEvent.changeText(screen.getByTestId('plan-add-deadline-amount'), '500');
  await fireEvent.changeText(screen.getByTestId('date-Date de début'), '2026-09-15');
  await fireEvent.press(screen.getByTestId('plan-add-deadline-save'));

  await waitFor(() =>
    expect(mockedApi.createChargePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Activité mensuelle',
        financialPlanId: 'plan-1',
        generationMode: 'auto_frequence',
        recurrenceRule: 'mensuel',
        recurrenceAnchorDate: '2026-09-15',
        startDate: '2026-09-15',
      }),
    ),
  );
});

it('14.3 — une échéance d\'un poste récurrent affiche sa périodicité, jamais un poste séparé par occurrence', async () => {
  mockedApi.getFinancialPlan.mockResolvedValue({
    ...PLAN,
    deadlinesCertain: [{ ...PLAN.deadlinesCertain[0], recurrenceRule: 'mensuel' }],
  });

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByText(/Scolarité T1/));

  expect(screen.getByText(/Mensuel/)).toBeTruthy();
});

// Point 6a — "Enfant(s) bénéficiaire(s)" ne doit apparaître dans "Ajouter un
// poste" QUE pour un plan scolaire (basé sur planType, jamais sur le libellé).
it('point 6a — plan scolaire : le champ "Enfant(s) bénéficiaire(s)" est proposé', async () => {
  mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Aîné', lastName: 'D' }]);

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByTestId('plan-menu-option-ajouter'));
  await fireEvent.press(screen.getByTestId('plan-menu-option-ajouter'));

  await waitFor(() => screen.getByTestId('plan-add-deadline-form'));
  expect(screen.getByTestId('plan-add-deadline-children')).toBeTruthy();
});

it('point 6a — plan "Voiture · Opel Astra" (planType=vehicle) : le champ "Enfant(s) bénéficiaire(s)" n\'apparaît pas, même si le foyer a des enfants', async () => {
  mockedApi.getFinancialPlan.mockResolvedValue({ ...PLAN, planType: 'vehicle', label: 'Voiture · Opel Astra' });
  mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Aîné', lastName: 'D' }]);

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByTestId('plan-menu-option-ajouter'));
  await fireEvent.press(screen.getByTestId('plan-menu-option-ajouter'));

  await waitFor(() => screen.getByTestId('plan-add-deadline-form'));
  expect(screen.queryByTestId('plan-add-deadline-children')).toBeNull();
});

it('point 6a — plan "Maison · Villa Almaz" (planType=housing) : jamais le champ enfant', async () => {
  mockedApi.getFinancialPlan.mockResolvedValue({ ...PLAN, planType: 'housing', label: 'Maison · Villa Almaz' });
  mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Aîné', lastName: 'D' }]);

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByTestId('plan-menu-option-ajouter'));
  await fireEvent.press(screen.getByTestId('plan-menu-option-ajouter'));

  await waitFor(() => screen.getByTestId('plan-add-deadline-form'));
  expect(screen.queryByTestId('plan-add-deadline-children')).toBeNull();
});

it('point 6a — plan "Abonnements" (planType=subscriptions) : jamais le champ enfant', async () => {
  mockedApi.getFinancialPlan.mockResolvedValue({ ...PLAN, planType: 'subscriptions', label: 'Abonnements' });
  mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Aîné', lastName: 'D' }]);

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByTestId('plan-menu-option-ajouter'));
  await fireEvent.press(screen.getByTestId('plan-menu-option-ajouter'));

  await waitFor(() => screen.getByTestId('plan-add-deadline-form'));
  expect(screen.queryByTestId('plan-add-deadline-children')).toBeNull();
});

// Point 6b — le ScrollView du modal "Ajouter un poste" porte lui-même une
// largeur 100% (pas seulement son contentContainerStyle), pour que la carte
// occupe toute la largeur disponible plutôt qu'un shrink-to-fit étroit.
it('point 6b — le modal "Ajouter un poste" porte une largeur 100% sur le ScrollView lui-même', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByTestId('plan-menu-option-ajouter'));
  await fireEvent.press(screen.getByTestId('plan-menu-option-ajouter'));

  const form = await screen.findByTestId('plan-add-deadline-form');
  const flatStyle = [form.props.style].flat();
  expect(flatStyle.some((s: any) => s && s.width === '100%')).toBe(true);
});

// Point 7 (révision) — "Modifier le plan" affiche une liste de POSTES (pas
// une répétition d'échéances) : chaque poste expose Modifier le poste /
// Voir les échéances / Ajouter une échéance / Retirer du plan, réutilisant
// ChargePlanDetailScreen (jamais un nouveau moteur métier).
it('point 7 — "Modifier le poste" navigue vers ChargePlanDetail avec le chargePlanId', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('poste-edit-cp-t1'));

  await fireEvent.press(screen.getByTestId('poste-edit-cp-t1'));

  expect(mockNavigate).toHaveBeenCalledWith('ChargePlanDetail', { id: 'cp-t1' });
});

it('point 7 — "Ajouter une échéance" navigue vers ChargePlanDetail avec openAddDeadline pour ouvrir directement le formulaire', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('poste-add-deadline-cp-t1'));

  await fireEvent.press(screen.getByTestId('poste-add-deadline-cp-t1'));

  expect(mockNavigate).toHaveBeenCalledWith('ChargePlanDetail', { id: 'cp-t1', openAddDeadline: true });
});

it('point 7 — "Retirer du plan" (action du poste) navigue vers ChargePlanDetail, où le retrait déjà existant s\'applique (aucun moteur dupliqué)', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('poste-retire-cp-t1'));

  await fireEvent.press(screen.getByTestId('poste-retire-cp-t1'));

  expect(mockNavigate).toHaveBeenCalledWith('ChargePlanDetail', { id: 'cp-t1' });
});

// IMPORTANT (exigence explicite) — un poste récurrent avec plusieurs
// échéances ouvertes simultanément doit apparaître UNE SEULE FOIS comme
// poste ; ses échéances ne doivent jamais être présentées comme plusieurs
// postes distincts, ni listées directement dans cet écran.
it('point 7 — un poste avec plusieurs échéances ouvertes apparaît UNE SEULE FOIS (jamais un poste par échéance, jamais la liste des échéances)', async () => {
  mockedApi.getFinancialPlan.mockResolvedValue({
    ...PLAN,
    deadlinesCertain: [
      ...PLAN.deadlinesCertain,
      {
        id: 'd1-bis',
        chargePlanId: 'cp-t1',
        dueDate: '2026-10-30',
        chargePlanLabel: 'Scolarité T1',
        amountCurrent: 21800,
        amountStatus: 'confirme' as const,
        resteAPayer: 21800,
        financialStatus: 'ouverte' as const,
        provisionId: null,
        coverageAffectee: 0,
        engagementNonCouvert: 21800,
        coverageStatus: 'non_couverte' as const,
      },
    ],
  });

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('poste-cp-t1'));

  // Un seul poste-card pour cp-t1, malgré ses 2 échéances ouvertes.
  expect(screen.getAllByTestId('poste-cp-t1')).toHaveLength(1);
  // Aucune des 2 échéances individuelles n'est listée directement ici.
  expect(screen.queryByTestId('pay-deadline-d1')).toBeNull();
  expect(screen.queryByTestId('pay-deadline-d1-bis')).toBeNull();
  // Indication du nombre d'échéances ouvertes sur l'en-tête du poste.
  expect(screen.getByText(/2 échéances ouvertes/)).toBeTruthy();
});

// RÈGLE ATTENDUE (correction Plan financier — affichage des postes) : pour un
// poste avec un grand nombre d'échéances ouvertes (ex. charge mensuelle sur
// plusieurs années), l'écran Plan financier doit rester une SEULE carte
// résumé — jamais une liste de dizaines de lignes. Exemple exact demandé :
// "Eau · Villa Almaz" avec 23 échéances mensuelles ouvertes.
it("point 7 — poste avec 23 échéances ouvertes : une seule carte, seule la prochaine échéance est affichée, compteur exact, accès via \"Voir les échéances\", aucun doublon", async () => {
  // 23 échéances mensuelles consécutives, à partir du 01 oct. 2026 (la plus proche en premier).
  const deadlinesCertain = Array.from({ length: 23 }, (_, i) => {
    const monthIndex0 = 9 + i; // octobre 2026 = mois index 9 (0=janvier)
    const year = 2026 + Math.floor(monthIndex0 / 12);
    const month = (monthIndex0 % 12) + 1;
    return {
      id: `d-eau-${i}`,
      chargePlanId: 'cp-eau',
      dueDate: `${year}-${String(month).padStart(2, '0')}-01`,
      chargePlanLabel: 'Eau · Villa Almaz',
      amountCurrent: 1000,
      amountStatus: 'confirme' as const,
      resteAPayer: 1000,
      financialStatus: 'ouverte' as const,
      provisionId: null,
      coverageAffectee: 0,
      engagementNonCouvert: 1000,
      coverageStatus: 'non_couverte' as const,
      categoryName: null,
      defaultAccountId: null,
      status: 'actif' as const,
      recurrenceRule: 'mensuel' as const,
    };
  });

  mockedApi.getFinancialPlan.mockResolvedValue({ ...PLAN, deadlinesCertain });

  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('poste-cp-eau'));

  // 1 poste = 1 carte, jamais un doublon même avec 23 échéances.
  expect(screen.getAllByTestId('poste-cp-eau')).toHaveLength(1);
  // Seule la prochaine échéance (la plus proche, 01 oct. 2026) est affichée.
  expect(screen.getByText(/Prochaine échéance : 01 oct\. 2026/)).toBeTruthy();
  // Aucune des 22 autres dates n'apparaît directement dans l'écran.
  expect(screen.queryByText(/01 nov\. 2026/)).toBeNull();
  expect(screen.queryByText(/01 déc\. 2026/)).toBeNull();
  // Compteur exact.
  expect(screen.getByText(/23 échéances ouvertes/)).toBeTruthy();
  // Aucune échéance individuelle listée directement dans le Plan financier.
  expect(screen.queryByTestId('pay-deadline-d-eau-0')).toBeNull();
  expect(screen.queryByTestId('deadline-row-d-eau-0')).toBeNull();
  // Accès à toutes les échéances via "Voir les échéances" (réutilise ChargePlanDetailScreen).
  expect(screen.getByTestId('poste-view-deadlines-cp-eau')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('poste-view-deadlines-cp-eau'));
  expect(mockNavigate).toHaveBeenCalledWith('ChargePlanDetail', { id: 'cp-eau' });
});
