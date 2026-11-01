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

import * as SecureStore from 'expo-secure-store';
import * as api from '../client';

/**
 * Renouvellement de session côté client : refresh nominal rejoué, session
 * définitivement invalide (jetons effacés partout, un seul signal, jamais de
 * boucle), erreur transitoire (rien d'effacé), requêtes concurrentes.
 */
const secureStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;

function respond(status: number, body: unknown) {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
}

type Route = (path: string, init: RequestInit) => Response | Promise<Response>;
function mockFetch(route: Route) {
  const fn = jest.fn(async (url: string, init: RequestInit) => route(url.replace(api.API_BASE_URL, ''), init));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}
const calledPaths = (fn: jest.Mock) => fn.mock.calls.map(([url]) => (url as string).replace(api.API_BASE_URL, ''));
const bearer = (init: RequestInit) => (init.headers as Record<string, string>).Authorization;

const expired = () => respond(401, { message: 'Unauthorized' });
const sessionInvalid = () => respond(401, { message: 'Session expirée', code: 'SESSION_INVALID' });

let onExpired: jest.Mock;
beforeEach(async () => {
  secureStore.clear();
  onExpired = jest.fn();
  api.onSessionExpired(onExpired);
  await api.setTokens({ accessToken: 'a1', refreshToken: 'r1' });
});
afterEach(() => api.onSessionExpired(null));

it('access token expiré + session valide : un seul refresh, nouveaux jetons stockés, requête rejouée', async () => {
  const fetchMock = mockFetch((path, init) => {
    if (path === '/auth/refresh') return respond(200, { accessToken: 'a2', refreshToken: 'r2' });
    return bearer(init) === 'Bearer a2' ? respond(200, { userId: 'u1', householdId: 'h1' }) : expired();
  });
  await expect(api.getMe()).resolves.toEqual({ userId: 'u1', householdId: 'h1' });
  expect(calledPaths(fetchMock)).toEqual(['/me', '/auth/refresh', '/me']);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ refreshToken: 'r1' });
  expect(api.currentRefreshToken()).toBe('r2');
  expect([...secureStore.values()]).toEqual(expect.arrayContaining(['a2', 'r2']));
  expect(onExpired).not.toHaveBeenCalled();
});

it('refresh refusé (401 SESSION_INVALID) : jetons effacés en mémoire et dans le stockage sécurisé, un signal, aucune boucle', async () => {
  const fetchMock = mockFetch((path) => (path === '/auth/refresh' ? sessionInvalid() : expired()));
  await expect(api.getMe()).rejects.toMatchObject({ status: 401, code: 'SESSION_INVALID' });
  expect(calledPaths(fetchMock)).toEqual(['/me', '/auth/refresh']);
  expect(api.currentRefreshToken()).toBeNull();
  expect([...secureStore.values()]).not.toEqual(expect.arrayContaining(['a1']));
  expect([...secureStore.values()]).not.toEqual(expect.arrayContaining(['r1']));
  expect(onExpired).toHaveBeenCalledTimes(1);

  // Requête suivante : le refresh token mort n'est plus jamais présenté.
  fetchMock.mockClear();
  await expect(api.getMe()).rejects.toMatchObject({ status: 401, code: 'SESSION_INVALID' });
  expect(calledPaths(fetchMock)).toEqual(['/me']);
  expect(bearer(fetchMock.mock.calls[0][1])).toBeUndefined();
  expect(onExpired).toHaveBeenCalledTimes(1);
});

it('401 sans refresh token disponible : signal d’expiration, aucune tentative de refresh', async () => {
  await api.clearTokens();
  const fetchMock = mockFetch(() => expired());
  await expect(api.getMe()).rejects.toMatchObject({ status: 401, code: 'SESSION_INVALID' });
  expect(calledPaths(fetchMock)).toEqual(['/me']);
  expect(onExpired).toHaveBeenCalledTimes(1);
});

it.each([
  ['serveur 500', () => respond(500, { message: 'Internal server error' })],
  ['serveur 503', () => respond(503, { message: 'Service Unavailable' })],
  ['réseau indisponible', () => Promise.reject(new TypeError('Network request failed'))],
])('erreur transitoire pendant le refresh (%s) : jetons conservés, aucune déconnexion', async (_label, refreshResponse) => {
  mockFetch((path) => (path === '/auth/refresh' ? refreshResponse() : expired()));
  await expect(api.getMe()).rejects.toBeDefined();
  expect(api.currentRefreshToken()).toBe('r1');
  expect([...secureStore.values()]).toEqual(expect.arrayContaining(['a1', 'r1']));
  expect(onExpired).not.toHaveBeenCalled();
});

it('requêtes concurrentes en 401 : un seul refresh, toutes rejouées avec le nouveau jeton', async () => {
  const fetchMock = mockFetch(async (path, init) => {
    if (path === '/auth/refresh') {
      await new Promise((r) => setTimeout(r, 10));
      return respond(200, { accessToken: 'a2', refreshToken: 'r2' });
    }
    return bearer(init) === 'Bearer a2' ? respond(200, []) : expired();
  });
  await Promise.all([api.getMe(), api.listAccounts(), api.listGoals()]);
  expect(calledPaths(fetchMock).filter((p) => p === '/auth/refresh')).toHaveLength(1);
  expect(onExpired).not.toHaveBeenCalled();
});

it('requêtes concurrentes avec session invalide : un seul refresh, un seul nettoyage, un seul signal', async () => {
  const fetchMock = mockFetch(async (path) => {
    if (path === '/auth/refresh') {
      await new Promise((r) => setTimeout(r, 10));
      return sessionInvalid();
    }
    return expired();
  });
  const results = await Promise.allSettled([api.getMe(), api.listAccounts(), api.listGoals()]);
  expect(results.every((r) => r.status === 'rejected' && (r.reason as api.ApiError).code === 'SESSION_INVALID')).toBe(true);
  expect(calledPaths(fetchMock).filter((p) => p === '/auth/refresh')).toHaveLength(1);
  expect(onExpired).toHaveBeenCalledTimes(1);
  expect(api.currentRefreshToken()).toBeNull();
});

it('de nouveaux jetons valides réarment le signal (expiration suivante à nouveau signalée)', async () => {
  mockFetch((path) => (path === '/auth/refresh' ? sessionInvalid() : expired()));
  await expect(api.getMe()).rejects.toBeDefined();
  await api.setTokens({ accessToken: 'a3', refreshToken: 'r3' });
  await expect(api.getMe()).rejects.toBeDefined();
  expect(onExpired).toHaveBeenCalledTimes(2);
});

it('un mauvais code au déverrouillage (401 avec code métier) ne déclenche jamais l’expiration', async () => {
  mockFetch(() => respond(401, { message: 'Code incorrect', code: 'INVALID_PIN' }));
  await expect(api.unlock('r1', '111112')).rejects.toMatchObject({ code: 'INVALID_PIN' });
  expect(api.currentRefreshToken()).toBe('r1');
  expect(onExpired).not.toHaveBeenCalled();
});
