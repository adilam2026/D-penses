import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { QuickActionsSheet } from '../QuickActionsSheet';
import { QuickActionsProvider, useQuickActions } from '../../state/QuickActionsContext';
import * as api from '../../api/client';

/**
 * Tests de la bottom sheet "+" (Vague 3 §3/§4/§31) : les 6 actions, ouverture/
 * fermeture, et l'anticipation des prérequis (jamais une impasse — même
 * pattern que QuickAddScreen.promptCreateAccount()).
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

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return { ...actual, listPockets: jest.fn(), listProvisions: jest.fn(), listOpenDeadlines: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

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
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

describe('QuickActionsSheet — les 6 actions (§3)', () => {
  it('affiche exactement les 6 actions prescrites', async () => {
    await renderOpenSheet();
    expect(screen.getByTestId('quick-action-depense')).toBeTruthy();
    expect(screen.getByTestId('quick-action-revenu')).toBeTruthy();
    expect(screen.getByTestId('quick-action-paiement')).toBeTruthy();
    expect(screen.getByTestId('quick-action-alimenter')).toBeTruthy();
    expect(screen.getByTestId('quick-action-plan')).toBeTruthy();
    expect(screen.getByTestId('quick-action-transfert')).toBeTruthy();
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

  it('"Annuler" ferme la sheet', async () => {
    await renderOpenSheet();
    await fireEvent.press(screen.getByText('Annuler'));
    await waitFor(() => expect(screen.queryByTestId('quick-actions-sheet')).toBeNull());
  });
});

describe('QuickActionsSheet — prérequis anticipés (§4)', () => {
  it("Alimenter une enveloppe SANS enveloppe existante → jamais une impasse, propose d'en créer une", async () => {
    mockedApi.listPockets.mockResolvedValue([]);
    mockedApi.listProvisions.mockResolvedValue([]);
    await renderOpenSheet();

    await fireEvent.press(screen.getByTestId('quick-action-alimenter'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const [title, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe("Vous n'avez pas encore d'enveloppe.");
    expect(buttons.map((b: { text: string }) => b.text)).toEqual(['Annuler', 'Créer une enveloppe']);

    buttons[1].onPress();
    expect(mockNavigate).toHaveBeenCalledWith('CreatePocket', {});
  });

  it('Alimenter une enveloppe AVEC des enveloppes existantes → va directement à la liste, pas de gate', async () => {
    mockedApi.listPockets.mockResolvedValue([{ id: 'p1', name: 'École' }]);
    mockedApi.listProvisions.mockResolvedValue([]);
    await renderOpenSheet();

    await fireEvent.press(screen.getByTestId('quick-action-alimenter'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('Enveloppes'));
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("Payer une échéance SANS échéance ouverte → propose de créer une charge récurrente", async () => {
    mockedApi.listOpenDeadlines.mockResolvedValue([]);
    await renderOpenSheet();

    await fireEvent.press(screen.getByTestId('quick-action-paiement'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const [title, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(title).toBe("Vous n'avez pas encore d'échéance à payer.");
    buttons[1].onPress();
    expect(mockNavigate).toHaveBeenCalledWith('Charges');
  });

  it('Payer une échéance AVEC des échéances ouvertes → va directement à la saisie', async () => {
    mockedApi.listOpenDeadlines.mockResolvedValue([{ id: 'd1' }]);
    await renderOpenSheet();

    await fireEvent.press(screen.getByTestId('quick-action-paiement'));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('QuickAdd', { mode: 'paiement' }));
  });

  it('Créer un plan propose un choix École/Voyage, jamais une impasse', async () => {
    await renderOpenSheet();
    await fireEvent.press(screen.getByTestId('quick-action-plan'));

    expect(Alert.alert).toHaveBeenCalled();
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    buttons[1].onPress();
    expect(mockNavigate).toHaveBeenCalledWith('SchoolWizard');
  });
});
