import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../api/client';

type Status = 'loading' | 'signedOut' | 'needsHousehold' | 'signedIn';

interface AuthState {
  status: Status;
  householdId: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<void>;
  signOut: () => Promise<void>;
  createHousehold: (name: string) => Promise<void>;
  joinHousehold: (code: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * État d'authentification / foyer actif (docs/03 §I.1). Un utilisateur peut être
 * connecté sans foyer actif (RG-001, juste après signup) — la navigation gère ce
 * cas comme une étape distincte (créer/rejoindre) plutôt qu'un écran vide.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [householdId, setHouseholdId] = useState<string | null>(null);

  const resolveStatus = useCallback(async () => {
    try {
      const me = await api.getMe();
      setHouseholdId(me.householdId ?? null);
      setStatus(me.householdId ? 'signedIn' : 'needsHousehold');
    } catch {
      await api.clearTokens();
      setStatus('signedOut');
      setHouseholdId(null);
    }
  }, []);

  useEffect(() => {
    api.loadStoredTokens().then(({ accessToken }) => {
      if (accessToken) resolveStatus();
      else setStatus('signedOut');
    });
  }, [resolveStatus]);

  const signIn = useCallback(async (email: string, password: string) => {
    const tokens = await api.login(email, password);
    await api.setTokens(tokens);
    await resolveStatus();
  }, [resolveStatus]);

  const signUp = useCallback(async (email: string, password: string, firstName: string, lastName: string) => {
    const tokens = await api.signup(email, password, firstName, lastName);
    await api.setTokens(tokens);
    await resolveStatus();
  }, [resolveStatus]);

  const signOut = useCallback(async () => {
    await api.clearTokens();
    setStatus('signedOut');
    setHouseholdId(null);
  }, []);

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

  const value = useMemo(
    () => ({ status, householdId, signIn, signUp, signOut, createHousehold, joinHousehold }),
    [status, householdId, signIn, signUp, signOut, createHousehold, joinHousehold],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() doit être appelé sous AuthProvider');
  return ctx;
}
