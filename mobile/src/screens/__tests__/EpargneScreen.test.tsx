import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EpargneScreen } from '../EpargneScreen';
import { clearCache } from '../../state/cache';
import { colors } from '../../ui/theme';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockListAccounts = jest.fn();
const mockListMedicalClaims = jest.fn();
const mockListGoals = jest.fn();
const mockCreateGoal = jest.fn();
const mockDeleteGoal = jest.fn();
jest.mock('../../api/client', () => ({
  listAccounts: () => mockListAccounts(),
  listMedicalClaims: () => mockListMedicalClaims(),
  listGoals: () => mockListGoals(),
  createGoal: (...args: unknown[]) => mockCreateGoal(...args),
  deleteGoal: (...args: unknown[]) => mockDeleteGoal(...args),
}));

function renderWithSafeArea(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>{ui}</SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  mockListMedicalClaims.mockResolvedValue([]);
  mockListGoals.mockResolvedValue([]);
});

type HostNode = { children: (HostNode | string)[]; props: Record<string, any> };
function textOf(node: HostNode): string {
  return node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('').replace(/\s+/g, ' ');
}

const BCP_EPARGNE = {
  id: 'bcp-epargne', name: 'Épargne', bank: 'BCP', type: 'EPARGNE', colorKey: null, ownerMemberId: null, ownerLabel: null, balance: 1000, nonAffecte: 0,
  subaccounts: [
    { id: 'voiture', accountId: 'bcp-epargne', name: 'Voiture', balance: 0, active: true },
    { id: 'voyage', accountId: 'bcp-epargne', name: 'Voyage', balance: 0, active: true },
    { id: 'enfants', accountId: 'bcp-epargne', name: 'Enfants', balance: 1000, active: true },
  ],
};

it('compte réel -> enveloppes rattachées DANS la même carte, avec le non affecté ; jamais une carte par enveloppe', async () => {
  mockListAccounts.mockResolvedValue([BCP_EPARGNE]);
  renderWithSafeArea(<EpargneScreen />);

  await waitFor(() => screen.getByTestId('epargne-account-card-bcp-epargne'));
  const card = screen.getByTestId('epargne-account-card-bcp-epargne');
  // En-tête du compte réel : nom, banque, solde.
  expect(within(screen.getByTestId('epargne-account-bcp-epargne')).getByText('Épargne')).toBeTruthy();
  expect(within(screen.getByTestId('epargne-account-bcp-epargne')).getAllByText('BCP').length).toBeGreaterThan(0);
  expect(textOf(screen.getByTestId('epargne-account-bcp-epargne') as unknown as HostNode)).toContain('1 000 DH');
  // Enveloppes à l'intérieur de la même carte, puis Non affecté.
  for (const id of ['voiture', 'voyage', 'enfants']) {
    expect(within(card).getByTestId(`epargne-subaccount-${id}`)).toBeTruthy();
    expect(within(card).getByTestId(`epargne-subaccount-dot-${id}`)).toBeTruthy();
  }
  expect(textOf(screen.getByTestId('epargne-subaccount-enfants') as unknown as HostNode)).toBe('Enfants1 000 DH');
  expect(within(card).getByText('Non affecté')).toBeTruthy();
  expect(screen.getAllByTestId(/^epargne-account-card-/)).toHaveLength(1);
  // Refonte purement visuelle : l'écran ne fait que lire, jamais écrire.
  expect(mockCreateGoal).not.toHaveBeenCalled();
  expect(mockDeleteGoal).not.toHaveBeenCalled();
});

it('identité Accueil : carte blanche, aucun dégradé, aucun "+ Définir un objectif" systématique', async () => {
  mockListAccounts.mockResolvedValue([BCP_EPARGNE]);
  renderWithSafeArea(<EpargneScreen />);
  await waitFor(() => screen.getByTestId('epargne-account-card-bcp-epargne'));
  const style = StyleSheet.flatten(screen.getByTestId('epargne-account-card-bcp-epargne').props.style);
  expect(style.backgroundColor).toBe(colors.surface);
  // Plus aucun dégradé par enveloppe : l'écran n'importe plus expo-linear-gradient.
  expect(readFileSync(join(__dirname, '..', 'EpargneScreen.tsx'), 'utf8')).not.toMatch(/LinearGradient/);
  expect(screen.queryByText('+ Définir un objectif')).toBeNull();
  expect(screen.queryByTestId(/^epargne-goal-/)).toBeNull();
});

it('en-tête : "N enveloppes · total épargnés" et "+ Nouvelle" ouvre la création d\'enveloppe', async () => {
  mockListAccounts.mockResolvedValue([BCP_EPARGNE]);
  renderWithSafeArea(<EpargneScreen />);
  await waitFor(() => screen.getByTestId('epargne-subtitle'));
  expect(textOf(screen.getByTestId('epargne-subtitle') as unknown as HostNode)).toBe('3 enveloppes · 1 000 DH épargnés');
  fireEvent.press(screen.getByTestId('epargne-new'));
  expect(mockNavigate).toHaveBeenCalledWith('CreateSubaccount');
});

