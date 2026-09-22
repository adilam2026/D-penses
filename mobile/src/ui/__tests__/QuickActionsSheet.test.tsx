import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QuickActionsSheet } from '../QuickActionsSheet';
import { QuickActionsProvider, useQuickActions } from '../../state/QuickActionsContext';
import * as api from '../../api/client';

jest.mock('../useBottomInset', () => ({ useBottomInset: () => 16 }));

/**
 * Refonte maquette V6B §11 — tests de la bottom sheet "+" : exactement 4
 * actions (Dépense/Revenu/Versement enveloppe/Transfert), ouverture/fermeture,
 * et le chooser interne "Versement enveloppe" (liste les provisions/poches
 * réelles du foyer, jamais un Alert natif).
 */
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => Text != null && require('react').createElement(Text, null, props.name) };
});

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return {
    ...actual,
    listPockets: jest.fn(),
    listProvisions: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

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
  mockedApi.listPockets.mockResolvedValue([]);
  mockedApi.listProvisions.mockResolvedValue([]);
});

describe('QuickActionsSheet — les 4 actions (refonte maquette V6B §11)', () => {
  it('affiche exactement les 4 actions prescrites : Dépense/Revenu/Versement enveloppe/Transfert', async () => {
    await renderOpenSheet();
    expect(screen.getByTestId('quick-action-depense')).toBeTruthy();
    expect(screen.getByTestId('quick-action-revenu')).toBeTruthy();
    expect(screen.getByTestId('quick-action-versement')).toBeTruthy();
    expect(screen.getByTestId('quick-action-transfert')).toBeTruthy();
    // §11 — création de charge/budget/plan ne sont plus des entrées de premier
    // niveau : elles restent fonctionnelles depuis leur propre écran de liste.
    expect(screen.queryByTestId('quick-action-charge')).toBeNull();
    expect(screen.queryByTestId('quick-action-budget')).toBeNull();
    expect(screen.queryByTestId('quick-action-plan')).toBeNull();
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

describe('QuickActionsSheet — chooser "Versement enveloppe"', () => {
  it('liste les provisions et poches réelles du foyer, puis navigue vers EnvelopeDetail', async () => {
    mockedApi.listProvisions.mockResolvedValue([{ id: 'prov1', name: 'Scolarité' }]);
    mockedApi.listPockets.mockResolvedValue([{ id: 'pock1', name: 'Vacances' }]);
    await renderOpenSheet();

    await fireEvent.press(screen.getByTestId('quick-action-versement'));
    await waitFor(() => screen.getByTestId('envelope-choice-option-provision-prov1'));
    expect(screen.getByTestId('envelope-choice-option-savings_pocket-pock1')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('envelope-choice-option-provision-prov1'));
    expect(mockNavigate).toHaveBeenCalledWith('EnvelopeDetail', { kind: 'provision', id: 'prov1' });
  });

  it("sans aucune enveloppe, propose d'en créer une", async () => {
    await renderOpenSheet();
    await fireEvent.press(screen.getByTestId('quick-action-versement'));

    await waitFor(() => screen.getByTestId('envelope-choice-option-aucune'));
    await fireEvent.press(screen.getByTestId('envelope-choice-option-aucune'));
    expect(mockNavigate).toHaveBeenCalledWith('CreatePocket');
  });
});
