import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { SubscriptionsWizardScreen } from '../SubscriptionsWizardScreen';
import * as api from '../../../api/client';

/** M8 (guard-rail §12) — Plan Abonnements : vue regroupée, aucun référentiel, jamais mensuel imposé. */
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
  return { ...actual, submitSubscriptionsWizard: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
});

it('crée un plan Abonnements : Netflix mensuel ET Microsoft 365 annuel, jamais mensuel imposé partout', async () => {
  mockedApi.submitSubscriptionsWizard.mockResolvedValue({ financialPlan: { id: 'p1' }, chargePlans: [] });
  await render(<SubscriptionsWizardScreen />);
  await waitFor(() => screen.getByTestId('subscriptions-poste-toggle-Netflix'));

  await fireEvent(screen.getByTestId('subscriptions-poste-toggle-Netflix'), 'valueChange', true);
  await fireEvent(screen.getByTestId('subscriptions-poste-toggle-Microsoft 365'), 'valueChange', true);
  await fireEvent.press(screen.getByText('Créer le plan Abonnements'));

  await waitFor(() => expect(mockedApi.submitSubscriptionsWizard).toHaveBeenCalled());
  const [payload] = mockedApi.submitSubscriptionsWizard.mock.calls[0];
  const netflix = payload.items.find((i: any) => i.label === 'Netflix')!;
  const office = payload.items.find((i: any) => i.label === 'Microsoft 365')!;
  expect(netflix.recurrenceRule).toBe('mensuel');
  expect(office.recurrenceRule).toBe('annuel'); // jamais forcé à mensuel
});

it('Google One (mensuel OU annuel selon le choix utilisateur) : la périodicité par défaut reste modifiable', async () => {
  mockedApi.submitSubscriptionsWizard.mockResolvedValue({ financialPlan: { id: 'p1' }, chargePlans: [] });
  await render(<SubscriptionsWizardScreen />);
  await waitFor(() => screen.getByTestId('subscriptions-poste-toggle-Google One'));

  await fireEvent(screen.getByTestId('subscriptions-poste-toggle-Google One'), 'valueChange', true);
  await fireEvent.press(screen.getByTestId('subscriptions-poste-recurrence-Google One'));
  await fireEvent.press(await screen.findByTestId('subscriptions-poste-recurrence-Google One-option-annuel'));
  await fireEvent.press(screen.getByText('Créer le plan Abonnements'));

  await waitFor(() => expect(mockedApi.submitSubscriptionsWizard).toHaveBeenCalled());
  const [payload] = mockedApi.submitSubscriptionsWizard.mock.calls[0];
  expect(payload.items[0].recurrenceRule).toBe('annuel');
});
