import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as api from '../api/client';
import { clearCache } from '../state/cache';
import { DeviceProfile, readCurrentProfile, readProfiles, rememberProfile, selectProfile } from './secureStorage';

/**
 * - signedOut   : aucune personne connue sur l'appareil -> email + code.
 * - locked      : démarrage de l'application -> écran verrouillé (prénom + code).
 * - mustSetPin  : ancien mot de passe -> création du code à 6 chiffres obligatoire.
 * - needsHousehold / signedIn : application déverrouillée.
 */
type Status = 'loading' | 'signedOut' | 'locked' | 'mustSetPin' | 'needsHousehold' | 'signedIn';

/** Retour au premier plan après au moins ce délai -> code obligatoire. */
export const LOCK_AFTER_MS = 15_000;

interface AuthState {
  status: Status;
  householdId: string | null;
  /** Dernier utilisateur de l'appareil (prénom affiché, email jamais affiché). */
  profile: DeviceProfile | null;
  /** Personnes déjà authentifiées sur cet appareil (« Changer d'utilisateur »). */
  profiles: DeviceProfile[];
  /** Écran verrouillé affiché au-dessus de toute la navigation. */
  locked: boolean;
  /** Masque opaque : l'application n'est plus au premier plan. */
  masked: boolean;
  /** Transition : l'ancien mot de passe doit être ressaisi avant de créer le code. */
  pinSetupNeedsCurrent: boolean;
  signIn: (email: string, credential: string) => Promise<void>;
  unlock: (pin: string) => Promise<void>;
  setupPin: (newPin: string, currentCredential?: string) => Promise<void>;
  signUp: (email: string, pin: string, firstName: string, lastName: string) => Promise<void>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  requestPinReset: (email: string) => Promise<void>;
  verifyPinReset: (email: string, code: string) => Promise<string>;
  completePinReset: (email: string, resetToken: string, newPin: string) => Promise<void>;
  /** null = autre compte (saisie de l'email). Ferme la session courante, aucune donnée conservée. */
  switchUser: (profile: DeviceProfile | null) => Promise<void>;
  signOut: () => Promise<void>;
  createHousehold: (name: string) => Promise<void>;
  joinHousehold: (code: string) => Promise<void>;
  /** Corrections consolidées §17 — bascule vers un membership EXISTANT, jamais via invitation. */
  switchActiveHousehold: (householdId: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * État d'authentification / verrouillage / foyer actif. Le code personnel
 * n'est jamais vérifié ni stocké localement : déverrouiller = /auth/unlock
 * (ou /auth/login si la session a expiré), toujours contre le serveur.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [profiles, setProfiles] = useState<DeviceProfile[]>([]);
  const [relocked, setRelocked] = useState(false);
  const [masked, setMasked] = useState(false);
  const [pinSetupNeedsCurrent, setPinSetupNeedsCurrent] = useState(true);
  // Credential saisi juste avant la transition : en mémoire uniquement, effacé dès le code créé.
  const pendingCredential = useRef<string | null>(null);
  const statusRef = useRef<Status>(status);
  statusRef.current = status;
  const profileRef = useRef<DeviceProfile | null>(profile);
  profileRef.current = profile;

  const requirePinSetup = useCallback(() => {
    setPinSetupNeedsCurrent(pendingCredential.current === null);
    setRelocked(false);
    setStatus('mustSetPin');
  }, []);

  const enterApp = useCallback(async () => {
    try {
      const me = await api.getMe();
      setHouseholdId(me.householdId ?? null);
      setRelocked(false);
      setStatus(me.householdId ? 'signedIn' : 'needsHousehold');
    } catch (err) {
      if (err instanceof api.ApiError && err.code === 'PIN_SETUP_REQUIRED') {
        requirePinSetup();
        return;
      }
      throw err;
    }
  }, [requirePinSetup]);

  /**
   * Toute authentification réussie passe ici. La personne n'est mémorisée
   * sur l'appareil qu'une fois son code à 6 chiffres défini.
   */
  const acceptAuth = useCallback(
    async (res: api.AuthResultApi, email: string, credential: string | null) => {
      await api.setTokens(res);
      clearCache();
      const next: DeviceProfile = { userId: res.user.id, firstName: res.user.firstName, email };
      setProfile(next);
      if (res.mustSetPin) {
        pendingCredential.current = credential;
        requirePinSetup();
        return;
      }
      pendingCredential.current = null;
      setProfiles(await rememberProfile(next));
      await enterApp();
    },
    [enterApp, requirePinSetup],
  );

  // Démarrage (y compris après qu'Android a tué le processus) : toujours verrouillé.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tokens = await api.loadStoredTokens();
      const [known, current] = await Promise.all([readProfiles(), readCurrentProfile()]);
      if (cancelled) return;
      setProfiles(known);
      setProfile(current);
      if (!tokens.accessToken && !tokens.refreshToken) {
        setStatus(current ? 'locked' : 'signedOut');
        return;
      }
      try {
        // Seul le serveur dit si la transition est requise — jamais une valeur stockée localement.
        const session = await api.getAuthSession();
        if (cancelled) return;
        const fromServer: DeviceProfile = { userId: session.userId, firstName: session.firstName, email: session.email };
        setProfile(fromServer);
        if (session.mustSetPin) {
          pendingCredential.current = null;
          setPinSetupNeedsCurrent(true);
          setStatus('mustSetPin');
        } else {
          setProfiles(await rememberProfile(fromServer));
          setStatus('locked');
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof api.ApiError && err.status === 401) await api.clearTokens();
        setStatus(current ? 'locked' : 'signedOut');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    api.onPinSetupRequired(requirePinSetup);
    return () => api.onPinSetupRequired(null);
  }, [requirePinSetup]);

