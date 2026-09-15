import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { VehicleWizardScreen } from '../VehicleWizardScreen';
import * as api from '../../../api/client';

/**
 * M7 — Plan Voiture : sélection/création du véhicule (nom uniquement, guard-rail
 * §1), postes suggérés avec périodicité TOUJOURS modifiable (guard-rail §6/§7,
 * jamais imposée), réutilise POST /vehicle-wizard (ChargePlan/Deadline existant).
 */
jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));
jest.mock('../../../ui/useTopInset', () => ({ useTopInset: () => 16 }));

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
  return { ...actual, listVehicles: jest.fn(), submitVehicleWizard: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listVehicles.mockResolvedValue([]);
});

it('crée un véhicule inline (nom uniquement) et un poste avec sa périodicité par défaut', async () => {
  mockedApi.submitVehicleWizard.mockResolvedValue({ financialPlan: { id: 'p1' }, vehicle: { id: 'v1', name: 'Audi Q5' }, chargePlans: [] });
  await render(<VehicleWizardScreen />);
  await waitFor(() => screen.getByTestId('vehicle-name-input'));

  await fireEvent.changeText(screen.getByTestId('vehicle-name-input'), 'Audi Q5');
  await fireEvent(screen.getByTestId('vehicle-poste-toggle-Assurance'), 'valueChange', true);
  await fireEvent.press(screen.getByText('Créer le plan Voiture'));

  await waitFor(() => expect(mockedApi.submitVehicleWizard).toHaveBeenCalled());
  const [payload] = mockedApi.submitVehicleWizard.mock.calls[0];
  expect(payload.vehicleName).toBe('Audi Q5');
  expect(payload.vehicleId).toBeUndefined();
  expect(payload.items).toHaveLength(1);
  expect(payload.items[0].label).toBe('Assurance');
  expect(payload.items[0].recurrenceRule).toBe('annuel'); // valeur par défaut suggérée
});

it("la périodicité suggérée reste TOUJOURS modifiable (jamais imposée) — Vidange changée de semestriel à ponctuel", async () => {
  mockedApi.submitVehicleWizard.mockResolvedValue({ financialPlan: { id: 'p1' }, vehicle: { id: 'v1', name: 'X' }, chargePlans: [] });
  await render(<VehicleWizardScreen />);
  await waitFor(() => screen.getByTestId('vehicle-name-input'));
  await fireEvent.changeText(screen.getByTestId('vehicle-name-input'), 'Opel Corsa');

  await fireEvent(screen.getByTestId('vehicle-poste-toggle-Vidange'), 'valueChange', true);
  await fireEvent.press(screen.getByTestId('vehicle-poste-recurrence-Vidange'));
  await fireEvent.press(await screen.findByTestId('vehicle-poste-recurrence-Vidange-option-ponctuel'));

  await fireEvent.press(screen.getByText('Créer le plan Voiture'));

  await waitFor(() => expect(mockedApi.submitVehicleWizard).toHaveBeenCalled());
  const [payload] = mockedApi.submitVehicleWizard.mock.calls[0];
  expect(payload.items[0].recurrenceRule).toBe('ponctuel'); // jamais figé à la suggestion initiale (semestriel)
});

it('sélectionne un véhicule EXISTANT (jamais de doublon) : vehicleId envoyé, vehicleName absent', async () => {
  mockedApi.listVehicles.mockResolvedValue([{ id: 'v1', name: 'Voiture Lamiaa', status: 'active' }]);
  mockedApi.submitVehicleWizard.mockResolvedValue({ financialPlan: { id: 'p1' }, vehicle: { id: 'v1', name: 'Voiture Lamiaa' }, chargePlans: [] });
  await render(<VehicleWizardScreen />);
  await waitFor(() => screen.getByTestId('vehicle-select'));

  // Le véhicule existant est présélectionné par défaut (jamais forcé à "nouveau").
  expect(screen.queryByTestId('vehicle-name-input')).toBeNull();

  await fireEvent(screen.getByTestId('vehicle-poste-toggle-Carburant'), 'valueChange', true);
  await fireEvent.press(screen.getByText('Créer le plan Voiture'));

  await waitFor(() => expect(mockedApi.submitVehicleWizard).toHaveBeenCalled());
  const [payload] = mockedApi.submitVehicleWizard.mock.calls[0];
  expect(payload.vehicleId).toBe('v1');
  expect(payload.vehicleName).toBeUndefined();
});
