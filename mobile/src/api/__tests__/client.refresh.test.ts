jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => void store.set(k, v)),
      removeItem: jest.fn(async (k: string) => void store.delete(k)),
    },
  };
});

import * as api from '../client';

/**
 * Corrections consolidées §1 (bug PROD) — le refresh token est à usage unique
 * côté backend (rotation). Plusieurs 401 concurrents déclenchaient chacun leur
 * propre POST /auth/refresh avec le même refresh token lu avant que le premier
 * ne le remplace : le premier réussissait, les suivants échouaient en 401
 * "Session invalide ou révoquée" (jamais rejoués avec le nouveau token).
 */
describe('api/client — un seul refresh en vol à la fois (dédoublonnage concurrent)', () => {
  beforeEach(async () => {
    await api.clearTokens();
    jest.restoreAllMocks();
  });

  it('3 requêtes en 401 simultanées ne déclenchent qu\'un seul POST /auth/refresh, toutes rejouées avec succès', async () => {
    await api.setTokens({ accessToken: 'access-expired', refreshToken: 'refresh-v1' });

    let refreshCalls = 0;
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(api.API_BASE_URL, '');
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;

      if (path === '/auth/refresh') {
        refreshCalls += 1;
        // Le backend révoque l'ancien refresh token dès le premier appel réussi :
        // un second appel avec le même corps échouerait — ne doit donc jamais arriver.
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ accessToken: 'access-v2', refreshToken: 'refresh-v2' }),
        } as Response;
      }
      if (path === '/me') {
        if (auth === 'Bearer access-v2') {
          return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'u1', householdId: 'h1' }) } as Response;
        }
        return { ok: false, status: 401, text: async () => JSON.stringify({ message: 'Unauthorized' }) } as Response;
      }
      throw new Error(`Unexpected fetch: ${path}`);
    });
    // @ts-expect-error mock partiel suffisant pour ce test
    global.fetch = fetchMock;

    const results = await Promise.all([api.getMe(), api.getMe(), api.getMe()]);

    expect(refreshCalls).toBe(1); // jamais un second refresh déclenché par les appels concurrents
    for (const r of results) {
      expect(r).toEqual({ id: 'u1', householdId: 'h1' }); // tous rejoués avec succès sur le nouveau token
    }
  });

  it('si le refresh unique échoue, tous les appelants concurrents reçoivent le même échec (jamais un second essai)', async () => {
    await api.setTokens({ accessToken: 'access-expired', refreshToken: 'refresh-revoked' });

    let refreshCalls = 0;
    const fetchMock = jest.fn(async (url: string) => {
      const path = url.replace(api.API_BASE_URL, '');
      if (path === '/auth/refresh') {
        refreshCalls += 1;
        return { ok: false, status: 401, text: async () => JSON.stringify({ message: 'Session invalide ou révoquée' }) } as Response;
      }
      if (path === '/me') {
        return { ok: false, status: 401, text: async () => JSON.stringify({ message: 'Unauthorized' }) } as Response;
      }
      throw new Error(`Unexpected fetch: ${path}`);
    });
    // @ts-expect-error mock partiel suffisant pour ce test
    global.fetch = fetchMock;

    const results = await Promise.allSettled([api.getMe(), api.getMe(), api.getMe()]);

    expect(refreshCalls).toBe(1);
    for (const r of results) {
      expect(r.status).toBe('rejected');
    }
  });
});