it("aucune curation cachée : comptes épargne sans enveloppe ET comptes (même courants) portant des enveloppes ; un courant sans enveloppe n'apparaît pas", async () => {
  mockListAccounts.mockResolvedValue([
    { id: 'epargne-enfants', name: 'Épargne Enfants', bank: 'BP', type: 'EPARGNE', ownerMemberId: null, ownerLabel: null, balance: 42000, nonAffecte: 42000, subaccounts: [] },
    {
      id: 'cih', name: 'CIH', bank: 'CIH', type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 12000, nonAffecte: 7000,
      subaccounts: [{ id: 'voiture', accountId: 'cih', name: 'CIH-Voiture', balance: 5000 }],
    },
    { id: 'sg', name: 'SG Courant', bank: 'SG', type: 'COURANT', ownerMemberId: null, ownerLabel: null, balance: 3000, nonAffecte: 3000, subaccounts: [] },
  ]);
  renderWithSafeArea(<EpargneScreen />);
  await waitFor(() => screen.getByTestId('epargne-account-card-epargne-enfants'));
  expect(screen.getByTestId('epargne-account-card-cih')).toBeTruthy();
  expect(within(screen.getByTestId('epargne-account-card-cih')).getByText('CIH-Voiture')).toBeTruthy();
  expect(screen.queryByTestId('epargne-account-card-sg')).toBeNull();
  // Totaux d'en-tête inchangés : enveloppes + comptes épargne sans enveloppe.
  expect(textOf(screen.getByTestId('epargne-subtitle') as unknown as HostNode)).toBe('2 enveloppes · 47 000 DH épargnés');
});

it('objectif présent -> ligne discrète "courant / cible" + petite barre, uniquement sous l\'enveloppe concernée', async () => {
  mockListAccounts.mockResolvedValue([BCP_EPARGNE]);
  mockListGoals.mockResolvedValue([
    { id: 'goal-1', accountId: null, subaccountId: 'voyage', targetAmount: 20000, targetDate: null, label: 'Voyage', current: 6000, percent: 30 },
  ]);
  renderWithSafeArea(<EpargneScreen />);
  await waitFor(() => screen.getByTestId('epargne-goal-voyage'));
  expect(textOf(screen.getByTestId('epargne-goal-voyage') as unknown as HostNode)).toBe('6 000 / 20 000 DH');
  expect(within(screen.getByTestId('epargne-subaccount-voyage')).getByTestId('epargne-goal-voyage')).toBeTruthy();
  expect(screen.queryByTestId('epargne-goal-voiture')).toBeNull();
  expect(screen.queryByTestId('epargne-goal-enfants')).toBeNull();
});

it('objectif sur un compte épargne sans enveloppe -> même ligne discrète sous le compte', async () => {
  mockListAccounts.mockResolvedValue([
    { id: 'epargne-enfants', name: 'Épargne Enfants', bank: 'BP', type: 'EPARGNE', ownerMemberId: null, ownerLabel: null, balance: 45000, nonAffecte: 45000, subaccounts: [] },
  ]);
  mockListGoals.mockResolvedValue([
    { id: 'goal-1', accountId: 'epargne-enfants', subaccountId: null, targetAmount: 100000, targetDate: '2027-12-31T00:00:00.000Z', label: 'Épargne Enfants', current: 45000, percent: 45 },
  ]);
  renderWithSafeArea(<EpargneScreen />);
  await waitFor(() => screen.getByTestId('epargne-goal-epargne-enfants'));
  expect(textOf(screen.getByTestId('epargne-goal-epargne-enfants') as unknown as HostNode)).toBe('45 000 / 100 000 DH');
});

it("toucher une enveloppe ouvre son détail ; toucher le compte ouvre le détail du compte ; Santé garde son écran dédié", async () => {
  mockListAccounts.mockResolvedValue([
    { ...BCP_EPARGNE, subaccounts: [...BCP_EPARGNE.subaccounts, { id: 'sante', accountId: 'bcp-epargne', name: 'Santé', balance: 0, active: true }] },
  ]);
  renderWithSafeArea(<EpargneScreen />);
  await waitFor(() => screen.getByTestId('epargne-subaccount-voyage'));
  fireEvent.press(screen.getByTestId('epargne-subaccount-voyage'));
  expect(mockNavigate).toHaveBeenCalledWith('SubaccountDetail', { id: 'voyage' });
  fireEvent.press(screen.getByTestId('epargne-account-bcp-epargne'));
  expect(mockNavigate).toHaveBeenCalledWith('AccountDetail', { id: 'bcp-epargne' });
  fireEvent.press(screen.getByTestId('epargne-subaccount-sante'));
  expect(mockNavigate).toHaveBeenCalledWith('Health', { id: 'sante' });
});
