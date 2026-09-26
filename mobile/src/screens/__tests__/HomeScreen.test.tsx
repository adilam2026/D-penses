import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { HomeScreen } from '../HomeScreen';
import * as api from '../../api/client';
import { clearCache } from '../../state/cache';

/**
 * Refonte maquette V6B §3 — Accueil centré sur les comptes (jamais de
 * dashboard global, jamais de total revenus/dépenses). Vérifie : état vide,
 * rendu d'une carte compte (solde, enveloppes affectées, compte dédié), bloc
 * "À faire" (charge à payer proche + provision à compléter), navigation.
 */
jest.mock('../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));
jest.mock('../../ui/useTopInset', () => ({ useTopInset: () => 16 }));
// La résolution réelle de @expo/vector-icons entraîne expo-font -> expo-asset
// (non installé dans ce projet, jamais requis par le natif/le bundle réel où
// Metro sait le résoudre autrement) : mock minimal, comme DateField ailleurs.
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  return { Ionicons: (props: any) => React.createElement('Ionicons', props) };
});

const mockNavigate = jest.fn();
const mockGetParent = jest.fn(() => ({ navigate: mockNavigate }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ getParent: mockGetParent, navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../api/client', () => {
  const actual = jest.requireActual('../../api/client');
  return {
    ...actual,
    listAccounts: jest.fn(),
    listOpenDeadlines: jest.fn(),
    listProvisions: jest.fn(),
    getProvisionSufficiency: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

function account(overrides: Partial<api.AccountApi>): api.AccountApi {
  return {
    id: 'acc1',
    name: 'Compte courant',
    type: 'courant',
    status: 'actif',
    includeInOperationalTreasury: true,
    soldeCourant: 5000,
    reservedByEnvelopes: 0,
    envelopes: [],
    bankName: 'CIH',
    ownerUserId: null,
    ownerLabel: null,
    isDedicated: false,
    dedicatedCategoryId: null,
    dedicatedFeed: null,
    ...overrides,
  } as api.AccountApi;
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  mockedApi.listAccounts.mockResolvedValue([]);
  mockedApi.listOpenDeadlines.mockResolvedValue([]);
  mockedApi.listProvisions.mockResolvedValue([]);
});

it("affiche un état vide quand il n'y a aucun compte", async () => {
  await render(<HomeScreen />);
  await waitFor(() => expect(screen.getByText('Aucun compte pour l\'instant.')).toBeTruthy());
  expect(screen.getByText('Rien à faire pour le moment.')).toBeTruthy();
});

it('affiche le solde, la banque et les enveloppes affectées d\'un compte (jamais additives au solde)', async () => {
  mockedApi.listAccounts.mockResolvedValue([
    account({
      soldeCourant: 12000,
      reservedByEnvelopes: 3000,
      envelopes: [{ id: 'env1', kind: 'savings_pocket', name: 'Vacances', amount: 3000, subtitle: 'reserve' }],
    }),
  ]);
  await render(<HomeScreen />);

  await waitFor(() => expect(screen.getByTestId('home-account-card-acc1')).toBeTruthy());
  expect(screen.getByText('12 000 DH')).toBeTruthy();
  expect(screen.getByText(/Vacances/)).toBeTruthy();
});

it('affiche "Banque · Propriétaire" quand les deux sont connus', async () => {
  mockedApi.listAccounts.mockResolvedValue([account({ bankName: 'CIH', ownerLabel: 'Lamiaa' })]);
  await render(<HomeScreen />);

  await waitFor(() => expect(screen.getByText('CIH · Lamiaa')).toBeTruthy());
});

it('affiche la note "compte dédié" avec son alimentation récurrente', async () => {
  mockedApi.listAccounts.mockResolvedValue([
    account({
      isDedicated: true,
      dedicatedFeed: { fromAccountName: 'Compte courant', amount: 1500, recurrenceRule: 'mensuel' },
    }),
  ]);
  await render(<HomeScreen />);

  await waitFor(() => expect(screen.getByText(/Alimenté depuis Compte courant/)).toBeTruthy());
});

it('le bloc "À faire" liste une charge proche à payer et propose Payer', async () => {
  mockedApi.listAccounts.mockResolvedValue([account({})]);
  mockedApi.listOpenDeadlines.mockResolvedValue([
    {
      id: 'dl1',
      dueDate: new Date(Date.now() + 5 * 86400000).toISOString(),
      amountStatus: 'confirme',
      resteAPayer: '450',
      chargePlan: { label: 'Électricité', defaultAccountId: null },
    },
  ]);
  await render(<HomeScreen />);

  await waitFor(() => expect(screen.getByText('Électricité')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('home-todo-pay-dl1'));
  expect(mockNavigate).toHaveBeenCalledWith('DeadlineDetail', { id: 'dl1' });
});

it('le bloc "À faire" liste une provision à compléter et propose Verser', async () => {
  mockedApi.listAccounts.mockResolvedValue([account({})]);
  mockedApi.listProvisions.mockResolvedValue([{ id: 'prov1', name: 'Scolarité' }]);
  mockedApi.getProvisionSufficiency.mockResolvedValue({ versementMensuelRecommande: '800', steps: [], currentAmount: '0' } as any);
  await render(<HomeScreen />);

  await waitFor(() => expect(screen.getByText('Scolarité')).toBeTruthy());
  const { useNavigation } = require('@react-navigation/native');
  await fireEvent.press(screen.getByTestId('home-todo-verser-prov1'));
  expect(mockNavigate).toHaveBeenCalledWith('EnvelopeDetail', { kind: 'provision', id: 'prov1' });
});

it('appuyer sur une carte compte navigue vers AccountDetail', async () => {
  mockedApi.listAccounts.mockResolvedValue([account({})]);
  await render(<HomeScreen />);

  await waitFor(() => screen.getByTestId('home-account-card-acc1'));
  await fireEvent.press(screen.getByTestId('home-account-card-acc1'));
  expect(mockNavigate).toHaveBeenCalledWith('AccountDetail', { id: 'acc1' });
});
