import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { LoginScreen } from '../LoginScreen';
import { ApiError } from '../../../api/client';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const mockSignIn = jest.fn();
const mockSwitchUser = jest.fn();
let mockProfiles: { userId: string; firstName: string; email: string }[] = [];
jest.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ signIn: mockSignIn, profiles: mockProfiles, switchUser: mockSwitchUser }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockProfiles = [];
});

async function typeDigits(digits: string) {
  for (const d of digits) await fireEvent.press(screen.getByTestId(`pin-key-${d}`));
}

async function goToCredential() {
  await render(<LoginScreen />);
  await fireEvent.changeText(screen.getByTestId('login-email'), ' adil@example.com ');
  await fireEvent.press(screen.getByTestId('login-continue'));
}

it('code à 6 chiffres : validation automatique au 6e chiffre, aucun bouton à toucher', async () => {
  mockSignIn.mockResolvedValue(undefined);
  await goToCredential();
  expect(screen.queryByTestId('login-submit')).toBeNull();
  await typeDigits('73051');
  expect(mockSignIn).not.toHaveBeenCalled();
  await typeDigits('8');
  await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('adil@example.com', '730518'));
});

it('mauvais code : message serveur, saisie effacée', async () => {
  mockSignIn.mockRejectedValue(new ApiError(401, 'Identifiants invalides'));
  await goToCredential();
  await typeDigits('730518');
  await waitFor(() => expect(screen.getByTestId('login-error').props.children).toBe('Identifiants invalides'));
  expect(screen.queryByTestId('pin-dots-0-filled')).toBeNull();
});

it('transition : ancien mot de passe 8/9 chiffres saisi en entier puis « Se connecter »', async () => {
  mockSignIn.mockResolvedValue(undefined);
  await goToCredential();
  await fireEvent.press(screen.getByTestId('login-toggle-legacy'));
  await typeDigits('987654321');
  expect(mockSignIn).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('login-submit'));
  await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('adil@example.com', '987654321'));
});

it('seul l’email utilise un champ texte ; le code passe uniquement par le pavé numérique', async () => {
  await goToCredential();
  expect(JSON.stringify(screen.toJSON())).not.toContain('"type":"TextInput"');
});

it('personnes déjà connues : proposées par leur prénom (sans afficher leur email)', async () => {
  mockProfiles = [{ userId: 'u-lamiaa', firstName: 'Lamiaa', email: 'lamiaa@example.com' }];
  await render(<LoginScreen />);
  expect(screen.getByText('Continuer en tant que Lamiaa')).toBeTruthy();
  expect(screen.queryByText(/lamiaa@example\.com/)).toBeNull();
  await fireEvent.press(screen.getByTestId('login-profile-u-lamiaa'));
  expect(mockSwitchUser).toHaveBeenCalledWith(mockProfiles[0]);
});
