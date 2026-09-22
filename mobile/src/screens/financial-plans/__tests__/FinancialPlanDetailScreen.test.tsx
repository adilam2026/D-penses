import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { FinancialPlanDetailScreen } from '../FinancialPlanDetailScreen';
import * as api from '../../../api/client';

/**
 * Convergence V6C §1/§2 — détail d'un plan financier = nom + description
 * facultative + liste des charges (libellé/montant/date) + "+ Ajouter une
 * charge". Plus aucune trace du moteur de couverture (budget connu/payé/
 * reste à financer/taux de couverture/options envisagées).
 */
jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: { id: 'plan-1' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => require('react').createElement(Text, null, props.name) };
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
    createChargePlan: jest.fn(),
    createDeadline: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

const PLAN = {
  id: 'plan-1',
  label: 'Scolarité 2026-2027',
  description: null,
  active: true,
  deadlinesCertain: [
    { id: 'd1', chargePlanId: 'cp-t1', dueDate: '2026-09-15', chargePlanLabel: 'Scolarité T1', amountCurrent: 21800, amountStatus: 'confirme' as const },
    { id: 'd2', chargePlanId: 'cp-resto', dueDate: '2026-09-15', chargePlanLabel: 'Restauration T1', amountCurrent: 1950, amountStatus: 'confirme' as const },
    { id: 'd3', chargePlanId: 'cp-uniforme', dueDate: '2026-09-20', chargePlanLabel: 'Uniforme', amountCurrent: 3395, amountStatus: 'confirme' as const },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.getFinancialPlan.mockResolvedValue(PLAN);
});

it('affiche le nom du plan et la liste des charges (libellé, montant, date) — jamais de budget/couverture/taux', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByText('Scolarité 2026-2027'));

  expect(screen.getByTestId('plan-charge-d1')).toBeTruthy();
  expect(screen.getByText('21 800 DH')).toBeTruthy();
  expect(screen.getByText('1 950 DH')).toBeTruthy();
  expect(screen.getByText('3 395 DH')).toBeTruthy();
  expect(screen.queryByText(/Budget connu/)).toBeNull();
  expect(screen.queryByText(/Reste à financer/)).toBeNull();
  expect(screen.queryByText(/TAUX DE COUVERTURE/)).toBeNull();
  expect(screen.queryByText(/Options envisagées/)).toBeNull();
});

it('affiche le bouton "+ Ajouter une charge" qui ouvre le formulaire de création', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-add-charge-button'));

  await fireEvent.press(screen.getByTestId('plan-add-charge-button'));

  await waitFor(() => expect(screen.getByTestId('plan-add-deadline-form')).toBeTruthy());
});

it('créer une charge appelle createChargePlan avec financialPlanId=ce plan, puis createDeadline', async () => {
  mockedApi.createChargePlan.mockResolvedValue({ id: 'new-cp' } as any);
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-add-charge-button'));
  await fireEvent.press(screen.getByTestId('plan-add-charge-button'));
  await waitFor(() => screen.getByTestId('plan-add-deadline-label'));

  await fireEvent.changeText(screen.getByTestId('plan-add-deadline-label'), 'Scolarité T2');
  await fireEvent.changeText(screen.getByTestId('plan-add-deadline-amount'), '21800');
  await fireEvent.changeText(screen.getByTestId('date-Date'), '2027-01-15');
  await fireEvent.press(screen.getByTestId('plan-add-deadline-save'));

  await waitFor(() =>
    expect(mockedApi.createChargePlan).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Scolarité T2', financialPlanId: 'plan-1' }),
    ),
  );
  expect(mockedApi.createDeadline).toHaveBeenCalledWith('new-cp', expect.objectContaining({ dueDate: '2027-01-15', amountCurrent: 21800 }));
});

it('le menu "•••" propose Modifier/Supprimer, jamais Dupliquer (retiré de la nouvelle UI simple)', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));

  await waitFor(() => expect(screen.getByText('Modifier')).toBeTruthy());
  expect(screen.getByText('Supprimer')).toBeTruthy();
  expect(screen.queryByText('Dupliquer')).toBeNull();
});

it('Modifier envoie label + description (jamais periodStart/periodEnd)', async () => {
  await render(<FinancialPlanDetailScreen />);
  await waitFor(() => screen.getByTestId('plan-menu-button'));
  await fireEvent.press(screen.getByTestId('plan-menu-button'));
  await waitFor(() => screen.getByText('Modifier'));
  await fireEvent.press(screen.getByText('Modifier'));
  await waitFor(() => screen.getByTestId('plan-edit-form'));

  await fireEvent.changeText(screen.getByTestId('plan-edit-description'), 'Année scolaire complète');
  await fireEvent.press(screen.getByTestId('plan-edit-save'));

  await waitFor(() =>
    expect(mockedApi.updateFinancialPlan).toHaveBeenCalledWith('plan-1', { label: 'Scolarité 2026-2027', description: 'Année scolaire complète' }),
  );
});
