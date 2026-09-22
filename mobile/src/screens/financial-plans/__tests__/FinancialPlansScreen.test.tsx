import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { FinancialPlansScreen } from '../FinancialPlansScreen';
import * as api from '../../../api/client';

/**
 * Convergence V6C §1/§2 — le plan financier est désormais un simple
 * regroupement de charges : liste "Nom / N charges / [Voir]" + "+ Ajouter un
 * plan" (Nom, puis description facultative). Plus aucun wizard École/Voyage/
 * Voiture/Maison/Abonnements ici, plus aucun budget/couverture/taux.
 */
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => require('react').createElement(Text, null, props.name) };
});

jest.mock('../../../api/client', () => ({
  listFinancialPlans: jest.fn(),
  createFinancialPlan: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listFinancialPlans.mockResolvedValue([]);
});

function plan(label: string, id: string, chargeCount = 0) {
  return { id, label, description: null, active: true, chargeCount };
}

it('affiche un seul bouton "+" ouvrant directement le formulaire de création (jamais un choix de type de plan)', async () => {
  await render(<FinancialPlansScreen />);
  await waitFor(() => screen.getByTestId('financial-plans-add-button'));

  await fireEvent.press(screen.getByTestId('financial-plans-add-button'));

  await waitFor(() => expect(screen.getByTestId('financial-plan-create-form')).toBeTruthy());
  expect(screen.getByTestId('financial-plan-create-label')).toBeTruthy();
  expect(screen.getByTestId('financial-plan-create-description')).toBeTruthy();
  expect(screen.queryByTestId('plan-type-choice')).toBeNull();
});

it('affiche chaque plan avec "N charges" et un bouton [Voir], jamais de budget/couverture/objectif', async () => {
  mockedApi.listFinancialPlans.mockResolvedValue([plan('Scolarité 2026-2027', 'p1', 6), plan('Vacances été 2027', 'p2', 4)]);

  await render(<FinancialPlansScreen />);
  await waitFor(() => screen.getByText('Scolarité 2026-2027'));

  expect(screen.getByText('6 charges')).toBeTruthy();
  expect(screen.getByText('4 charges')).toBeTruthy();
  expect(screen.queryByText(/Payé/)).toBeNull();
  expect(screen.queryByText(/Provisionné/)).toBeNull();
  expect(screen.queryByText(/Reste à financer/)).toBeNull();
  expect(screen.queryByText(/constitué/)).toBeNull();
});

it('[Voir] navigue vers le détail du plan', async () => {
  mockedApi.listFinancialPlans.mockResolvedValue([plan('Scolarité 2026-2027', 'p1', 6)]);
  await render(<FinancialPlansScreen />);
  await waitFor(() => screen.getByTestId('financial-plan-view-p1'));

  await fireEvent.press(screen.getByTestId('financial-plan-view-p1'));

  expect(mockNavigate).toHaveBeenCalledWith('FinancialPlanDetail', { id: 'p1' });
});

it('créer un plan avec Nom + description appelle createFinancialPlan puis navigue vers le détail', async () => {
  mockedApi.createFinancialPlan.mockResolvedValue({ id: 'new-plan' } as any);
  await render(<FinancialPlansScreen />);
  await waitFor(() => screen.getByTestId('financial-plans-add-button'));
  await fireEvent.press(screen.getByTestId('financial-plans-add-button'));

  await fireEvent.changeText(screen.getByTestId('financial-plan-create-label'), 'Vacances été 2027');
  await fireEvent.changeText(screen.getByTestId('financial-plan-create-description'), "Voyage en famille l'été prochain");
  await fireEvent.press(screen.getByTestId('financial-plan-create-save'));

  await waitFor(() =>
    expect(mockedApi.createFinancialPlan).toHaveBeenCalledWith({ label: 'Vacances été 2027', description: "Voyage en famille l'été prochain" }),
  );
  expect(mockNavigate).toHaveBeenCalledWith('FinancialPlanDetail', { id: 'new-plan' });
});

// Point 9 — ordre alphabétique croissant, insensible à la casse et aux accents.
it('point 9 — affiche les plans par ordre alphabétique croissant, insensible à la casse et aux accents', async () => {
  mockedApi.listFinancialPlans.mockResolvedValue([
    plan('Voiture · Opel Astra', 'p1'),
    plan('abonnements', 'p2'),
    plan('École 2026/2027 — EFI', 'p3'),
    plan('Maison · Villa Almaz', 'p4'),
  ]);

  await render(<FinancialPlansScreen />);
  await waitFor(() => screen.getByText('abonnements'));

  const titles = screen.getAllByText(/abonnements|École|Maison|Voiture/).map((n) => n.props.children);
  expect(titles).toEqual(['abonnements', 'École 2026/2027 — EFI', 'Maison · Villa Almaz', 'Voiture · Opel Astra']);
});
