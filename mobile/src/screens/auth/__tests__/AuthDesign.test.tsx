import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { CreatePinSteps } from '../CreatePinSteps';
import { LockScreen } from '../LockScreen';
import { LoginScreen } from '../LoginScreen';
import { PinDots, PinPad } from '../../../ui/PinPad';

/**
 * Rendu de l'identité Auth (redesign visuel) : aucune logique testée ici,
 * uniquement ce qui doit être affiché — et ce qui ne doit jamais l'être.
 */
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
}));

let mockAuth: Record<string, unknown> = {};
jest.mock('../../../auth/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

const ADIL = { userId: 'u-adil', firstName: 'Adil', email: 'adil.taha@gmail.com' };
const LAMIAA = { userId: 'u-lamiaa', firstName: 'Lamiaa', email: 'lamiaa@example.com' };

beforeEach(() => {
  mockAuth = { profile: ADIL, profiles: [ADIL], unlock: jest.fn(), switchUser: jest.fn(), signIn: jest.fn() };
});

async function typeDigits(digits: string) {
  for (const d of digits) await fireEvent.press(screen.getByTestId(`pin-key-${d}`));
}

describe('pavé et indicateurs', () => {
  it('pavé : 10 chiffres + effacement, aucune touche « vide » interactive', async () => {
    await render(<PinPad value="" onChange={jest.fn()} maxLength={6} />);
    for (const d of '0123456789') expect(screen.getByTestId(`pin-key-${d}`)).toBeTruthy();
    expect(screen.getByLabelText('Effacer')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(11);
  });

  it('6 indicateurs, seuls les chiffres saisis sont remplis (jamais les chiffres eux-mêmes)', async () => {
    await render(<PinDots length={6} filled={2} />);
    expect(screen.getByTestId('pin-dots-0-filled')).toBeTruthy();
    expect(screen.getByTestId('pin-dots-1-filled')).toBeTruthy();
    expect(screen.getByTestId('pin-dots-2')).toBeTruthy();
    expect(screen.getByTestId('pin-dots-5')).toBeTruthy();
  });
});

describe('création du code', () => {
  it('« Étape 1 sur 2 » + conseil discret, puis « Étape 2 sur 2 » sans conseil', async () => {
    await render(<CreatePinSteps onDone={jest.fn(async () => undefined)} />);
    expect(screen.getByText('Étape 1 sur 2')).toBeTruthy();
    expect(screen.getByText('Créez votre code à 6 chiffres')).toBeTruthy();
    expect(screen.getByText('Évitez 123456 ou 111111')).toBeTruthy();
    await typeDigits('730518');
    expect(screen.getByText('Étape 2 sur 2')).toBeTruthy();
    expect(screen.getByText('Confirmez votre code')).toBeTruthy();
    expect(screen.queryByText('Évitez 123456 ou 111111')).toBeNull();
  });
});

describe('écran verrouillé', () => {
  it('identité discrète, initiale + prénom, indicateurs, pavé, deux liens — jamais l’email', async () => {
    await render(<LockScreen />);
    expect(within(screen.getByTestId('auth-header')).getByText('Finance Maison')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.getByTestId('lock-name').props.children).toBe('Adil');
    expect(screen.getByTestId('pin-dots')).toBeTruthy();
    expect(screen.getByTestId('pin-pad')).toBeTruthy();
    expect(screen.getByText('Code oublié ?')).toBeTruthy();
    expect(screen.getByText("Changer d'utilisateur")).toBeTruthy();
    expect(screen.queryByText(/adil\.taha/)).toBeNull();
    expect(screen.queryByText('Bon retour')).toBeNull();
  });

  it('changer d’utilisateur : carte avec initiale + prénom, « Autre compte », « Annuler » hors carte', async () => {
    mockAuth = { ...mockAuth, profiles: [ADIL, LAMIAA] };
    await render(<LockScreen />);
    await fireEvent.press(screen.getByTestId('lock-switch-user'));
    const row = screen.getByTestId('lock-switch-to-u-lamiaa');
    expect(within(row).getByText('L')).toBeTruthy();
    expect(within(row).getByText('Lamiaa')).toBeTruthy();
    expect(screen.getByTestId('lock-switch-other')).toBeTruthy();
    expect(screen.getByTestId('lock-switch-cancel')).toBeTruthy();
    expect(screen.queryByText(/lamiaa@example\.com/)).toBeNull();
  });
});

describe('connexion', () => {
  it('carte « Bon retour » ; personne connue : initiale + prénom en premier, sans son email', async () => {
    mockAuth = { ...mockAuth, profiles: [LAMIAA] };
    await render(<LoginScreen />);
    expect(screen.getByText('Bon retour')).toBeTruthy();
    const known = screen.getByTestId('login-profile-u-lamiaa');
    expect(within(known).getByText('L')).toBeTruthy();
    expect(within(known).getByText('Lamiaa')).toBeTruthy();
    expect(screen.queryByText(/lamiaa@example\.com/)).toBeNull();
  });

  it('étape code : « Code oublié ? » en avant, ancien mot de passe toujours disponible', async () => {
    mockAuth = { ...mockAuth, profiles: [] };
    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByTestId('login-email'), 'adil.taha@gmail.com');
    await fireEvent.press(screen.getByTestId('login-continue'));
    expect(screen.getByText('Votre code')).toBeTruthy();
    expect(screen.getByText('Code oublié ?')).toBeTruthy();
    expect(screen.getByText('Première connexion avec votre ancien mot de passe ?')).toBeTruthy();
    expect(screen.getByTestId('pin-pad')).toBeTruthy();
  });
});
