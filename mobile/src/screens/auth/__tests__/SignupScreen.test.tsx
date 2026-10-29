import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SignupScreen } from '../SignupScreen';
import { ApiError } from '../../../api/client';

/**
 * Corrections UI/UX finales §17 (bug bloquant) — jamais "Erreur interne du
 * serveur" affiché tel quel : messages explicites selon le cas (email déjà
 * utilisé, email invalide, mot de passe trop court, champ manquant, erreur
 * réseau) et un message générique dédié pour une vraie panne serveur (5xx).
 */
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const mockSignUp = jest.fn();
jest.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ signUp: mockSignUp }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

async function typeDigits(digits: string) {
  for (const d of digits) await fireEvent.press(screen.getByTestId(`pin-key-${d}`));
}

async function fillAndSubmit(pin = '482913', confirm = pin) {
  await render(<SignupScreen />);
  await fireEvent.changeText(screen.getByPlaceholderText('Prénom'), 'Test');
  await fireEvent.changeText(screen.getByPlaceholderText('Nom'), 'User');
  await fireEvent.changeText(screen.getByPlaceholderText('Email'), 'test.user@example.com');
  await fireEvent.press(screen.getByTestId('signup-continue'));
  await typeDigits(pin);
  await typeDigits(confirm);
}

it('plus de mot de passe : champ absent, le code à 6 chiffres est créé puis confirmé sur le pavé numérique', async () => {
  mockSignUp.mockResolvedValue(undefined);
  await render(<SignupScreen />);
  expect(screen.queryByPlaceholderText(/Mot de passe/)).toBeNull();
  await fireEvent.changeText(screen.getByPlaceholderText('Prénom'), 'Test');
  await fireEvent.changeText(screen.getByPlaceholderText('Nom'), 'User');
  await fireEvent.changeText(screen.getByPlaceholderText('Email'), 'test.user@example.com');
  await fireEvent.press(screen.getByTestId('signup-continue'));
  expect(screen.getByText('Créez votre code à 6 chiffres')).toBeTruthy();
  await typeDigits('482913');
  expect(screen.getByText('Confirmez votre code')).toBeTruthy();
  await typeDigits('482913');
  await waitFor(() => expect(mockSignUp).toHaveBeenCalledWith('test.user@example.com', '482913', 'Test', 'User'));
});

it('codes différents : rien n’est envoyé, on recommence la création', async () => {
  await fillAndSubmit('482913', '482914');
  expect(mockSignUp).not.toHaveBeenCalled();
  expect(screen.getByText('Les deux codes ne correspondent pas. Recommencez.')).toBeTruthy();
  expect(screen.getByText('Créez votre code à 6 chiffres')).toBeTruthy();
});

it('code trivial refusé immédiatement (123456)', async () => {
  await render(<SignupScreen />);
  await fireEvent.changeText(screen.getByPlaceholderText('Prénom'), 'Test');
  await fireEvent.changeText(screen.getByPlaceholderText('Nom'), 'User');
  await fireEvent.changeText(screen.getByPlaceholderText('Email'), 'test.user@example.com');
  await fireEvent.press(screen.getByTestId('signup-continue'));
  await typeDigits('123456');
  expect(screen.getByTestId('create-pin-error')).toBeTruthy();
  expect(screen.getByText('Créez votre code à 6 chiffres')).toBeTruthy();
  expect(mockSignUp).not.toHaveBeenCalled();
});

it('inscription réussie → navigue vers VerifyEmail avec l\'email saisi', async () => {
  mockSignUp.mockResolvedValue(undefined);
  await fillAndSubmit();

  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('VerifyEmail', { email: 'test.user@example.com' }));
});

it('email déjà utilisé (409) → message backend affiché tel quel', async () => {
  mockSignUp.mockRejectedValue(new ApiError(409, 'Un compte existe déjà avec cet email'));
  await fillAndSubmit();

  await waitFor(() => expect(screen.getByText('Un compte existe déjà avec cet email')).toBeTruthy());
});

it('email invalide (400) → message backend affiché tel quel', async () => {
  mockSignUp.mockRejectedValue(new ApiError(400, 'Adresse email invalide'));
  await fillAndSubmit();

  await waitFor(() => expect(screen.getByText('Adresse email invalide')).toBeTruthy());
});

it('code refusé par le serveur (400) → message backend affiché tel quel', async () => {
  mockSignUp.mockRejectedValue(new ApiError(400, 'Ce code est trop simple — évitez les chiffres identiques ou qui se suivent'));
  await fillAndSubmit();

  await waitFor(() => expect(screen.getByText('Ce code est trop simple — évitez les chiffres identiques ou qui se suivent')).toBeTruthy());
});

it('erreur serveur réelle (500) → jamais "Erreur interne du serveur", message générique dédié', async () => {
  mockSignUp.mockRejectedValue(new ApiError(500, 'Erreur interne du serveur'));
  await fillAndSubmit();

  await waitFor(() => expect(screen.getByText('Impossible de créer le compte pour le moment. Réessayez.')).toBeTruthy());
  expect(screen.queryByText('Erreur interne du serveur')).toBeNull();
});

it('erreur réseau (fetch échoue avant réponse HTTP) → message réseau dédié', async () => {
  mockSignUp.mockRejectedValue(new TypeError('Network request failed'));
  await fillAndSubmit();

  await waitFor(() => expect(screen.getByText('Erreur réseau — vérifiez votre connexion et réessayez.')).toBeTruthy());
});
