import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { TravelWizardScreen } from '../TravelWizardScreen';
import * as api from '../../../api/client';

/**
 * R6.2 (§13-14) — la "Date prévue" de chaque poste de dépense doit être
 * préremplie avec la date de début du voyage (jamais vide), rester une
 * simple valeur par défaut modifiable, ne jamais écraser une date déjà
 * personnalisée par l'utilisateur, et se resynchroniser sur la date de début
 * pour les postes non personnalisés si celle-ci change.
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

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { ...actual, listProvisions: jest.fn(), submitTravelWizard: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listProvisions.mockResolvedValue([]);
});

it('AE. la date de début du voyage préremplit "Date prévue" de chaque poste (jamais vide)', async () => {
  await render(<TravelWizardScreen />);
  await waitFor(() => screen.getByTestId('date-Début'));

  await fireEvent.changeText(screen.getByTestId('date-Début'), '2027-08-10');

  expect(screen.getByTestId('date-Date prévue — Hôtel').props.value).toBe('2027-08-10');
  expect(screen.getByTestId('date-Date prévue — Transport').props.value).toBe('2027-08-10');
});

it('AF/AG. la date reste modifiable, et une date personnalisée n\'est jamais écrasée par un nouveau changement de date de début', async () => {
  await render(<TravelWizardScreen />);
  await waitFor(() => screen.getByTestId('date-Début'));
  await fireEvent.changeText(screen.getByTestId('date-Début'), '2027-08-10');

  // AF — modifiable
  await fireEvent.changeText(screen.getByTestId('date-Date prévue — Hôtel'), '2027-08-05');
  expect(screen.getByTestId('date-Date prévue — Hôtel').props.value).toBe('2027-08-05');

  // AG — jamais écrasée par un nouveau changement de date de début
  await fireEvent.changeText(screen.getByTestId('date-Début'), '2027-09-01');
  expect(screen.getByTestId('date-Date prévue — Hôtel').props.value).toBe('2027-08-05');
});

it('AH. changer la date de début du voyage met à jour UNIQUEMENT la valeur par défaut des postes non personnalisés', async () => {
  await render(<TravelWizardScreen />);
  await waitFor(() => screen.getByTestId('date-Début'));
  await fireEvent.changeText(screen.getByTestId('date-Début'), '2027-08-10');

  // Transport reste par défaut (jamais touché), Hôtel est personnalisé.
  await fireEvent.changeText(screen.getByTestId('date-Date prévue — Hôtel'), '2027-08-05');
  await fireEvent.changeText(screen.getByTestId('date-Début'), '2027-09-01');

  expect(screen.getByTestId('date-Date prévue — Transport').props.value).toBe('2027-09-01');
  expect(screen.getByTestId('date-Date prévue — Hôtel').props.value).toBe('2027-08-05');
});

it('AI. une nouvelle dépense ajoutée ("Autres postes") reprend la date de début COURANTE, jamais l\'ancienne', async () => {
  await render(<TravelWizardScreen />);
  await waitFor(() => screen.getByTestId('date-Début'));
  await fireEvent.changeText(screen.getByTestId('date-Début'), '2027-08-10');
  await fireEvent.changeText(screen.getByTestId('date-Début'), '2027-09-01');

  await fireEvent.press(screen.getByText('+ Ajouter un poste'));

  expect(screen.getByTestId('date-Date prévue — poste 1').props.value).toBe('2027-09-01');
});

it('AJ/AK. une date avant OU après le voyage reste acceptée (jamais bornée)', async () => {
  await render(<TravelWizardScreen />);
  await waitFor(() => screen.getByTestId('date-Début'));
  await fireEvent.changeText(screen.getByTestId('date-Début'), '2027-08-10');
  await fireEvent.changeText(screen.getByTestId('date-Fin'), '2027-08-20');

  // AJ — avant le voyage (ex. billets/visa achetés en amont)
  await fireEvent.changeText(screen.getByTestId('date-Date prévue — Transport'), '2027-07-01');
  expect(screen.getByTestId('date-Date prévue — Transport').props.value).toBe('2027-07-01');

  // AK — après le voyage
  await fireEvent.changeText(screen.getByTestId('date-Date prévue — Hôtel'), '2027-09-15');
  expect(screen.getByTestId('date-Date prévue — Hôtel').props.value).toBe('2027-09-15');
});

it('envoie bien les dates par défaut au submit, sans jamais laisser un poste inclus sans dueDate', async () => {
  mockedApi.submitTravelWizard.mockResolvedValue({ financialPlan: { id: 'plan1' }, chargePlans: [] });
  await render(<TravelWizardScreen />);
  await waitFor(() => screen.getByTestId('date-Début'));
  await fireEvent.changeText(screen.getByTestId('date-Début'), '2027-08-10');

  await fireEvent.press(screen.getByText('Créer le plan Voyage'));

  await waitFor(() => expect(mockedApi.submitTravelWizard).toHaveBeenCalled());
  const [payload] = mockedApi.submitTravelWizard.mock.calls[0];
  for (const item of payload.items) {
    expect(item.dueDate).toBeTruthy();
  }
});