  // Verrouillage après passage en arrière-plan : heure RÉELLE de départ
  // (Date.now()), comparée au retour — aucun minuteur, donc juste même si
  // Android suspend l'application. Processus tué -> démarrage verrouillé.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let backgroundAt: number | null = null;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        const since = backgroundAt;
        backgroundAt = null;
        if (since !== null) {
          const elapsed = Date.now() - since;
          // Horloge reculée (elapsed < 0) : verrouillage par prudence.
          const inApp = statusRef.current === 'signedIn' || statusRef.current === 'needsHousehold';
          if (inApp && (elapsed >= LOCK_AFTER_MS || elapsed < 0)) setRelocked(true);
        }
        setMasked(false);
      } else {
        if (backgroundAt === null) backgroundAt = Date.now();
        setMasked(true);
      }
    });
    return () => sub.remove();
  }, []);

  const signIn = useCallback(
    async (email: string, credential: string) => {
      const res = await api.login(email, credential);
      await acceptAuth(res, email, credential);
    },
    [acceptAuth],
  );

  const unlock = useCallback(
    async (pin: string) => {
      const current = profileRef.current;
      const refreshToken = api.currentRefreshToken();
      let res: api.AuthResultApi | null = null;
      if (refreshToken) {
        try {
          res = await api.unlock(refreshToken, pin);
        } catch (err) {
          // Session expirée/révoquée : même écran, reconnexion avec l'email mémorisé.
          if (!(err instanceof api.ApiError && err.code === 'SESSION_INVALID')) throw err;
          await api.clearTokens();
        }
      }
      if (!res) {
        if (!current) throw new Error('Aucun utilisateur connu sur cet appareil');
        res = await api.login(current.email, pin);
      }
      await acceptAuth(res, current?.email ?? '', pin);
    },
    [acceptAuth],
  );

  const setupPin = useCallback(
    async (newPin: string, currentCredential?: string) => {
      const credential = currentCredential ?? pendingCredential.current;
      if (!credential) throw new Error('Mot de passe actuel requis');
      const res = await api.setPin(credential, newPin);
      pendingCredential.current = null;
      await api.setTokens(res);
      const current = profileRef.current;
      if (current) setProfiles(await rememberProfile(current));
      await enterApp();
    },
    [enterApp],
  );

  // Aucune session n'existe tant que l'email n'est pas confirmé (voir verifyEmail).
  const signUp = useCallback(async (email: string, pin: string, firstName: string, lastName: string) => {
    await api.signup(email, pin, firstName, lastName);
  }, []);

  const verifyEmail = useCallback(
    async (email: string, code: string) => {
      const res = await api.verifyEmailOtp(email, code);
      await acceptAuth(res, email, null);
    },
    [acceptAuth],
  );

  const requestPinReset = useCallback(async (email: string) => {
    await api.requestPinReset(email);
  }, []);

  const verifyPinReset = useCallback(async (email: string, code: string) => {
    const { resetToken } = await api.verifyPinReset(email, code);
    return resetToken;
  }, []);

  const completePinReset = useCallback(
    async (email: string, resetToken: string, newPin: string) => {
      const res = await api.completePinReset(resetToken, newPin);
      await acceptAuth(res, email, null);
    },
    [acceptAuth],
  );

  const switchUser = useCallback(async (target: DeviceProfile | null) => {
    const refreshToken = api.currentRefreshToken();
    if (refreshToken) await api.logout(refreshToken).catch(() => undefined);
    await api.clearTokens();
    clearCache();
    pendingCredential.current = null;
    setHouseholdId(null);
    setRelocked(false);
    await selectProfile(target?.userId ?? null);
    setProfile(target);
    setStatus(target ? 'locked' : 'signedOut');
  }, []);

  const signOut = useCallback(() => switchUser(null), [switchUser]);

  const createHousehold = useCallback(async (name: string) => {
    const res = await api.createHousehold(name);
    await api.setTokens(res);
    setHouseholdId(res.household.id);
    setStatus('signedIn');
  }, []);

  const joinHousehold = useCallback(async (code: string) => {
    const res = await api.joinHousehold(code);
    await api.setTokens(res);
    setHouseholdId(res.household.id);
    setStatus('signedIn');
  }, []);

  const switchActiveHousehold = useCallback(async (id: string) => {
    const res = await api.switchActiveHousehold(id);
    await api.setTokens(res);
    setHouseholdId(res.household.id);
    setStatus('signedIn');
  }, []);

  const locked = status === 'locked' || relocked;

  const value = useMemo(
    () => ({
      status,
      householdId,
      profile,
      profiles,
      locked,
      masked,
      pinSetupNeedsCurrent,
      signIn,
      unlock,
      setupPin,
      signUp,
      verifyEmail,
      requestPinReset,
      verifyPinReset,
      completePinReset,
      switchUser,
      signOut,
      createHousehold,
      joinHousehold,
      switchActiveHousehold,
    }),
    [
      status,
      householdId,
      profile,
      profiles,
      locked,
      masked,
      pinSetupNeedsCurrent,
      signIn,
      unlock,
      setupPin,
      signUp,
      verifyEmail,
      requestPinReset,
      verifyPinReset,
      completePinReset,
      switchUser,
      signOut,
      createHousehold,
      joinHousehold,
      switchActiveHousehold,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() doit être appelé sous AuthProvider');
  return ctx;
}
