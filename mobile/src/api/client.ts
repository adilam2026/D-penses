import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearCache } from '../state/cache';

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
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.withAuth !== false && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    // ValidationPipe renvoie un tableau quand plusieurs champs échouent :
    // toujours un message unique et lisible ici, jamais un tableau brut affiché tel quel.
    const raw = data && (data.message ?? data.error);
    const message = Array.isArray(raw) ? raw[0] : raw;
    throw new ApiError(res.status, message ?? `Erreur ${res.status}`);
  }
  // N'importe quelle mutation qui réussit (POST/PATCH/PUT/DELETE, hors /auth/*)
  // invalide TOUT le cache mémoire, jamais une invalidation ciblée par écran à
  // retenir manuellement pour chaque nouvelle mutation.
  if (method !== 'GET' && !path.startsWith('/auth/')) {
    clearCache();
  }
  return data;
}

// Le refresh token est à usage unique côté backend (rotation : l'ancien est
// révoqué dès qu'un nouveau est émis). refreshPromise sérialise : un seul
// refresh en vol à la fois, toutes les requêtes en 401 concurrentes attendent
// la MÊME promesse et rejouent ensuite avec le nouveau token.
let refreshPromise: Promise<{ accessToken: string; refreshToken: string }> | null = null;

function refreshTokens(): Promise<{ accessToken: string; refreshToken: string }> {
  if (!refreshPromise) {
    const tokenAtStart = refreshToken;
    refreshPromise = (async () => {
      try {
        const tokens = await rawFetch('/auth/refresh', { method: 'POST', body: { refreshToken: tokenAtStart }, withAuth: false });
        await setTokens(tokens);
        return tokens;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

/** Rejoue une requête après un rafraîchissement de token en cas de 401 (access token expiré). */
async function apiFetch(path: string, options: { method?: string; body?: unknown; withAuth?: boolean } = {}) {
  try {
    return await rawFetch(path, options);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && options.withAuth !== false && refreshToken) {
      await refreshTokens();
      return rawFetch(path, options);
    }
    throw err;
  }
}

export function checkHealth() {
  return apiFetch('/health', { withAuth: false });
}

// ---------- Auth ----------
/** N'émet jamais de token directement — l'email doit d'abord être confirmé via verifyEmailOtp. */
export const signup = (email: string, password: string, firstName: string, lastName: string) =>
  apiFetch('/auth/signup', { method: 'POST', body: { email, password, firstName, lastName }, withAuth: false });

export const verifyEmailOtp = (email: string, code: string) =>
  apiFetch('/auth/verify-email-otp', { method: 'POST', body: { email, code }, withAuth: false });

export const resendEmailOtp = (email: string) =>
  apiFetch('/auth/resend-email-otp', { method: 'POST', body: { email }, withAuth: false });

export const login = (email: string, password: string) =>
  apiFetch('/auth/login', { method: 'POST', body: { email, password }, withAuth: false });

export const logout = (token: string) => apiFetch('/auth/logout', { method: 'POST', body: { refreshToken: token }, withAuth: false });

export const getMe = () => apiFetch('/me');

// ---------- Foyer ----------
export const createHousehold = (name: string) => apiFetch('/households', { method: 'POST', body: { name } });

export const getMyHousehold = () => apiFetch('/households/me');

export const createInvite = () => apiFetch('/households/invites', { method: 'POST', body: {} });

export const joinHousehold = (code: string) => apiFetch('/households/join', { method: 'POST', body: { code } });

export const listHouseholdMemberships = () => apiFetch('/households/memberships');

export const switchActiveHousehold = (householdId: string) =>
  apiFetch('/households/switch-active', { method: 'POST', body: { householdId } });

// ---------- Catégories ----------
export interface CategoryApi {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
  isDefaultFallback: boolean;
}

export const listCategories = (): Promise<CategoryApi[]> => apiFetch('/categories');
export const createCategory = (name: string) => apiFetch('/categories', { method: 'POST', body: { name } });

// ---------- Comptes / sous-comptes ----------
export interface SubaccountApi {
  id: string;
  accountId: string;
  name: string;
  balance: number;
}

export interface AccountApi {
  id: string;
  name: string;
  bank: string | null;
  type: string;
  ownerMemberId: string | null;
  ownerLabel: string | null;
  balance: number;
  nonAffecte: number;
  subaccounts: SubaccountApi[];
}

export const listAccounts = (): Promise<AccountApi[]> => apiFetch('/accounts');
export const getAccount = (id: string): Promise<AccountApi> => apiFetch(`/accounts/${id}`);

export const createAccount = (data: { name: string; bank?: string; type?: string; ownerMemberId?: string; ownerLabel?: string; openingBalance?: string }) =>
  apiFetch('/accounts', { method: 'POST', body: data });

export const createSubaccount = (data: { accountId: string; name: string; initialAllocation?: string }) =>
  apiFetch('/accounts/subaccounts', { method: 'POST', body: data });

// ---------- Opérations financières (réalisées) ----------
export type OperationKind = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'SAVINGS_CONTRIBUTION' | 'MEDICAL_REIMBURSEMENT' | 'OPENING_BALANCE';
export type BudgetImpact = 'NORMAL' | 'ALREADY_FUNDED' | 'EXCLUDED';

export interface FinancialOperationApi {
  id: string;
  kind: OperationKind;
  label: string;
  date: string;
  amount: number;
  categoryId: string | null;
  sourceAccountId: string | null;
  sourceSubaccountId: string | null;
  destinationAccountId: string | null;
  destinationSubaccountId: string | null;
  budgetImpact: BudgetImpact;
  reversalOfOperationId: string | null;
  reversalReason: string | null;
  createdAt: string;
}

export const listFinancialOperations = (): Promise<FinancialOperationApi[]> => apiFetch('/financial-operations');
export const getFinancialOperation = (id: string) => apiFetch(`/financial-operations/${id}`);

export const createFinancialOperation = (data: {
  kind: OperationKind;
  label: string;
  date: string;
  amount: string;
  categoryId?: string;
  sourceAccountId?: string;
  sourceSubaccountId?: string;
  destinationAccountId?: string;
  destinationSubaccountId?: string;
  reversalOfOperationId?: string;
  reversalReason?: string;
}) => apiFetch('/financial-operations', { method: 'POST', body: data });

// ---------- Opérations planifiées (Planning) ----------
export type PlannedOperationKind = 'EXPENSE' | 'INCOME' | 'SAVINGS_CONTRIBUTION';
export type PlannedOperationStatus = 'PENDING' | 'REALIZED' | 'CANCELLED';

export interface PlannedOperationApi {
  id: string;
  kind: PlannedOperationKind;
  label: string;
  expectedDate: string;
  expectedAmount: number;
  categoryId: string | null;
  sourceAccountId: string | null;
  sourceSubaccountId: string | null;
  destinationAccountId: string | null;
  destinationSubaccountId: string | null;
  status: PlannedOperationStatus;
  realizedOperationId: string | null;
}

export const listPlannedOperations = (): Promise<PlannedOperationApi[]> => apiFetch('/planned-operations');

export const createPlannedOperation = (data: {
  kind: PlannedOperationKind;
  label: string;
  expectedDate: string;
  expectedAmount: string;
  categoryId?: string;
  sourceAccountId?: string;
  sourceSubaccountId?: string;
  destinationAccountId?: string;
  destinationSubaccountId?: string;
}) => apiFetch('/planned-operations', { method: 'POST', body: data });

export const realizePlannedOperation = (id: string, data: { actualAmount: string; actualDate?: string; label?: string }) =>
  apiFetch(`/planned-operations/${id}/realize`, { method: 'POST', body: data });

export const cancelPlannedOperation = (id: string) => apiFetch(`/planned-operations/${id}/cancel`, { method: 'POST' });
