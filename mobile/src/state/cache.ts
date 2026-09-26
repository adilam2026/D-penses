/**
 * Cache mémoire minimal, TTL court, sans dépendance externe (§4B — pas de
 * bibliothèque lourde type react-query). Sert deux besoins :
 *  - éviter de refetcher la même clé plusieurs fois en quelques secondes
 *    (ex. navigation aller-retour Accueil -> Compte -> Accueil, ou plusieurs
 *    écrans qui listent les mêmes comptes) ;
 *  - afficher immédiatement la dernière valeur connue pendant qu'une
 *    revalidation tourne en arrière-plan (stale-while-revalidate), au lieu
 *    d'un loader plein écran à chaque focus.
 *
 * Ce n'est jamais une source de vérité : le backend reste seul propriétaire
 * des données, ce cache ne fait qu'éviter des allers-retours réseau redondants
 * pendant une TTL courte. `invalidate`/`invalidatePrefix` sont appelés après
 * toute mutation connue pour ne jamais montrer une valeur qu'on sait périmée.
 */

type Entry<T> = { value: T; expiresAt: number; fetchedAt: number };

const store = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

const DEFAULT_TTL_MS = 30_000;

export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry) return undefined;
  return entry.value;
}

function isFresh(key: string): boolean {
  const entry = store.get(key);
  return !!entry && entry.expiresAt > Date.now();
}

/**
 * Retourne la valeur en cache si elle est encore fraîche (aucune requête
 * réseau). Sinon appelle `fetcher()` (une seule fois même si plusieurs
 * appelants demandent la même clé en même temps — `inFlight` dédoublonne),
 * met à jour le cache, et retourne le résultat. `force: true` (ex. pull-to-
 * refresh explicite) ignore la fraîcheur et revalide toujours.
 */
export async function cached<T>(key: string, fetcher: () => Promise<T>, ttlMs: number = DEFAULT_TTL_MS, force = false): Promise<T> {
  if (!force && isFresh(key)) return getCached<T>(key)!;
  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const promise = fetcher()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs, fetchedAt: Date.now() });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

/** Invalide une clé précise (ex. après une mutation ciblée). */
export function invalidate(key: string): void {
  store.delete(key);
}

/** Invalide toutes les clés commençant par ce préfixe (ex. "accounts:" après création d'un compte). */
export function invalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function clearCache(): void {
  store.clear();
  inFlight.clear();
}
