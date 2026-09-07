import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccountDetailScreen } from '../AccountDetailScreen';
import * as api from '../../../api/client';

/**
 * R5 clôture §2 — un compte doit pouvoir être modifié (nom/type) et archivé
 * (jamais supprimé physiquement), avec historique conservé et un compte
 * archivé exclu des sélecteurs de nouvelle transaction (côté backend, testé
 * en e2e) — ici on vérifie le parcours mobile : menu "...", formulaire de
 * modification, confirmation d'archivage, réactivation.
 */
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: { id: 'acc1' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));
jest.mock('../../../ui/useKeyboardAwareScroll', () => ({
  useKeyboardAwareScroll: () => ({ scrollRef: { current: null }, handleFocus: jest.fn() }),
}));

jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return { Ionicons: (props: any) => Text != null && require('react').createElement(Text, null, props.name) };
});

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    getAccount: jest.fn(),
    listAccounts: jest.fn(),
    listReconciliations: jest.fn(),
    updateAccount: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

const ACTIVE_ACCOUNT = { id: 'acc1', name: 'Compte principal', type: 'courant', status: 'actif' as const, soldeCourant: 1000, reservedByEnvelopes: 0 };
const ARCHIVED_ACCOUNT = { ...ACTIVE_ACCOUNT, status: 'archive' as const };

function mockConfirmAlert(buttonText = 'Archiver') {
  const RN = require('react-native');
  return jest.spyOn(RN.Alert, 'alert').mockImplementation((...args: unknown[]) => {
    const buttons = args[2] as Array<{ text: string; onPress?: () => void }> | undefined;
    buttons?.find((b) => b.text === buttonText)?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listAccounts.mockResolvedValue([]);
  mockedApi.listReconciliations.mockResolvedValue([]);
});

it('affiche le menu "..." avec Modifier et Archiver pour un compte actif', async () => {
  mockedApi.getAccount.mockResolvedValue(ACTIVE_ACCOUNT);
  await render(<AccountDetailScreen />);
  await waitFor(() => expect(screen.getByTestId('account-menu-button')).toBeTruthy());

  fireEvent.press(screen.getByTestId('account-menu-button'));

  await waitFor(() => expect(screen.getByTestId('account-menu-option-modifier')).toBeTruthy());
  expect(screen.getByTestId('account-menu-option-archiver')).toBeTruthy();
});

it('Modifier enregistre le nom et le type via updateAccount', async () => {
  mockedApi.getAccount.mockResolvedValue(ACTIVE_ACCOUNT);
  mockedApi.updateAccount.mockResolvedValue({ ...ACTIVE_ACCOUNT, name: 'Compte renommé', type: 'epargne' });
  await render(<AccountDetailScreen />);
  await waitFor(() => expect(screen.getByTestId('account-menu-button')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('account-menu-button'));
  await waitFor(() => expect(screen.getByTestId('account-menu-option-modifier')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('account-menu-option-modifier'));

  await waitFor(() => expect(screen.getByTestId('account-edit-form')).toBeTruthy());
  await fireEvent.changeText(screen.getByTestId('account-edit-name'), 'Compte renommé');
  await fireEvent.press(screen.getByTestId('account-edit-type-epargne'));
  await fireEvent.press(screen.getByTestId('account-edit-save'));

  await waitFor(() => expect(mockedApi.updateAccount).toHaveBeenCalledWith('acc1', { name: 'Compte renommé', type: 'epargne' }));
});

it('Archiver demande confirmation puis appelle updateAccount(status=archive)', async () => {
  mockedApi.getAccount.mockResolvedValue(ACTIVE_ACCOUNT);
  mockedApi.updateAccount.mockResolvedValue(ARCHIVED_ACCOUNT);
  const alertSpy = mockConfirmAlert('Archiver');
  await render(<AccountDetailScreen />);
  await waitFor(() => expect(screen.getByTestId('account-menu-button')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('account-menu-button'));
  await waitFor(() => expect(screen.getByTestId('account-menu-option-archiver')).toBeTruthy());

  await fireEvent.press(screen.getByTestId('account-menu-option-archiver'));

  expect(alertSpy).toHaveBeenCalled();
  await waitFor(() => expect(mockedApi.updateAccount).toHaveBeenCalledWith('acc1', { status: 'archive' }));
});

it('un compte archivé affiche "Réactiver" et masque le formulaire de transfert', async () => {
  mockedApi.getAccount.mockResolvedValue(ARCHIVED_ACCOUNT);
  await render(<AccountDetailScreen />);

  await waitFor(() => expect(screen.getByTestId('account-reactivate')).toBeTruthy());
  expect(screen.getByText(/archivez-le pour transférer|réactivez-le pour transférer/i)).toBeTruthy();
});

it('Réactiver appelle updateAccount(status=actif)', async () => {
  mockedApi.getAccount.mockResolvedValue(ARCHIVED_ACCOUNT);
  mockedApi.updateAccount.mockResolvedValue(ACTIVE_ACCOUNT);
  await render(<AccountDetailScreen />);
  await waitFor(() => expect(screen.getByTestId('account-reactivate')).toBeTruthy());

  await fireEvent.press(screen.getByTestId('account-reactivate'));

  await waitFor(() => expect(mockedApi.updateAccount).toHaveBeenCalledWith('acc1', { status: 'actif' }));
});
