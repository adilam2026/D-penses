jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => void store.set(k, v)),
      removeItem: jest.fn(async (k: string) => void store.delete(k)),
      __store: store,
    },
  };
});

jest.mock('../../state/cache', () => ({ clearCache: jest.fn() }));

jest.mock('../../api/client', () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, errorCode?: string) {
      super(message);
      this.status = status;
      this.code = errorCode;
    }
  }
  return {
    ApiError,
    loadStoredTokens: jest.fn(),
    getAuthSession: jest.fn(),
    getMe: jest.fn(),
    login: jest.fn(),
    unlock: jest.fn(),
    setPin: jest.fn(),
    logout: jest.fn(async () => undefined),
    clearTokens: jest.fn(async () => undefined),
    setTokens: jest.fn(async () => undefined),
    currentRefreshToken: jest.fn(),
    onPinSetupRequired: jest.fn(),
    requestPinReset: jest.fn(),
    verifyPinReset: jest.fn(),
    completePinReset: jest.fn(),
    signup: jest.fn(),
    verifyEmailOtp: jest.fn(),
  };
});

import React from 'react';
import { AppState, BackHandler, Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import * as api from '../../api/client';
import { clearCache } from '../../state/cache';
import { AuthProvider, LOCK_AFTER_MS, useAuth } from '../AuthContext';
import { LockGate } from '../LockGate';
import { PinSetupScreen } from '../../screens/auth/PinSetupScreen';
import { readProfiles, rememberProfile } from '../secureStorage';

const mocked = api as jest.Mocked<typeof api>;
const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;

const ADIL = { userId: 'u-adil', firstName: 'Adil', email: 'adil.taha@gmail.com' };
const LAMIAA = { userId: 'u-lamiaa', firstName: 'Lamiaa', email: 'lamiaa@example.com' };
const tokens = (userId = ADIL.userId, firstName = 'Adil', mustSetPin = false) => ({
  accessToken: `access-${userId}`,
  refreshToken: `refresh-${userId}`,
  mustSetPin,
  user: { id: userId, firstName },
});

let appStateHandler: ((state: string) => void) | null = null;
let backHandlers: (() => boolean)[] = [];

function Harness() {
  const { status } = useAuth();
  return (
    <>
      <Text testID="status">{status}</Text>
      {status === 'mustSetPin' ? <PinSetupScreen /> : null}
      {status === 'signedIn' || status === 'needsHousehold' ? <Text testID="app-content">DONNÉES DU FOYER</Text> : null}
      <LockGate />
    </>
  );
}

async function start() {
  await render(
    <AuthProvider>
      <Harness />
    </AuthProvider>,
  );
}

// L'overlay verrouillé est modal pour l'accessibilité : ce qui est dessous est
// masqué aux lecteurs d'écran (voulu) — la sonde de test doit donc l'inclure.
const status = () => screen.getByTestId('status', { includeHiddenElements: true }).props.children as string;

async function typeDigits(digits: string) {
  for (const d of digits) await fireEvent.press(screen.getByTestId(`pin-key-${d}`));
}

beforeEach(() => {
  jest.clearAllMocks();
  secureStore.clear();
  appStateHandler = null;
  backHandlers = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, handler: (s: string) => void) => {
    appStateHandler = handler;
    return { remove: jest.fn() };
  }) as never);
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_: string, handler: () => boolean) => {
    backHandlers.push(handler);
    return { remove: () => (backHandlers = backHandlers.filter((h) => h !== handler)) };
  }) as never);
  mocked.loadStoredTokens.mockResolvedValue({ accessToken: null, refreshToken: null });
  mocked.currentRefreshToken.mockReturnValue(null);
  mocked.getMe.mockResolvedValue({ householdId: 'h1' });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('démarrage', () => {
  it('appareil inconnu : connexion par email, aucun verrou', async () => {
    await start();
    await waitFor(() => expect(status()).toBe('signedOut'));
    expect(screen.queryByTestId('lock-gate')).toBeNull();
  });

  it('application tuée puis rouverte : verrouillée, prénom affiché, email JAMAIS affiché, aucune donnée montée', async () => {
    await rememberProfile(ADIL);
    mocked.loadStoredTokens.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    mocked.getAuthSession.mockResolvedValue({ ...ADIL, mustSetPin: false });
    await start();
    await waitFor(() => expect(screen.getByTestId('lock-gate')).toBeTruthy());
    expect(status()).toBe('locked');
    expect(screen.getByTestId('lock-name').props.children).toBe('Adil');
    expect(screen.queryByText(/adil\.taha@gmail\.com/)).toBeNull();
    expect(screen.queryByTestId('app-content', { includeHiddenElements: true })).toBeNull();
    expect(mocked.getMe).not.toHaveBeenCalled();
  });
});

