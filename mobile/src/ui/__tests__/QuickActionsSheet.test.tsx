import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QuickActionsSheet } from '../QuickActionsSheet';
import { QuickActionsProvider, useQuickActions } from '../../state/QuickActionsContext';

jest.mock('../useBottomInset', () => ({ useBottomInset: () => 16 }));

/**
 * Tests de la bottom sheet "+" (TXT réf. §M1) : les 6 actions exactes
 * (Dépense/Revenu/Transfert/Charge récurrente/Budget/Plan), ouverture/fermeture,
 * et le chooser interne du Plan (École/Voyage disponibles, Maison/Voiture non
 * disponibles — jamais un faux parcours vers un écran non fonctionnel).
 */
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// expo-font/expo-asset ne résolvent pas sous Jest dans cet environnement (jamais
// exercé avant Vague 3, aucun test précédent ne rendait un composant impliquant
// @expo/vector-icons) — on mocke la frontière du module, pas son comportement :
// seule l'icône réellement affichée nous importe ici, jamais le rendu de police.
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => Text != null && require('react').createElement(Text, null, props.name) };
});

// Harnais minimal : ouvre la sheet automatiquement pour tester son contenu,
// sans dépendre de RootTabs (déjà testé séparément pour l'ouverture depuis l'onglet central).
function OpenSheetHarness() {
  const { open } = useQuickActions();
  React.useEffect(() => {
    open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <QuickActionsSheet />;
}

async function renderOpenSheet() {
  await render(
    <QuickActionsProvider>
      <OpenSheetHarness />
    </QuickActionsProvider>,
  );
  await waitFor(() => screen.getByTestId('quick-actions-sheet'));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('QuickActionsSheet — les 6 actions (TXT réf. §M1)', () => {
  it('affiche exactement les 6 actions prescrites : Dépense/Revenu/Transfert/Charge récurrente/Budget/Plan', async () => {
    await renderOpenSheet();
    expect(screen.getByTestId('quick-action-depense')).toBeTruthy();
    expect(screen.getByTestId('quick-action-revenu')).toBeTruthy();
    expect(screen.getByTestId('quick-action-transfert')).toBeTruthy();
    expect(screen.getByTestId('quick-action-charge')).toBeTruthy();
    expect(screen.getByTestId('quick-action-budget')).toBeTruthy();
    expect(screen.getByTestId('quick-action-plan')).toBeTruthy();
    // §M1 — "Alimenter une enveloppe" et "Payer une échéance" ne sont plus des
    // entrées de premier niveau (le moteur Provision reste, mais n'est plus
    // exposé ici comme un concept générique).
    expect(screen.queryByTestId('quick-action-alimenter')).toBeNull();
    expect(screen.queryByTestId('quick-action-paiement')).toBeNull();
  });

  it('"Dépense" navigue directement vers QuickAdd en mode dépense', async () => {
    await renderOpenSheet();
    await fireEvent.press(screen.getByTestId('quick-action-depense'));
    expect(mockNavigate).toHaveBeenCalledWith('QuickAdd', { mode: 'depense' });
  });

  it('"Transfert" navigue directement vers QuickAdd en mode transfert', async () => {
    await renderOpenSheet();
    await fireEvent.press(screen.getByTestId('quick-action-transfert'));
    expect(mockNavigate).toHaveBeenCalledWith('QuickAdd', { mode: 'transfert' });
  });

  it('"Charge récurrente" navigue directement vers CreateCharge', async () => {
    await renderOpenSheet();
    await fireEvent.press(screen.getByTestId('quick-action-charge'));
    expect(mockNavigate).toHaveBeenCalledWith('CreateCharge');
  });

  it('"Budget" navigue directement vers CreateBudget', async () => {
    await renderOpenSheet();
    await fireEvent.press(screen.getByTestId('quick-action-budget'));
    expect(mockNavigate).toHaveBeenCalledWith('CreateBudget');
  });

  it('"Annuler" ferme la sheet', async () => {
    await renderOpenSheet();
    await fireEvent.press(screen.getByText('Annuler'));
    await waitFor(() => expect(screen.queryByTestId('quick-actions-sheet')).toBeNull());
  });
});

describe('QuickActionsSheet — chooser "Plan" (TXT réf. §M1)', () => {
  it('propose École/Voyage/Maison/Voiture via un modal interne (jamais un Alert natif)', async () => {
    await renderOpenSheet();
    await fireEvent.press(screen.getByTestId('quick-action-plan'));

    await waitFor(() => screen.getByTestId('plan-type-choice-option-scolaire'));
    expect(screen.getByTestId('plan-type-choice-option-voyage')).toBeTruthy();
    expect(screen.getByTestId('plan-type-choice-option-maison')).toBeTruthy();
    expect(screen.getByTestId('plan-type-choice-option-voiture')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('plan-type-choice-option-scolaire'));
    expect(mockNavigate).toHaveBeenCalledWith('SchoolWizard');
  });

  it('"Voyage" navigue vers TravelWizard', async () => {
    await renderOpenSheet();
    await fireEvent.press(screen.getByTestId('quick-action-plan'));
    await waitFor(() => screen.getByTestId('plan-type-choice-option-voyage'));

    await fireEvent.press(screen.getByTestId('plan-type-choice-option-voyage'));
    expect(mockNavigate).toHaveBeenCalledWith('TravelWizard');
  });

  it("§M1 — \"Maison\" et \"Voiture\" (référentiels M7, pas encore construits) sont visibles mais non cliquables : jamais un faux parcours", async () => {
    await renderOpenSheet();
    await fireEvent.press(screen.getByTestId('quick-action-plan'));
    await waitFor(() => screen.getByTestId('plan-type-choice-option-maison'));

    await fireEvent.press(screen.getByTestId('plan-type-choice-option-maison'));
    await fireEvent.press(screen.getByTestId('plan-type-choice-option-voiture'));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByText('Maison · non disponible')).toBeTruthy();
    expect(screen.getByText('Voiture · non disponible')).toBeTruthy();
  });
});
