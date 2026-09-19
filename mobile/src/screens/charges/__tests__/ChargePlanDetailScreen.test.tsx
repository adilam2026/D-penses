import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { ChargePlanDetailScreen } from '../ChargePlanDetailScreen';
import * as api from '../../../api/client';

/**
 * Recette post-Vague 3 (§4) — modifier, arrêter la récurrence (≠ supprimer),
 * supprimer (bloqué si historique de paiement, RG implicite).
 */
jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

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
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { id: 'cp1' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    getChargePlan: jest.fn(),
    listChargePlanDeadlines: jest.fn(),
    listCategories: jest.fn(),
    listAccounts: jest.fn(),
    updateChargePlan: jest.fn(),
    deleteChargePlan: jest.fn(),
    retireChargePlan: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

const PLAN = {
  id: 'cp1',
  label: 'Internet',
  categoryId: null,
  recurrenceRule: 'mensuel',
  recurrenceAnchorDate: '2026-09-27',
  status: 'actif' as const,
  obligationStatus: 'obligatoire',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockedApi.getChargePlan.mockResolvedValue(PLAN);
  mockedApi.listChargePlanDeadlines.mockResolvedValue([]);
  mockedApi.listCategories.mockResolvedValue([]);
  mockedApi.listAccounts.mockResolvedValue([{ id: 'acc1', name: 'Compte SG' }]);
});

it('modifie le libellé et la fréquence de la charge', async () => {
  mockedApi.updateChargePlan.mockResolvedValue({ ...PLAN, label: 'Internet fibre' });
  await render(<ChargePlanDetailScreen />);
  await waitFor(() => screen.getByDisplayValue('Internet'));

  await fireEvent.changeText(screen.getByDisplayValue('Internet'), 'Internet fibre');
  await fireEvent.press(screen.getByTestId('chargeplan-save'));

  await waitFor(() => expect(mockedApi.updateChargePlan).toHaveBeenCalledWith('cp1', expect.objectContaining({ label: 'Internet fibre' })));
});

it('"Arrêter la récurrence" bascule status=inactif (≠ supprimer, aucune donnée perdue)', async () => {
  mockedApi.updateChargePlan.mockResolvedValue({ ...PLAN, status: 'inactif' });
  await render(<ChargePlanDetailScreen />);
  await waitFor(() => screen.getByTestId('chargeplan-toggle-status'));

  await fireEvent.press(screen.getByTestId('chargeplan-toggle-status'));

  await waitFor(() => expect(mockedApi.updateChargePlan).toHaveBeenCalledWith('cp1', { status: 'inactif' }));
});

it('"Supprimer" demande confirmation puis appelle deleteChargePlan et revient en arrière', async () => {
  mockedApi.deleteChargePlan.mockResolvedValue({ deleted: true });
  await render(<ChargePlanDetailScreen />);
  await waitFor(() => screen.getByTestId('chargeplan-delete'));

  await fireEvent.press(screen.getByTestId('chargeplan-delete'));
  expect(Alert.alert).toHaveBeenCalled();
  const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  await buttons[1].onPress();

  await waitFor(() => expect(mockedApi.deleteChargePlan).toHaveBeenCalledWith('cp1'));
  expect(mockGoBack).toHaveBeenCalled();
});

it('affiche une erreur claire quand la suppression est refusée (historique de paiement, 409)', async () => {
  mockedApi.deleteChargePlan.mockRejectedValue(new api.ApiError(409, 'Impossible de supprimer : un historique de paiement existe déjà.'));
  await render(<ChargePlanDetailScreen />);
  await waitFor(() => screen.getByTestId('chargeplan-delete'));

  await fireEvent.press(screen.getByTestId('chargeplan-delete'));
  const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  await buttons[1].onPress();

  await waitFor(() => screen.getByText(/historique de paiement/));
  expect(mockGoBack).not.toHaveBeenCalled();
});

