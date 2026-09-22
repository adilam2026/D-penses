import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { CreateChargeScreen } from '../CreateChargeScreen';
import * as api from '../../../api/client';

/**
 * Recette post-Vague 3 (§2/§3) — catégorie et fréquence via sélecteur compact,
 * plus de 15-20 chips affichées en permanence.
 */
jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    listCategories: jest.fn(),
    listAccounts: jest.fn(),
    listFinancialPlans: jest.fn(),
    createChargePlan: jest.fn(),
    createDeadline: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listCategories.mockResolvedValue([
    { id: 'cat1', name: 'Logement', kind: 'expense' },
    { id: 'cat2', name: 'Loisirs', kind: 'expense' },
  ]);
  mockedApi.listAccounts.mockResolvedValue([{ id: 'acc1', name: 'Compte SG' }]);
  mockedApi.listFinancialPlans.mockResolvedValue([]);
});

it('catégorie via sélecteur compact (jamais des chips permanentes)', async () => {
  await render(<CreateChargeScreen />);
  await waitFor(() => screen.getByTestId('charge-category-select'));

  expect(screen.queryByText('Loisirs')).toBeNull(); // pas affiché en permanence, seulement dans la liste ouverte

  await fireEvent.press(screen.getByTestId('charge-category-select'));
  await waitFor(() => screen.getByTestId('charge-category-select-option-cat2'));
  await fireEvent.press(screen.getByTestId('charge-category-select-option-cat2'));

  expect(screen.getByText('Loisirs')).toBeTruthy();
});

it('fréquence via sélecteur compact, et crée la charge avec la fréquence choisie', async () => {
  mockedApi.createChargePlan.mockResolvedValue({ id: 'cp1' });
  mockedApi.createDeadline.mockResolvedValue({ id: 'd1' });
  await render(<CreateChargeScreen />);
  await waitFor(() => screen.getByTestId('charge-frequency-select'));

  await fireEvent.press(screen.getByTestId('charge-frequency-select'));
  await waitFor(() => screen.getByTestId('charge-frequency-select-option-trimestriel'));
  await fireEvent.press(screen.getByTestId('charge-frequency-select-option-trimestriel'));

  await fireEvent.changeText(screen.getByPlaceholderText('Ex. Internet, Loyer, École'), 'Assurance');
  await fireEvent.press(screen.getByText('Confirmé'));
  await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '450');

  await fireEvent.press(screen.getByTestId('create-charge-submit'));

  await waitFor(() =>
    expect(mockedApi.createChargePlan).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Assurance', recurrenceRule: 'trimestriel', recurrenceAnchorDate: expect.any(String) }),
    ),
  );
  expect(mockGoBack).toHaveBeenCalled();
});

it('R6.2 §1 : la même date pilote la première échéance ET l\'ancre de récurrence (jamais un jour du mois séparé)', async () => {
  mockedApi.createChargePlan.mockResolvedValue({ id: 'cp1' });
  mockedApi.createDeadline.mockResolvedValue({ id: 'd1' });
  await render(<CreateChargeScreen />);
  await waitFor(() => screen.getByTestId('charge-frequency-select'));

  await fireEvent.changeText(screen.getByPlaceholderText('Ex. Internet, Loyer, École'), 'Internet');
  await fireEvent.press(screen.getByText('Confirmé'));
  await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '299');
  await fireEvent.press(screen.getByTestId('create-charge-submit'));

  await waitFor(() => expect(mockedApi.createChargePlan).toHaveBeenCalled());
  const [payload] = mockedApi.createChargePlan.mock.calls[0];
  expect(payload.recurrenceAnchorDate).toBe(payload.startDate);
});

// Corrections consolidées §8 — le compte d'imputation par défaut est facultatif
// et sert uniquement de préremplissage au paiement, jamais imposé à la création.
it('corrections consolidées §8 — permet de choisir un compte d\'imputation par défaut (facultatif)', async () => {
  mockedApi.listAccounts.mockResolvedValue([
    { id: 'acc1', name: 'Compte SG' },
    { id: 'acc2', name: 'Compte BP' },
  ]);
  mockedApi.createChargePlan.mockResolvedValue({ id: 'cp1' });
  mockedApi.createDeadline.mockResolvedValue({ id: 'd1' });
  await render(<CreateChargeScreen />);
  await waitFor(() => screen.getByTestId('charge-default-account-select'));

  await fireEvent.press(screen.getByTestId('charge-default-account-select'));
  await waitFor(() => screen.getByTestId('charge-default-account-select-option-acc2'));
  await fireEvent.press(screen.getByTestId('charge-default-account-select-option-acc2'));

  await fireEvent.changeText(screen.getByPlaceholderText('Ex. Internet, Loyer, École'), 'Loyer');
  await fireEvent.press(screen.getByText('Confirmé'));
  await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '4500');
  await fireEvent.press(screen.getByTestId('create-charge-submit'));

  await waitFor(() =>
    expect(mockedApi.createChargePlan).toHaveBeenCalledWith(expect.objectContaining({ defaultAccountId: 'acc2' })),
  );
});

// Convergence V6 §9 — "Plan financier : Aucun / Scolarité / Vacances / etc."
it('§9 — permet de rattacher la charge à un plan financier existant (facultatif)', async () => {
  mockedApi.listFinancialPlans.mockResolvedValue([
    { id: 'plan-scolarite', label: 'Scolarité 2026-2027' },
    { id: 'plan-vacances', label: 'Vacances été 2027' },
  ]);
  mockedApi.createChargePlan.mockResolvedValue({ id: 'cp1' });
  mockedApi.createDeadline.mockResolvedValue({ id: 'd1' });
  await render(<CreateChargeScreen />);
  await waitFor(() => screen.getByTestId('charge-financial-plan-select'));

  await fireEvent.press(screen.getByTestId('charge-financial-plan-select'));
  await waitFor(() => screen.getByTestId('charge-financial-plan-select-option-plan-scolarite'));
  await fireEvent.press(screen.getByTestId('charge-financial-plan-select-option-plan-scolarite'));

  await fireEvent.changeText(screen.getByPlaceholderText('Ex. Internet, Loyer, École'), 'Scolarité T2');
  await fireEvent.press(screen.getByText('Confirmé'));
  await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '21800');
  await fireEvent.press(screen.getByTestId('create-charge-submit'));

  await waitFor(() =>
    expect(mockedApi.createChargePlan).toHaveBeenCalledWith(expect.objectContaining({ financialPlanId: 'plan-scolarite' })),
  );
});

it('§9 — laisse "Aucun" par défaut : aucun financialPlanId envoyé si non choisi', async () => {
  mockedApi.listFinancialPlans.mockResolvedValue([{ id: 'plan-scolarite', label: 'Scolarité 2026-2027' }]);
  mockedApi.createChargePlan.mockResolvedValue({ id: 'cp1' });
  mockedApi.createDeadline.mockResolvedValue({ id: 'd1' });
  await render(<CreateChargeScreen />);
  await waitFor(() => screen.getByTestId('charge-financial-plan-select'));

  await fireEvent.changeText(screen.getByPlaceholderText('Ex. Internet, Loyer, École'), 'Internet');
  await fireEvent.press(screen.getByText('Confirmé'));
  await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '299');
  await fireEvent.press(screen.getByTestId('create-charge-submit'));

  await waitFor(() => expect(mockedApi.createChargePlan).toHaveBeenCalled());
  expect(mockedApi.createChargePlan.mock.calls[0][0].financialPlanId).toBeUndefined();
});
