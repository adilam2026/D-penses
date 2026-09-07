import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { SchoolWizardScreen } from '../SchoolWizardScreen';
import * as api from '../../../api/client';

/**
 * Tests du wizard scolaire (Vague 1B §2). DateField est mocké par un simple
 * champ texte contrôlé — il est déjà testé isolément (src/ui/__tests__/DateField.test.tsx)
 * et n'est pas l'objet de ces tests, qui portent sur la logique métier
 * (prérequis, répartition trimestrielle, inconnu≠0, récapitulatif).
 */
jest.mock('../../../ui/DateField', () => {
  const { TextInput } = require('react-native');
  return {
    DateField: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) => (
      <TextInput testID={label ? `date-${label}` : 'date-field'} value={value} onChangeText={onChange} />
    ),
  };
});

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

// Correctif post-Vague 3 (§1, suivi) — le clavier recouvrait la zone active sur
// Garderie/Réinscription/Sorties malgré useKeyboardAwareScroll déjà introduit
// ailleurs : le hook n'était tout simplement pas câblé sur ce wizard. On mocke
// le hook (son propre mécanisme interne — mesure + scrollTo — est déjà testé
// implicitement par son usage réel sur les autres écrans) pour vérifier ici
// UNIQUEMENT le câblage : chaque TextInput concerné doit bien recevoir
// onFocus=handleFocus, jamais un oubli silencieux comme celui constaté.
const mockHandleFocus = jest.fn();
jest.mock('../../../ui/useKeyboardAwareScroll', () => ({
  useKeyboardAwareScroll: () => ({ scrollRef: { current: null }, handleFocus: mockHandleFocus }),
}));

const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, replace: mockReplace, goBack: mockGoBack }),
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    listChildren: jest.fn(),
    createChild: jest.fn(),
    submitSchoolWizard: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

// Suit la position ABSOLUE dans le wizard pour que goToStep(n) amène toujours
// à l'étape n peu importe combien de fois la fonction a déjà été appelée dans
// le même test (chaque appel ne presse "Suivant" que le delta nécessaire).
let currentStep = 0;

async function goToStep(targetIndex: number) {
  while (currentStep < targetIndex) {
    await fireEvent.press(screen.getByTestId('nav-next'));
    currentStep++;
  }
}

async function pressPrev() {
  await fireEvent.press(screen.getByTestId('nav-prev'));
  currentStep = Math.max(0, currentStep - 1);
}

async function pressNext() {
  await fireEvent.press(screen.getByTestId('nav-next'));
  currentStep++;
}

// R6 finition UX/UI §2 — l'enfant concerné se choisit désormais via le
// sélecteur multi-select compact (jamais une liste de chips brute).
async function selectChild(id: string) {
  fireEvent.press(screen.getByTestId('school-wizard-children-select'));
  await fireEvent.press(await screen.findByTestId(`school-wizard-children-select-option-${id}`));
  await fireEvent.press(screen.getByTestId('school-wizard-children-select-done'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHandleFocus.mockClear();
  currentStep = 0;
});

describe('A. Prérequis enfant', () => {
  it("aucun enfant → le wizard propose d'en ajouter un avant toute saisie", async () => {
    mockedApi.listChildren.mockResolvedValue([]);
    await render(<SchoolWizardScreen />);

    await waitFor(() => expect(screen.getByText("Aucun enfant n'est encore configuré")).toBeTruthy());
    // Aucune étape normale du wizard n'est accessible tant que la porte est affichée.
    expect(screen.queryByTestId('nav-next')).toBeNull();
  });

  it('création d\'un enfant depuis la porte → reprise automatique du wizard, sans navigation', async () => {
    mockedApi.listChildren.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'c1', firstName: 'Dina', lastName: 'TAHA' }]);
    mockedApi.createChild.mockResolvedValue({ id: 'c1', firstName: 'Dina', lastName: 'TAHA' });

    await render(<SchoolWizardScreen />);
    await waitFor(() => expect(screen.getByText("Aucun enfant n'est encore configuré")).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('gate-firstName'), 'Dina');
    await fireEvent.changeText(screen.getByTestId('gate-lastName'), 'TAHA');
    await fireEvent.press(screen.getByTestId('gate-submit'));

    await waitFor(() => expect(screen.getByTestId('nav-next')).toBeTruthy());
    expect(mockedApi.createChild).toHaveBeenCalledWith({ firstName: 'Dina', lastName: 'TAHA' });
    // Reprise dans le MÊME composant : jamais de navigation vers un autre écran.
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
    // L'enfant nouvellement créé est présélectionné.
    expect(screen.getByText('Dina')).toBeTruthy();
  });
});

