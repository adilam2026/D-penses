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

async function fillAndSubmit() {
  await render(<SignupScreen />);
  await fireEvent.changeText(screen.getByPlaceholderText('Prénom'), 'Test');
  await fireEvent.changeText(screen.getByPlaceholderText('Nom'), 'User');
  await fireEvent.changeText(screen.getByPlaceholderText('Email'), 'test.user@example.com');
  await fireEvent.changeText(screen.getByPlaceholderText('Mot de passe (8 caractères min.)'), 'password123');
  await fireEvent.press(screen.getByText('Créer mon compte'));
}

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

it('mot de passe trop court (400) → message backend affiché tel quel', async () => {
  mockSignUp.mockRejectedValue(new ApiError(400, 'Le mot de passe doit contenir au moins 8 caractères'));
  await fillAndSubmit();

  await waitFor(() => expect(screen.getByText('Le mot de passe doit contenir au moins 8 caractères')).toBeTruthy());
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
