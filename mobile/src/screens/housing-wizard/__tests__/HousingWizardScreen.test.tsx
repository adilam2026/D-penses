import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { HousingWizardScreen } from '../HousingWizardScreen';
import * as api from '../../../api/client';

/** M8 — Plan Maison : même patron que VehicleWizardScreen, postes groupés par catégorie. */
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
  return { ...actual, listHousing: jest.fn(), submitHousingWizard: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listHousing.mockResolvedValue([]);
});

it('crée un logement inline (nom uniquement) et un poste de chaque catégorie', async () => {
  mockedApi.submitHousingWizard.mockResolvedValue({ financialPlan: { id: 'p1' }, housing: { id: 'h1', name: 'Villa Almaz' }, chargePlans: [] });
  await render(<HousingWizardScreen />);
  await waitFor(() => screen.getByTestId('housing-name-input'));

  await fireEvent.changeText(screen.getByTestId('housing-name-input'), 'Villa Almaz');
  await fireEvent(screen.getByTestId('housing-poste-toggle-jardinier'), 'valueChange', true);
  await fireEvent(screen.getByTestId('housing-poste-toggle-assurance-habitation'), 'valueChange', true);
  await fireEvent.press(screen.getByText('Créer le plan Maison'));

  await waitFor(() => expect(mockedApi.submitHousingWizard).toHaveBeenCalled());
  const [payload] = mockedApi.submitHousingWizard.mock.calls[0];
  expect(payload.housingName).toBe('Villa Almaz');
  expect(payload.items).toHaveLength(2);
  const jardinier = payload.items.find((i: any) => i.label === 'Jardinier')!;
  const assurance = payload.items.find((i: any) => i.label === 'Assurance habitation')!;
  expect(jardinier.recurrenceRule).toBe('mensuel');
  expect(assurance.recurrenceRule).toBe('annuel');
});

it('la périodicité suggérée reste TOUJOURS modifiable (Pisciniste : mensuel → ponctuel), et "toutes les 2 semaines" (non compatible avec le moteur existant) n\'est jamais proposée', async () => {
  mockedApi.submitHousingWizard.mockResolvedValue({ financialPlan: { id: 'p1' }, housing: { id: 'h1', name: 'X' }, chargePlans: [] });
  await render(<HousingWizardScreen />);
  await waitFor(() => screen.getByTestId('housing-name-input'));
  await fireEvent.changeText(screen.getByTestId('housing-name-input'), 'Villa Almaz');

  await fireEvent(screen.getByTestId('housing-poste-toggle-pisciniste'), 'valueChange', true);
  await fireEvent.press(screen.getByTestId('housing-poste-recurrence-pisciniste'));
  expect(screen.queryByTestId('housing-poste-recurrence-pisciniste-option-toutes_les_2_semaines')).toBeNull();
  await fireEvent.press(await screen.findByTestId('housing-poste-recurrence-pisciniste-option-ponctuel'));

  await fireEvent.press(screen.getByText('Créer le plan Maison'));

  await waitFor(() => expect(mockedApi.submitHousingWizard).toHaveBeenCalled());
  const [payload] = mockedApi.submitHousingWizard.mock.calls[0];
  expect(payload.items[0].recurrenceRule).toBe('ponctuel');
});

it('deux postes "Électricité" (Énergie et Entretien) restent distincts, jamais fusionnés', async () => {
  mockedApi.submitHousingWizard.mockResolvedValue({ financialPlan: { id: 'p1' }, housing: { id: 'h1', name: 'X' }, chargePlans: [] });
  await render(<HousingWizardScreen />);
  await waitFor(() => screen.getByTestId('housing-name-input'));
  await fireEvent.changeText(screen.getByTestId('housing-name-input'), 'Villa Almaz');

  await fireEvent(screen.getByTestId('housing-poste-toggle-electricite-energie'), 'valueChange', true);
  await fireEvent(screen.getByTestId('housing-poste-toggle-electricite-entretien'), 'valueChange', true);
  await fireEvent.press(screen.getByText('Créer le plan Maison'));

  await waitFor(() => expect(mockedApi.submitHousingWizard).toHaveBeenCalled());
  const [payload] = mockedApi.submitHousingWizard.mock.calls[0];
  expect(payload.items.filter((i: any) => i.label === 'Électricité')).toHaveLength(2);
});
