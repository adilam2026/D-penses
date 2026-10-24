import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CreateAccountScreen } from '../CreateAccountScreen';

/**
 * Lot "responsable automatique" — Select "Propriétaire" (Non défini/Adil/
 * Lamiaa/Commun), jamais ownerType exposé directement : le client traduit
 * chaque option vers {ownerType, ownerMemberId}.
 */

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), []);
  },
}));

const mockGetMyHousehold = jest.fn();
const mockCreateAccount = jest.fn();

jest.mock('../../api/client', () => ({
  ApiError: class FakeApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  getMyHousehold: () => mockGetMyHousehold(),
  createAccount: (...args: unknown[]) => mockCreateAccount(...args),
}));

function renderWithSafeArea(ui: React.ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>{ui}</SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMyHousehold.mockResolvedValue({
    id: 'h1',
    name: 'Foyer',
    currency: 'MAD',
    monthStartDay: 1,
    memberships: [
      { id: 'm-adil', role: 'admin', user: { id: 'u-adil', firstName: 'Adil', lastName: 'A', email: 'adil@test.local', color: null } },
      { id: 'm-lamiaa', role: 'member', user: { id: 'u-lamiaa', firstName: 'Lamiaa', lastName: 'L', email: 'lamiaa@test.local', color: null } },
    ],
  });
  mockCreateAccount.mockResolvedValue({});
});

it('propose les 4 options Non défini/Adil/Lamiaa/Commun, défaut Non défini', async () => {
  renderWithSafeArea(<CreateAccountScreen />);
  await waitFor(() => screen.getByTestId('create-account-owner'));
  expect(screen.getByText('Non défini')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('create-account-owner'));
  expect(screen.getByTestId('create-account-owner-option-undefined')).toBeTruthy();
  expect(screen.getByTestId('create-account-owner-option-member:m-adil')).toBeTruthy();
  expect(screen.getByTestId('create-account-owner-option-member:m-lamiaa')).toBeTruthy();
  expect(screen.getByTestId('create-account-owner-option-shared')).toBeTruthy();
});

it('"Adil" -> ownerType=INDIVIDUAL + ownerMemberId=Adil envoyés à la création', async () => {
  renderWithSafeArea(<CreateAccountScreen />);
  await waitFor(() => screen.getByTestId('create-account-owner'));

  await fireEvent.changeText(screen.getByTestId('create-account-name'), 'SG Adil');
  await fireEvent.press(screen.getByTestId('create-account-owner'));
  await fireEvent.press(screen.getByTestId('create-account-owner-option-member:m-adil'));

  await fireEvent.press(screen.getByTestId('create-account-submit'));
  await waitFor(() => expect(mockCreateAccount).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'INDIVIDUAL', ownerMemberId: 'm-adil' })));
});

it('"Commun" -> ownerType=SHARED + ownerMemberId=null envoyés à la création', async () => {
  renderWithSafeArea(<CreateAccountScreen />);
  await waitFor(() => screen.getByTestId('create-account-owner'));

  await fireEvent.changeText(screen.getByTestId('create-account-name'), 'Compte commun');
  await fireEvent.press(screen.getByTestId('create-account-owner'));
  await fireEvent.press(screen.getByTestId('create-account-owner-option-shared'));

  await fireEvent.press(screen.getByTestId('create-account-submit'));
  await waitFor(() => expect(mockCreateAccount).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'SHARED', ownerMemberId: null })));
});