describe('déverrouillage (code vérifié par le serveur)', () => {
  beforeEach(async () => {
    await rememberProfile(ADIL);
    mocked.loadStoredTokens.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    mocked.getAuthSession.mockResolvedValue({ ...ADIL, mustSetPin: false });
    mocked.currentRefreshToken.mockReturnValue('refresh-adil');
  });

  it('6 chiffres -> /auth/unlock, puis application', async () => {
    mocked.unlock.mockResolvedValue(tokens());
    await start();
    await waitFor(() => screen.getByTestId('lock-gate'));
    await typeDigits('730518');
    await waitFor(() => expect(status()).toBe('signedIn'));
    expect(mocked.unlock).toHaveBeenCalledWith('refresh-adil', '730518');
    expect(screen.queryByTestId('lock-gate')).toBeNull();
    expect(screen.getByTestId('app-content')).toBeTruthy();
  });

  it('mauvais code : message serveur, saisie effacée, toujours verrouillé', async () => {
    mocked.unlock.mockRejectedValue(new api.ApiError(401, 'Code incorrect', 'INVALID_PIN'));
    await start();
    await waitFor(() => screen.getByTestId('lock-gate'));
    await typeDigits('111112');
    await waitFor(() => expect(screen.getByTestId('lock-error').props.children).toBe('Code incorrect'));
    expect(screen.queryByTestId('pin-dots-0-filled')).toBeNull();
    expect(status()).toBe('locked');
  });

  it('blocage serveur affiché tel quel (Trop de tentatives…)', async () => {
    mocked.unlock.mockRejectedValue(new api.ApiError(429, 'Trop de tentatives. Réessayez dans 5 minutes.', 'TOO_MANY_ATTEMPTS'));
    await start();
    await waitFor(() => screen.getByTestId('lock-gate'));
    await typeDigits('730518');
    await waitFor(() => expect(screen.getByTestId('lock-error').props.children).toBe('Trop de tentatives. Réessayez dans 5 minutes.'));
  });

  it('session expirée : même écran, reconnexion avec l’email mémorisé (jamais redemandé)', async () => {
    mocked.unlock.mockRejectedValue(new api.ApiError(401, 'Session expirée', 'SESSION_INVALID'));
    mocked.login.mockResolvedValue(tokens());
    await start();
    await waitFor(() => screen.getByTestId('lock-gate'));
    await typeDigits('730518');
    await waitFor(() => expect(status()).toBe('signedIn'));
    expect(mocked.login).toHaveBeenCalledWith(ADIL.email, '730518');
  });

  it('bouton Retour Android consommé tant que c’est verrouillé', async () => {
    await start();
    await waitFor(() => screen.getByTestId('lock-gate'));
    expect(backHandlers.length).toBeGreaterThan(0);
    expect(backHandlers.every((h) => h() === true)).toBe(true);
    expect(screen.getByTestId('lock-gate')).toBeTruthy();
  });
});

describe('verrouillage après arrière-plan (heure réelle de départ)', () => {
  async function unlockedApp() {
    await rememberProfile(ADIL);
    mocked.loadStoredTokens.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    mocked.getAuthSession.mockResolvedValue({ ...ADIL, mustSetPin: false });
    mocked.currentRefreshToken.mockReturnValue('refresh-adil');
    mocked.unlock.mockResolvedValue(tokens());
    await start();
    await waitFor(() => screen.getByTestId('lock-gate'));
    await typeDigits('730518');
    await waitFor(() => expect(status()).toBe('signedIn'));
  }

  async function goBackgroundAt(t: number) {
    jest.spyOn(Date, 'now').mockReturnValue(t);
    await act(async () => appStateHandler!('background'));
  }
  async function comeBackAt(t: number) {
    jest.spyOn(Date, 'now').mockReturnValue(t);
    await act(async () => appStateHandler!('active'));
  }

  it('masque opaque immédiat dès que l’application quitte le premier plan', async () => {
    await unlockedApp();
    await goBackgroundAt(1_000_000);
    expect(screen.getByTestId('privacy-mask')).toBeTruthy();
  });

  it('retour avant 15 s : pas de code', async () => {
    await unlockedApp();
    await goBackgroundAt(1_000_000);
    await comeBackAt(1_000_000 + LOCK_AFTER_MS - 1);
    expect(screen.queryByTestId('privacy-mask')).toBeNull();
    expect(screen.queryByTestId('lock-gate')).toBeNull();
  });

  it('retour à 15 s ou plus : verrouillé, sans affichage fugitif des données', async () => {
    await unlockedApp();
    await goBackgroundAt(1_000_000);
    await comeBackAt(1_000_000 + LOCK_AFTER_MS);
    expect(screen.getByTestId('lock-gate')).toBeTruthy();
    expect(screen.queryByTestId('privacy-mask')).toBeNull();
    expect(screen.getByTestId('lock-name').props.children).toBe('Adil');
  });

  it('plusieurs changements d’état : le délai part du PREMIER départ', async () => {
    await unlockedApp();
    await goBackgroundAt(1_000_000);
    await act(async () => appStateHandler!('inactive'));
    await comeBackAt(1_000_000 + 20_000);
    expect(screen.getByTestId('lock-gate')).toBeTruthy();
  });

  it('horloge reculée pendant l’arrière-plan : verrouillé par prudence', async () => {
    await unlockedApp();
    await goBackgroundAt(1_000_000);
    await comeBackAt(999_000);
    expect(screen.getByTestId('lock-gate')).toBeTruthy();
  });
});