describe('B. Configuration 4/3/3 — scolarité annuelle', () => {
  it('54 500 DH répartis sur 4/3/3 mois → T1 21800, T2 16350, T3 16350', async () => {
    mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Dina', lastName: 'TAHA' }]);
    await render(<SchoolWizardScreen />);
    await waitFor(() => expect(screen.getByTestId('nav-next')).toBeTruthy());

    await goToStep(1); // Étape 2 : Scolarité
    await fireEvent.changeText(screen.getByTestId('scolarite-annual'), '54500');
    await fireEvent.press(screen.getByTestId('scolarite-repartir'));

    expect(screen.getByTestId('Scolarité-term-0-amount').props.value).toBe('21800');
    expect(screen.getByTestId('Scolarité-term-1-amount').props.value).toBe('16350');
    expect(screen.getByTestId('Scolarité-term-2-amount').props.value).toBe('16350');
  });
});

describe('C/D. Restauration trimestrielle — estimation puis modification manuelle', () => {
  async function setupRestaurationT1() {
    mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Dina', lastName: 'TAHA' }]);
    await render(<SchoolWizardScreen />);
    await waitFor(() => expect(screen.getByTestId('nav-next')).toBeTruthy());

    await goToStep(2); // Étape 3 : Services scolaires
    await fireEvent(screen.getByTestId('toggle-Restauration'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('Restauration-freq-trimestriel'));
    await fireEvent.changeText(screen.getByTestId('Restauration-term-0-amount'), '1950');
  }

  it('T1 = 1950 sur 4 mois → T2 et T3 estimés automatiquement à 1462,50', async () => {
    await setupRestaurationT1();
    expect(screen.getByTestId('Restauration-term-1-amount').props.value).toBe('1462.5');
    expect(screen.getByTestId('Restauration-term-2-amount').props.value).toBe('1462.5');
  });

  it('une modification manuelle de T2 est conservée même après d\'autres changements de state', async () => {
    await setupRestaurationT1();

    await fireEvent.changeText(screen.getByTestId('Restauration-term-1-amount'), '1500');
    expect(screen.getByTestId('Restauration-term-1-amount').props.value).toBe('1500');

    // Provoque d'autres changements de state : navigation vers une autre étape et retour,
    // puis modification d'un champ sans rapport (nom de l'établissement).
    await fireEvent.press(screen.getByTestId('nav-next'));
    await fireEvent.press(screen.getByTestId('nav-prev'));
    await fireEvent.press(screen.getByTestId('nav-prev'));
    await fireEvent.changeText(screen.getByTestId('scolarite-annual'), '1000');
    await fireEvent.press(screen.getByTestId('nav-next'));

    expect(screen.getByTestId('Restauration-term-1-amount').props.value).toBe('1500');

    // Un nouveau changement de T1 ne doit toujours pas écraser T2 (devenu manuel),
    // mais T3 (resté automatique) doit continuer de suivre T1.
    await fireEvent.changeText(screen.getByTestId('Restauration-term-0-amount'), '2000');
    expect(screen.getByTestId('Restauration-term-1-amount').props.value).toBe('1500');
    expect(screen.getByTestId('Restauration-term-2-amount').props.value).toBe('1500');
  });
});

describe('E. Inconnu ≠ 0', () => {
  it('un poste inclus sans montant renseigné est envoyé comme amount:null, jamais 0', async () => {
    mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Dina', lastName: 'TAHA' }]);
    mockedApi.submitSchoolWizard.mockResolvedValue({ financialPlan: { id: 'plan1' }, chargePlans: [] });

    await render(<SchoolWizardScreen />);
    await waitFor(() => expect(screen.getByTestId('nav-next')).toBeTruthy());

    await selectChild('c1');
    await goToStep(3); // Étape 4 : Frais de rentrée
    await fireEvent(screen.getByTestId('toggle-Fournitures'), 'valueChange', true);
    // Aucun montant saisi pour Fournitures — laissé vide.

    await goToStep(5); // Étape 6 : Récapitulatif
    await fireEvent.press(screen.getByTestId('nav-submit'));

    await waitFor(() => expect(mockedApi.submitSchoolWizard).toHaveBeenCalled());
    const payload = mockedApi.submitSchoolWizard.mock.calls[0][0];
    const fournitures = payload.items.find((it: any) => it.label === 'Fournitures');
    expect(fournitures).toBeDefined();
    expect(fournitures!.amount).toBeNull();
    expect(fournitures!.amount).not.toBe(0);
  });

  it('après soumission, redirection directe vers le plan créé (jamais un écran générique)', async () => {
    mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Dina', lastName: 'TAHA' }]);
    mockedApi.submitSchoolWizard.mockResolvedValue({ financialPlan: { id: 'plan-xyz' }, chargePlans: [] });

    await render(<SchoolWizardScreen />);
    await waitFor(() => expect(screen.getByTestId('nav-next')).toBeTruthy());
    await selectChild('c1');
    await goToStep(5);
    await fireEvent.press(screen.getByTestId('nav-submit'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('FinancialPlanDetail', { id: 'plan-xyz' }));
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});

describe('H. Clavier — mécanisme keyboard-aware réellement câblé (recette post-Vague 3, suivi §1)', () => {
  it('le champ prénom de la porte enfant déclenche handleFocus', async () => {
    mockedApi.listChildren.mockResolvedValue([]);
    await render(<SchoolWizardScreen />);
    await waitFor(() => screen.getByTestId('gate-firstName'));

    await fireEvent(screen.getByTestId('gate-firstName'), 'focus');

    expect(mockHandleFocus).toHaveBeenCalled();
  });

  it('Scolarité (étape 2) : le montant annuel déclenche handleFocus', async () => {
    mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Dina', lastName: 'TAHA' }]);
    await render(<SchoolWizardScreen />);
    await waitFor(() => screen.getByTestId('nav-next'));
    await goToStep(1);

    await fireEvent(screen.getByTestId('scolarite-annual'), 'focus');

    expect(mockHandleFocus).toHaveBeenCalled();
  });

  it('Services scolaires (étape 3) : Restauration ET Garderie déclenchent handleFocus', async () => {
    mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Dina', lastName: 'TAHA' }]);
    await render(<SchoolWizardScreen />);
    await waitFor(() => screen.getByTestId('nav-next'));
    await goToStep(2);

    await fireEvent(screen.getByTestId('toggle-Restauration'), 'valueChange', true);
    await fireEvent(screen.getByTestId('Restauration-freq-trimestriel'), 'press');
    await fireEvent(screen.getByTestId('Restauration-term-0-amount'), 'focus');
    expect(mockHandleFocus).toHaveBeenCalledTimes(1);

    await fireEvent(screen.getByTestId('toggle-Garderie'), 'valueChange', true);
    await fireEvent(screen.getByTestId('Garderie-amount'), 'focus');
    expect(mockHandleFocus).toHaveBeenCalledTimes(2);
  });

  it('Vie scolaire & réinscription (étape 5) : Sorties ET Réinscription déclenchent handleFocus', async () => {
    mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Dina', lastName: 'TAHA' }]);
    await render(<SchoolWizardScreen />);
    await waitFor(() => screen.getByTestId('nav-next'));
    await goToStep(4);

    await fireEvent(screen.getByTestId('toggle-Sorties / activités'), 'valueChange', true);
    await fireEvent(screen.getByTestId('Sorties-amount'), 'focus');
    expect(mockHandleFocus).toHaveBeenCalledTimes(1);

    await fireEvent(screen.getByTestId('toggle-Réinscription'), 'valueChange', true);
    await fireEvent(screen.getByTestId('Réinscription-amount'), 'focus');
    expect(mockHandleFocus).toHaveBeenCalledTimes(2);

    // "Autres frais" (libellé + montant) — également concernés (§2 audit).
    await fireEvent.press(screen.getByText('+ Ajouter une ligne'));
    await fireEvent(screen.getByPlaceholderText('Libellé (ex. Voyage scolaire)'), 'focus');
    expect(mockHandleFocus).toHaveBeenCalledTimes(3);
  });
});

describe('G. Garderie/Activités — fréquences élargies (recette post-Vague 3 §8/§9/§10)', () => {
  it('Garderie propose mensuel/trimestriel/annuel/ponctuel (plus limitée à mensuel/ponctuel)', async () => {
    mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Dina', lastName: 'TAHA' }]);
    await render(<SchoolWizardScreen />);
    await waitFor(() => expect(screen.getByTestId('nav-next')).toBeTruthy());

    await goToStep(2); // Services scolaires
    await fireEvent(screen.getByTestId('toggle-Garderie'), 'valueChange', true);

    expect(screen.getByTestId('Garderie-freq-mensuel')).toBeTruthy();
    expect(screen.getByTestId('Garderie-freq-trimestriel')).toBeTruthy();
    expect(screen.getByTestId('Garderie-freq-annuel')).toBeTruthy();
    expect(screen.getByTestId('Garderie-freq-ponctuel')).toBeTruthy();
  });

  it('Garderie annuelle envoie recurrenceRule="annuel" (vrai ChargePlan récurrent, même moteur générique)', async () => {
    mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Dina', lastName: 'TAHA' }]);
    mockedApi.submitSchoolWizard.mockResolvedValue({ financialPlan: { id: 'plan1' }, chargePlans: [] });

    await render(<SchoolWizardScreen />);
    await waitFor(() => expect(screen.getByTestId('nav-next')).toBeTruthy());
    await selectChild('c1');

    await goToStep(2); // Services scolaires
    await fireEvent(screen.getByTestId('toggle-Garderie'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('Garderie-freq-annuel'));
    await fireEvent.changeText(screen.getByTestId('Garderie-amount'), '6000');

    await goToStep(5); // Récapitulatif
    await fireEvent.press(screen.getByTestId('nav-submit'));

    await waitFor(() => expect(mockedApi.submitSchoolWizard).toHaveBeenCalled());
    const payload = mockedApi.submitSchoolWizard.mock.calls[0][0];
    const garderie = payload.items.find((it: any) => it.label === 'Garderie');
    expect(garderie!.recurrenceRule).toBe('annuel');
  });

  it('Garderie trimestrielle réutilise le même mécanisme T1/T2/T3 que Scolarité/Restauration (§10)', async () => {
    mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Dina', lastName: 'TAHA' }]);
    await render(<SchoolWizardScreen />);
    await waitFor(() => expect(screen.getByTestId('nav-next')).toBeTruthy());

    await goToStep(2); // Services scolaires
    await fireEvent(screen.getByTestId('toggle-Garderie'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('Garderie-freq-trimestriel'));
    await fireEvent.changeText(screen.getByTestId('Garderie-term-0-amount'), '600');

    expect(screen.getByTestId('Garderie-term-1-amount')).toBeTruthy();
    expect(screen.getByTestId('Garderie-term-2-amount')).toBeTruthy();
  });

  it('Sorties/activités propose une fréquence (mensuel/trimestriel/ponctuel), plus limitée à un montant/date unique', async () => {
    mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Dina', lastName: 'TAHA' }]);
    mockedApi.submitSchoolWizard.mockResolvedValue({ financialPlan: { id: 'plan1' }, chargePlans: [] });

    await render(<SchoolWizardScreen />);
    await waitFor(() => expect(screen.getByTestId('nav-next')).toBeTruthy());
    await selectChild('c1');

    await goToStep(4); // Vie scolaire
    await fireEvent(screen.getByTestId('toggle-Sorties / activités'), 'valueChange', true);
    expect(screen.getByTestId('Sorties-freq-mensuel')).toBeTruthy();
    expect(screen.getByTestId('Sorties-freq-trimestriel')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('Sorties-freq-mensuel'));
    await fireEvent.changeText(screen.getByTestId('Sorties-amount'), '250');

    await goToStep(5); // Récapitulatif
    await fireEvent.press(screen.getByTestId('nav-submit'));

    await waitFor(() => expect(mockedApi.submitSchoolWizard).toHaveBeenCalled());
    const payload = mockedApi.submitSchoolWizard.mock.calls[0][0];
    const sorties = payload.items.find((it: any) => it.label === 'Sorties');
    expect(sorties!.recurrenceRule).toBe('mensuel');
  });
});

describe('F. Récapitulatif — 9 lignes attendues', () => {
  it('3 scolarité + 3 restauration + uniforme + fournitures + sorties = 9 lignes, avec montant/date/statut', async () => {
    mockedApi.listChildren.mockResolvedValue([{ id: 'c1', firstName: 'Dina', lastName: 'TAHA' }]);
    await render(<SchoolWizardScreen />);
    await waitFor(() => expect(screen.getByTestId('nav-next')).toBeTruthy());
    await selectChild('c1');

    await goToStep(1); // Scolarité
    await fireEvent.changeText(screen.getByTestId('scolarite-annual'), '54500');
    await fireEvent.press(screen.getByTestId('scolarite-repartir'));

    await goToStep(2); // Services scolaires
    await fireEvent(screen.getByTestId('toggle-Restauration'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('Restauration-freq-trimestriel'));
    await fireEvent.changeText(screen.getByTestId('Restauration-term-0-amount'), '1950');

    await goToStep(3); // Frais de rentrée
    await fireEvent(screen.getByTestId('toggle-Uniforme'), 'valueChange', true);
    await fireEvent.changeText(screen.getByTestId('Uniforme-amount'), '3400');
    await fireEvent(screen.getByTestId('toggle-Fournitures'), 'valueChange', true);
    await fireEvent.changeText(screen.getByTestId('Fournitures-amount'), '1000');

    await goToStep(4); // Vie scolaire
    await fireEvent(screen.getByTestId('toggle-Sorties / activités'), 'valueChange', true);
    await fireEvent.changeText(screen.getByTestId('Sorties-amount'), '500');

    await goToStep(5); // Récapitulatif
    expect(screen.getByText('21 800 DH')).toBeTruthy();
    expect(screen.getAllByText('16 350 DH').length).toBe(2); // T2 et T3 scolarité
    expect(screen.getByText('1 950 DH')).toBeTruthy();
    expect(screen.getAllByText('1 462,5 DH').length).toBe(2); // T2 et T3 restauration (estimés)
    expect(screen.getByText('3 400 DH')).toBeTruthy();
    expect(screen.getByText('1 000 DH')).toBeTruthy();
    expect(screen.getByText('500 DH')).toBeTruthy();
    expect(screen.getAllByText(/Estimé — à confirmer plus tard/).length).toBe(9);
  });
});
