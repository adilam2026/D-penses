import AsyncStorage from '@react-native-async-storage/async-storage';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const ACCESS_TOKEN_KEY = 'depenses.accessToken';
const REFRESH_TOKEN_KEY = 'depenses.refreshToken';

let accessToken: string | null = null;
let refreshToken: string | null = null;

export async function loadStoredTokens(): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  const [storedAccess, storedRefresh] = await Promise.all([
    AsyncStorage.getItem(ACCESS_TOKEN_KEY),
    AsyncStorage.getItem(REFRESH_TOKEN_KEY),
  ]);
  accessToken = storedAccess;
  refreshToken = storedRefresh;
  return { accessToken, refreshToken };
}

export async function setTokens(tokens: { accessToken: string; refreshToken: string }): Promise<void> {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  await Promise.all([
    AsyncStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken),
    AsyncStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  await Promise.all([AsyncStorage.removeItem(ACCESS_TOKEN_KEY), AsyncStorage.removeItem(REFRESH_TOKEN_KEY)]);
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function rawFetch(path: string, options: { method?: string; body?: unknown; withAuth?: boolean } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.withAuth !== false && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(res.status, (data && (data.message || data.error)) ?? `Erreur ${res.status}`);
  }
  return data;
}

/** Rejoue une requête après un rafraîchissement de token en cas de 401 (access token expiré). */
async function apiFetch(path: string, options: { method?: string; body?: unknown; withAuth?: boolean } = {}) {
  try {
    return await rawFetch(path, options);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && options.withAuth !== false && refreshToken) {
      const tokens = await rawFetch('/auth/refresh', { method: 'POST', body: { refreshToken }, withAuth: false });
      await setTokens(tokens);
      return rawFetch(path, options);
    }
    throw err;
  }
}

export function checkHealth() {
  return apiFetch('/health', { withAuth: false });
}

// ---------- Auth / onboarding ----------
export const signup = (email: string, password: string, firstName: string, lastName: string) =>
  apiFetch('/auth/signup', { method: 'POST', body: { email, password, firstName, lastName }, withAuth: false });

export const login = (email: string, password: string) =>
  apiFetch('/auth/login', { method: 'POST', body: { email, password }, withAuth: false });

export const logout = (token: string) => apiFetch('/auth/logout', { method: 'POST', body: { refreshToken: token }, withAuth: false });

export const getMe = () => apiFetch('/me');

export const createHousehold = (name: string) => apiFetch('/households', { method: 'POST', body: { name } });

export const getMyHousehold = () => apiFetch('/households/me');

export const createInvite = () => apiFetch('/households/invites', { method: 'POST', body: {} });

export const joinHousehold = (code: string) => apiFetch('/households/join', { method: 'POST', body: { code } });

// ---------- Comptes (Lot 1) ----------
export const listAccounts = () => apiFetch('/accounts');

export const getAccountsSummary = () => apiFetch('/accounts/summary');

export const getQuickAddDefaultAccount = (): Promise<{ accountId: string | null }> => apiFetch('/accounts/quick-add-default');

export const createAccount = (data: { name: string; type: string; initialBalance?: number }) =>
  apiFetch('/accounts', { method: 'POST', body: data });

export const setAccountFavorite = (accountId: string) => apiFetch(`/accounts/${accountId}/favorite`, { method: 'POST' });

// ---------- Transactions (Lot 2) ----------
export const listTransactions = () => apiFetch('/transactions');

// ---------- Revenus (Lot 2) ----------
export const createIncomeSource = (data: {
  label: string;
  usualAmount: number;
  defaultAccountId: string;
  isRecurring?: boolean;
  recurrenceRule?: string;
}) => apiFetch('/income-sources', { method: 'POST', body: data });

export const createIncomeOccurrence = (sourceId: string, data: { usualDate: string; plannedAmount?: number }) =>
  apiFetch(`/income-sources/${sourceId}/occurrences`, { method: 'POST', body: data });

export const confirmIncomeOccurrence = (
  occurrenceId: string,
  data: { actualAmount: number; actualDate?: string; accountId?: string },
) => apiFetch(`/income-occurrences/${occurrenceId}/confirm`, { method: 'POST', body: data });

// ---------- Charges & paiements (Lot 2) ----------
export const createChargePlan = (data: { label: string; startDate: string }) =>
  apiFetch('/charge-plans', { method: 'POST', body: data });

export const createDeadline = (chargePlanId: string, data: { dueDate: string; amountCurrent: number }) =>
  apiFetch(`/charge-plans/${chargePlanId}/deadlines`, { method: 'POST', body: data });

export const createPayment = (
  deadlineId: string,
  data: { amount: number; accountId: string; paidDate?: string; type?: string },
) => apiFetch(`/deadlines/${deadlineId}/payments`, { method: 'POST', body: data });
