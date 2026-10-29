import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Stockage des jetons de session et du profil de l'appareil.
 *
 * Mobile : expo-secure-store (chiffré par le Keystore Android). Web : le
 * stockage sécurisé n'existe pas, AsyncStorage (localStorage) reste utilisé.
 * Jamais de code personnel ni de mot de passe stocké, nulle part.
 */
const KEYS = {
  accessToken: 'fm.accessToken',
  refreshToken: 'fm.refreshToken',
  profiles: 'fm.profiles',
  currentProfile: 'fm.currentProfile',
} as const;

/** Anciennes clés AsyncStorage (versions précédentes), migrées puis supprimées. */
export const LEGACY_TOKEN_KEYS = { accessToken: 'depenses.accessToken', refreshToken: 'depenses.refreshToken' } as const;

const useSecureStore = Platform.OS !== 'web';

async function getItem(key: string): Promise<string | null> {
  return useSecureStore ? SecureStore.getItemAsync(key) : AsyncStorage.getItem(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (useSecureStore) await SecureStore.setItemAsync(key, value);
  else await AsyncStorage.setItem(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (useSecureStore) await SecureStore.deleteItemAsync(key);
  else await AsyncStorage.removeItem(key);
}

export interface StoredTokens {
  accessToken: string | null;
  refreshToken: string | null;
}

/**
 * Déplace les jetons d'une version précédente (AsyncStorage, en clair) vers
 * le stockage sécurisé. Les anciennes valeurs ne sont supprimées qu'APRÈS
 * l'écriture sécurisée réussie : un échec laisse l'état précédent intact.
 */
export async function migrateLegacyTokens(): Promise<void> {
  if (!useSecureStore) return;
  const [legacyAccess, legacyRefresh] = await Promise.all([
    AsyncStorage.getItem(LEGACY_TOKEN_KEYS.accessToken),
    AsyncStorage.getItem(LEGACY_TOKEN_KEYS.refreshToken),
  ]);
  if (!legacyAccess && !legacyRefresh) return;
  const current = await getItem(KEYS.refreshToken);
  if (!current) {
    if (legacyAccess) await setItem(KEYS.accessToken, legacyAccess);
    if (legacyRefresh) await setItem(KEYS.refreshToken, legacyRefresh);
  }
  await Promise.all([AsyncStorage.removeItem(LEGACY_TOKEN_KEYS.accessToken), AsyncStorage.removeItem(LEGACY_TOKEN_KEYS.refreshToken)]);
}

export async function readTokens(): Promise<StoredTokens> {
  const [accessToken, refreshToken] = await Promise.all([getItem(KEYS.accessToken), getItem(KEYS.refreshToken)]);
  return { accessToken, refreshToken };
}

export async function writeTokens(tokens: { accessToken: string; refreshToken: string }): Promise<void> {
  await Promise.all([setItem(KEYS.accessToken, tokens.accessToken), setItem(KEYS.refreshToken, tokens.refreshToken)]);
}

export async function deleteTokens(): Promise<void> {
  await Promise.all([deleteItem(KEYS.accessToken), deleteItem(KEYS.refreshToken)]);
}

/**
 * Personne déjà authentifiée sur cet appareil. L'email sert uniquement à se
 * reconnecter sans le redemander — il n'est jamais affiché en clair.
 */
export interface DeviceProfile {
  userId: string;
  firstName: string;
  email: string;
}

export async function readProfiles(): Promise<DeviceProfile[]> {
  const raw = await getItem(KEYS.profiles);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.userId === 'string' && typeof p.email === 'string') : [];
  } catch {
    return [];
  }
}

export async function readCurrentProfile(): Promise<DeviceProfile | null> {
  const id = await getItem(KEYS.currentProfile);
  if (!id) return null;
  return (await readProfiles()).find((p) => p.userId === id) ?? null;
}

/** Enregistre (ou met à jour) la personne et en fait le dernier utilisateur de l'appareil. */
export async function rememberProfile(profile: DeviceProfile): Promise<DeviceProfile[]> {
  const profiles = (await readProfiles()).filter((p) => p.userId !== profile.userId);
  const next = [...profiles, profile];
  await setItem(KEYS.profiles, JSON.stringify(next));
  await setItem(KEYS.currentProfile, profile.userId);
  return next;
}

export async function selectProfile(userId: string | null): Promise<void> {
  if (userId) await setItem(KEYS.currentProfile, userId);
  else await deleteItem(KEYS.currentProfile);
}