it('R6.2 §1/§3 : modifie la prochaine échéance et, optionnellement, le montant des échéances futures', async () => {
  mockedApi.updateChargePlan.mockResolvedValue({ ...PLAN, recurrenceAnchorDate: '2026-10-27' });
  await render(<ChargePlanDetailScreen />);
  await waitFor(() => screen.getByTestId('date-Prochaine échéance'));

  await fireEvent.changeText(screen.getByTestId('date-Prochaine échéance'), '2026-10-27');
  await fireEvent(screen.getByTestId('chargeplan-edit-amount-switch'), 'valueChange', true);
  await fireEvent.press(screen.getByText('Confirmé'));
  await fireEvent.changeText(screen.getByTestId('chargeplan-amount-input'), '349');
  await fireEvent.press(screen.getByTestId('chargeplan-save'));

  await waitFor(() =>
    expect(mockedApi.updateChargePlan).toHaveBeenCalledWith(
      'cp1',
      expect.objectContaining({ recurrenceAnchorDate: '2026-10-27', amountStatus: 'confirme', amountCurrent: 349 }),
    ),
  );
});

// Corrections consolidées §8 — compte d'imputation par défaut, modifiable
// depuis la fiche de la charge, jamais imposé (préremplissage au paiement seul).
it('corrections consolidées §8 — modifie le compte d\'imputation par défaut de la charge', async () => {
  mockedApi.listAccounts.mockResolvedValue([
    { id: 'acc1', name: 'Compte SG' },
    { id: 'acc2', name: 'Compte BP' },
  ]);
  mockedApi.updateChargePlan.mockResolvedValue({ ...PLAN, defaultAccountId: 'acc2' });
  await render(<ChargePlanDetailScreen />);
  await waitFor(() => screen.getByTestId('chargeplan-default-account-select'));

  await fireEvent.press(screen.getByTestId('chargeplan-default-account-select'));
  await waitFor(() => screen.getByTestId('chargeplan-default-account-select-option-acc2'));
  await fireEvent.press(screen.getByTestId('chargeplan-default-account-select-option-acc2'));
  await fireEvent.press(screen.getByTestId('chargeplan-save'));

  await waitFor(() =>
    expect(mockedApi.updateChargePlan).toHaveBeenCalledWith('cp1', expect.objectContaining({ defaultAccountId: 'acc2' })),
  );
});

// Corrections consolidées §14.1 — "Retirer du plan", distinct de "Supprimer" :
// visible uniquement pour un poste rattaché à un plan financier.
it('"Retirer du plan" n\'apparaît PAS pour un poste hors plan financier', async () => {
  await render(<ChargePlanDetailScreen />);
  await waitFor(() => screen.getByTestId('chargeplan-save'));

  expect(screen.queryByTestId('chargeplan-retire')).toBeNull();
});

it('"Retirer du plan" demande confirmation puis appelle retireChargePlan et revient en arrière', async () => {
  mockedApi.getChargePlan.mockResolvedValue({ ...PLAN, financialPlanId: 'plan1' });
  mockedApi.retireChargePlan.mockResolvedValue({ ...PLAN, status: 'inactif', financialPlanId: null, cancelledDeadlinesCount: 1 });
  await render(<ChargePlanDetailScreen />);
  await waitFor(() => screen.getByTestId('chargeplan-retire'));

  await fireEvent.press(screen.getByTestId('chargeplan-retire'));
  expect(Alert.alert).toHaveBeenCalled();
  const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  await buttons[1].onPress();

  await waitFor(() => expect(mockedApi.retireChargePlan).toHaveBeenCalledWith('cp1'));
  expect(mockGoBack).toHaveBeenCalled();
});

it('taper une échéance navigue vers DeadlineDetail', async () => {
  mockedApi.listChargePlanDeadlines.mockResolvedValue([
    { id: 'd1', dueDate: '2026-09-30', amountCurrent: 100, amountStatus: 'confirme', financialStatus: 'ouverte', resteAPayer: 100 },
  ]);
  await render(<ChargePlanDetailScreen />);
  await waitFor(() => screen.getByText(/30 sept/));

  await fireEvent.press(screen.getByText(/30 sept/));

  expect(mockNavigate).toHaveBeenCalledWith('DeadlineDetail', { id: 'd1' });
});
