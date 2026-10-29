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

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as api from '../../api/client';
import { LEGACY_TOKEN_KEYS, readCurrentProfile, readProfiles, rememberProfile, selectProfile } from '../secureStorage';
import { maskEmail } from '../maskEmail';
import { isTrivialPin } from '../pinRules';

const asyncStore = (AsyncStorage as unknown as { __store: Map<string, string> }).__store;
const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;

beforeEach(() => {
  asyncStore.clear();
  secureStore.clear();
  jest.clearAllMocks();
});

describe('stockage sécurisé des jetons', () => {
  it('migre les jetons d’une version précédente (AsyncStorage) puis les supprime d’AsyncStorage', async () => {
    asyncStore.set(LEGACY_TOKEN_KEYS.accessToken, 'old-access');
    asyncStore.set(LEGACY_TOKEN_KEYS.refreshToken, 'old-refresh');
    const loaded = await api.loadStoredTokens();
    expect(loaded).toEqual({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    expect([...secureStore.values()]).toEqual(expect.arrayContaining(['old-access', 'old-refresh']));
    expect(asyncStore.has(LEGACY_TOKEN_KEYS.accessToken)).toBe(false);
    expect(asyncStore.has(LEGACY_TOKEN_KEYS.refreshToken)).toBe(false);
  });

  it('échec de l’écriture sécurisée : les anciennes valeurs restent en place (rien de perdu)', async () => {
    asyncStore.set(LEGACY_TOKEN_KEYS.refreshToken, 'old-refresh');
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(new Error('keystore indisponible'));
    await expect(api.loadStoredTokens()).rejects.toThrow('keystore indisponible');
    expect(asyncStore.get(LEGACY_TOKEN_KEYS.refreshToken)).toBe('old-refresh');
  });

  it('setTokens / clearTokens n’écrivent plus jamais dans AsyncStorage', async () => {
    await api.setTokens({ accessToken: 'a1', refreshToken: 'r1' });
    expect(asyncStore.size).toBe(0);
    expect([...secureStore.values()]).toEqual(expect.arrayContaining(['a1', 'r1']));
    await api.clearTokens();
    expect([...secureStore.values()]).not.toContain('r1');
  });
});

describe('profils de l’appareil', () => {
  it('mémorise plusieurs personnes et le dernier utilisateur', async () => {
    await rememberProfile({ userId: 'u1', firstName: 'Adil', email: 'adil@x.fr' });
    await rememberProfile({ userId: 'u2', firstName: 'Lamiaa', email: 'lamiaa@x.fr' });
    expect((await readProfiles()).map((p) => p.firstName)).toEqual(['Adil', 'Lamiaa']);
    expect((await readCurrentProfile())?.firstName).toBe('Lamiaa');
    await selectProfile('u1');
    expect((await readCurrentProfile())?.firstName).toBe('Adil');
    await selectProfile(null);
    expect(await readCurrentProfile()).toBeNull();
  });
});

describe('règles et affichage', () => {
  it('email masqué sur l’écran verrouillé', () => {
    expect(maskEmail('adil.taha@gmail.com')).toBe('a•••@g•••.com');
    expect(maskEmail('l@example.co.uk')).toBe('l•••@e•••.uk');
  });

  it('codes triviaux identiques au serveur', () => {
    for (const p of ['000000', '111111', '123456', '654321', '012345', '987654']) expect(isTrivialPin(p)).toBe(true);
    for (const p of ['482913', '112233', '121212']) expect(isTrivialPin(p)).toBe(false);
  });
});

describe('client API', () => {
  function respond(status: number, body: unknown) {
    return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
  }

  it('un mauvais code (401 avec code métier) n’est jamais rejoué via refresh (pas de double échec)', async () => {
    await api.setTokens({ accessToken: 'a1', refreshToken: 'r1' });
    const fetchMock = jest.fn(async () => respond(401, { message: 'Code ou mot de passe actuel incorrect', code: 'INVALID_CREDENTIAL' }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(api.setPin('000001', '730518')).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIAL' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('403 PIN_SETUP_REQUIRED prévient l’application (bascule vers la création du code)', async () => {
    const handler = jest.fn();
    api.onPinSetupRequired(handler);
    global.fetch = jest.fn(async () => respond(403, { message: 'Créez votre code à 6 chiffres pour continuer', code: 'PIN_SETUP_REQUIRED' })) as unknown as typeof fetch;
    await expect(api.getMe()).rejects.toMatchObject({ status: 403, code: 'PIN_SETUP_REQUIRED' });
    expect(handler).toHaveBeenCalledTimes(1);
    api.onPinSetupRequired(null);
  });
});
