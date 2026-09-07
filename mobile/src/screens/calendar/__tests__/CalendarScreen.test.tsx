import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { CalendarScreen } from '../CalendarScreen';
import * as api from '../../../api/client';

/**
 * Recette téléphone réel §9 : le calendrier ne doit plus dépendre uniquement de
 * la couleur (points quasi identiques) — chaque type d'événement a désormais
 * un pictogramme distinct, et une légende repliable explique le code visuel.
 */
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => require('react').createElement(Text, null, props.name) };
});

jest.mock('../../../api/client', () => ({ getCalendar: jest.fn() }));
const mockedApi = api as jest.Mocked<typeof api>;

const EVENTS = [
  { date: '2026-09-10', kind: 'echeance' as const, label: 'Jardinier', amount: 600, deadlineId: 'd1' },
  { date: '2026-09-15', kind: 'echeance_payee' as const, label: 'Internet', amount: 299, deadlineId: 'd2' },
  { date: '2026-09-26', kind: 'revenu_prevu' as const, label: 'Salaire', amount: 8000 },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.getCalendar.mockResolvedValue({ events: EVENTS });
});

it('affiche un événement par ligne avec sa date/libellé/type', async () => {
  await render(<CalendarScreen />);
  await waitFor(() => screen.getByText('Jardinier'));
  expect(screen.getByText('Internet')).toBeTruthy();
  expect(screen.getByText('Salaire')).toBeTruthy();
});

it('la légende est repliée par défaut, puis affiche les 5 types', async () => {
  await render(<CalendarScreen />);
  await waitFor(() => screen.getByTestId('legend-toggle'));
  expect(screen.queryByTestId('legend-panel')).toBeNull();

  await fireEvent.press(screen.getByTestId('legend-toggle'));

  const legend = screen.getByTestId('legend-panel');
  expect(legend).toBeTruthy();
  expect(screen.getByText('À payer')).toBeTruthy();
  expect(screen.getByText('Payé')).toBeTruthy();
  expect(screen.getByText('Revenu prévu')).toBeTruthy();
  expect(screen.getByText('Montant inconnu')).toBeTruthy();
  expect(screen.getByText('Facture attendue')).toBeTruthy();
});

it('taper une échéance navigue vers DeadlineDetail, un revenu prévu (sans deadlineId) ne navigue pas', async () => {
  await render(<CalendarScreen />);
  await waitFor(() => screen.getByText('Jardinier'));

  await fireEvent.press(screen.getByText('Jardinier'));
  expect(mockNavigate).toHaveBeenCalledWith('DeadlineDetail', { id: 'd1' });

  mockNavigate.mockClear();
  await fireEvent.press(screen.getByText('Salaire'));
  expect(mockNavigate).not.toHaveBeenCalled();
});