describe('transition ancien mot de passe -> code à 6 chiffres', () => {
  it('déjà connecté à l’installation : ancien mot de passe redemandé, puis création + confirmation', async () => {
    mocked.loadStoredTokens.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    mocked.getAuthSession.mockResolvedValue({ ...ADIL, mustSetPin: true });
    mocked.setPin.mockResolvedValue(tokens());
    await start();
    await waitFor(() => expect(status()).toBe('mustSetPin'));
    expect(screen.getByTestId('pin-setup-current')).toBeTruthy();
    // Pas encore mémorisé tant que le code n'est pas défini.
    expect(await readProfiles()).toEqual([]);

    await typeDigits('87654321');
    await fireEvent.press(screen.getByTestId('pin-setup-current-submit'));
    await typeDigits('730518');
    await typeDigits('730518');
    await waitFor(() => expect(status()).toBe('signedIn'));
    expect(mocked.setPin).toHaveBeenCalledWith('87654321', '730518');
    expect(await readProfiles()).toEqual([ADIL]);
  });

  it('nouvel appareil : l’ancien mot de passe vient d’être saisi, seulement création + confirmation', async () => {
    mocked.login.mockResolvedValue(tokens(ADIL.userId, 'Adil', true));
    mocked.setPin.mockResolvedValue(tokens());
    let signIn: ((email: string, credential: string) => Promise<void>) | undefined;
    function Grab() {
      signIn = useAuth().signIn;
      return null;
    }
    await render(
      <AuthProvider>
        <Grab />
        <Harness />
      </AuthProvider>,
    );
    await waitFor(() => expect(status()).toBe('signedOut'));
    await act(async () => {
      await signIn!(ADIL.email, '987654321');
    });
    expect(status()).toBe('mustSetPin');
    expect(screen.queryByTestId('pin-setup-current')).toBeNull();
    await typeDigits('730518');
    await typeDigits('730518');
    await waitFor(() => expect(status()).toBe('signedIn'));
    expect(mocked.setPin).toHaveBeenCalledWith('987654321', '730518');
  });

  it('ancien mot de passe refusé par le serveur : retour à sa saisie', async () => {
    mocked.loadStoredTokens.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    mocked.getAuthSession.mockResolvedValue({ ...ADIL, mustSetPin: true });
    mocked.setPin.mockRejectedValue(new api.ApiError(401, 'Code ou mot de passe actuel incorrect', 'INVALID_CREDENTIAL'));
    await start();
    await waitFor(() => expect(status()).toBe('mustSetPin'));
    await typeDigits('11112222');
    await fireEvent.press(screen.getByTestId('pin-setup-current-submit'));
    await typeDigits('730518');
    await typeDigits('730518');
    await waitFor(() => expect(screen.getByTestId('pin-setup-current')).toBeTruthy());
    expect(screen.getByText('Code ou mot de passe actuel incorrect')).toBeTruthy();
    expect(status()).toBe('mustSetPin');
  });
});

