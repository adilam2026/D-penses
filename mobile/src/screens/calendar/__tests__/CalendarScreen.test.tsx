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

jest.mock('../../../ui/useTopInset', () => ({ useTopInset: () => 16 }));

jest.mock('../../../api/client', () => ({ getCalendar: jest.fn(), listFinancialPlans: jest.fn() }));
const mockedApi = api as jest.Mocked<typeof api>;

const EVENTS = [
  { date: '2026-09-10', kind: 'echeance' as const, label: 'Jardinier', amount: 600, deadlineId: 'd1' },
  { date: '2026-09-15', kind: 'echeance_payee' as const, label: 'Internet', amount: 299, deadlineId: 'd2' },
  { date: '2026-09-26', kind: 'revenu_prevu' as const, label: 'Salaire', amount: 8000, incomeOccurrenceId: 'occ1', incomeSourceId: 'src1' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.getCalendar.mockResolvedValue({ events: EVENTS });
  mockedApi.listFinancialPlans.mockResolvedValue([]);
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

// Corrections UI/UX finales §8 — la liste principale est groupée par mois
// (SEPTEMBRE 2026, OCTOBRE 2026...), ordre chronologique croissant.
it('groupe les événements par mois (en-têtes de section)', async () => {
  await render(<CalendarScreen />);
  await waitFor(() => screen.getByText('Jardinier'));

  expect(screen.getByText(/SEPTEMBRE 2026/)).toBeTruthy();
});

it('taper une échéance navigue vers DeadlineDetail', async () => {
  await render(<CalendarScreen />);
  await waitFor(() => screen.getByText('Jardinier'));

  await fireEvent.press(screen.getByText('Jardinier'));
  expect(mockNavigate).toHaveBeenCalledWith('DeadlineDetail', { id: 'd1' });
});

// Correction UX (Calendrier — occurrence de revenu) : le clic ouvre la fiche
// de CETTE occurrence précise (incomeOccurrenceId), jamais la source
// récurrente entière (IncomeSourceDetail, incomeSourceId).
it('taper un revenu prévu navigue vers IncomeOccurrenceDetail avec incomeOccurrenceId, jamais IncomeSourceDetail', async () => {
  await render(<CalendarScreen />);
  await waitFor(() => screen.getByText('Salaire'));

  await fireEvent.press(screen.getByText('Salaire'));
  expect(mockNavigate).toHaveBeenCalledWith('IncomeOccurrenceDetail', { id: 'occ1' });
  expect(mockNavigate).not.toHaveBeenCalledWith('IncomeSourceDetail', expect.anything());
});

// Point 5A — même date : ordre alphabétique du libellé, jamais l'ordre reçu de l'API.
it("point 5A — deux opérations à la même date sont triées par ordre alphabétique du libellé", async () => {
  mockedApi.getCalendar.mockResolvedValue({
    events: [
      { date: '2026-09-10', kind: 'echeance' as const, label: 'Électricité', amount: 200 },
      { date: '2026-09-10', kind: 'echeance' as const, label: 'Assurance', amount: 900 },
      { date: '2026-09-10', kind: 'echeance' as const, label: 'Carburant', amount: 400 },
    ],
  });
  await render(<CalendarScreen />);
  await waitFor(() => screen.getByText('Assurance'));

  const labels = screen.getAllByText(/Assurance|Carburant|Électricité/).map((n) => n.props.children);
  expect(labels).toEqual(['Assurance', 'Carburant', 'Électricité']);
});

// Point 5B — vue "Par catégorie / plan financier" : Mois → groupe → opérations,
// mêmes événements, jamais dupliqués/recalculés.
it('point 5B — la vue "Par catégorie / plan" regroupe les mêmes échéances par plan financier / catégorie, jamais un poste séparé par occurrence', async () => {
  mockedApi.listFinancialPlans.mockResolvedValue([{ id: 'plan1', label: 'Voiture · Opel Astra' }]);
  mockedApi.getCalendar.mockResolvedValue({
    events: [
      { date: '2026-09-05', kind: 'echeance' as const, label: 'Carburant', amount: 400, deadlineId: 'd1', financialPlanId: 'plan1', categoryId: null, categoryName: null },
      { date: '2026-09-12', kind: 'echeance' as const, label: 'Eau', amount: 150, deadlineId: 'd2', financialPlanId: null, categoryId: 'cat1', categoryName: 'Logement' },
      { date: '2026-09-20', kind: 'revenu_prevu' as const, label: 'Salaire', amount: 8000 },
    ],
  });

  await render(<CalendarScreen />);
  await waitFor(() => screen.getByTestId('calendar-view-mode-category'));
  await fireEvent.press(screen.getByTestId('calendar-view-mode-category'));

  await waitFor(() => screen.getByText('Voiture · Opel Astra'));
  expect(screen.getByText('Carburant')).toBeTruthy();
  expect(screen.getByText('Logement')).toBeTruthy();
  expect(screen.getByText('Eau')).toBeTruthy();
  expect(screen.getByText('Revenus')).toBeTruthy();
  expect(screen.getByText('Salaire')).toBeTruthy();
});