describe('changer d’utilisateur', () => {
  it('Adil -> Lamiaa : session fermée côté serveur, jetons et cache vidés, verrou au nom de Lamiaa, connexion avec SON email', async () => {
    await rememberProfile(LAMIAA);
    await rememberProfile(ADIL);
    mocked.loadStoredTokens.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    mocked.getAuthSession.mockResolvedValue({ ...ADIL, mustSetPin: false });
    mocked.currentRefreshToken.mockReturnValue('refresh-adil');
    await start();
    await waitFor(() => screen.getByTestId('lock-gate'));

    await fireEvent.press(screen.getByTestId('lock-switch-user'));
    await fireEvent.press(screen.getByTestId(`lock-switch-to-${LAMIAA.userId}`));
    await waitFor(() => expect(screen.getByTestId('lock-name').props.children).toBe('Lamiaa'));
    expect(mocked.logout).toHaveBeenCalledWith('refresh-adil');
    mocked.currentRefreshToken.mockReturnValue(null); // jetons effacés par clearTokens()
    expect(mocked.clearTokens).toHaveBeenCalled();
    expect(clearCache).toHaveBeenCalled();

    mocked.login.mockResolvedValue(tokens(LAMIAA.userId, 'Lamiaa'));
    await typeDigits('205819');
    await waitFor(() => expect(status()).toBe('signedIn'));
    expect(mocked.login).toHaveBeenCalledWith(LAMIAA.email, '205819');
    expect(mocked.unlock).not.toHaveBeenCalled();
    // Cache d'Adil vidé AVANT toute connexion de Lamiaa, puis de nouveau avant
    // le chargement de ses données (getMe) : jamais de donnée de l'un chez l'autre.
    const cacheClears = (clearCache as jest.Mock).mock.invocationCallOrder;
    const lamiaaLogin = mocked.login.mock.invocationCallOrder[0];
    const lamiaaData = mocked.getMe.mock.invocationCallOrder[mocked.getMe.mock.invocationCallOrder.length - 1];
    expect(cacheClears.some((order) => order < lamiaaLogin)).toBe(true);
    expect(cacheClears.some((order) => order > lamiaaLogin && order < lamiaaData)).toBe(true);
    // Aucun code de Lamiaa ni d'Adil conservé sur l'appareil.
    expect([...secureStore.values()].join('|')).not.toContain('205819');
  });

  it('personne inconnue de l’appareil : « Autre compte » -> parcours avec email', async () => {
    await rememberProfile(ADIL);
    mocked.loadStoredTokens.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    mocked.getAuthSession.mockResolvedValue({ ...ADIL, mustSetPin: false });
    await start();
    await waitFor(() => screen.getByTestId('lock-gate'));
    await fireEvent.press(screen.getByTestId('lock-switch-user'));
    await waitFor(() => expect(status()).toBe('signedOut'));
    expect(screen.queryByTestId('lock-gate')).toBeNull();
  });
});

describe('« Code oublié ? » depuis l’écran verrouillé', () => {
  it('email masqué, code email, nouveau code + confirmation -> application', async () => {
    await rememberProfile(ADIL);
    mocked.loadStoredTokens.mockResolvedValue({ accessToken: null, refreshToken: null });
    mocked.requestPinReset.mockResolvedValue({ sent: true });
    mocked.verifyPinReset.mockResolvedValue({ resetToken: 'reset-1' });
    mocked.completePinReset.mockResolvedValue(tokens());
    await start();
    await waitFor(() => screen.getByTestId('lock-gate'));

    await fireEvent.press(screen.getByTestId('lock-forgot'));
    const hint = screen.getByTestId('forgot-masked-email');
    expect(JSON.stringify(hint.props.children)).toContain('a•••@g•••.com');
    expect(screen.queryByText(/adil\.taha/)).toBeNull();

    await fireEvent.press(screen.getByTestId('forgot-send'));
    await waitFor(() => expect(mocked.requestPinReset).toHaveBeenCalledWith(ADIL.email));
    await typeDigits('246810');
    await waitFor(() => expect(mocked.verifyPinReset).toHaveBeenCalledWith(ADIL.email, '246810'));
    await typeDigits('730518');
    await typeDigits('730518');
    await waitFor(() => expect(status()).toBe('signedIn'));
    expect(mocked.completePinReset).toHaveBeenCalledWith('reset-1', '730518');
  });
});

it('aucun code ni mot de passe dans le stockage sécurisé après les parcours', async () => {
  mocked.loadStoredTokens.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
  mocked.getAuthSession.mockResolvedValue({ ...ADIL, mustSetPin: true });
  mocked.setPin.mockResolvedValue(tokens());
  await start();
  await waitFor(() => expect(status()).toBe('mustSetPin'));
  await typeDigits('87654321');
  await fireEvent.press(screen.getByTestId('pin-setup-current-submit'));
  await typeDigits('730518');
  await typeDigits('730518');
  await waitFor(() => expect(status()).toBe('signedIn'));
  const stored = [...secureStore.values()].join('|');
  expect(stored).not.toContain('730518');
  expect(stored).not.toContain('87654321');
});
