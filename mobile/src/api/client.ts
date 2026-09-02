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

/** Échéances encore ouvertes du foyer — saisie rapide « Paiement d'une échéance » (Lot 3 §2/§16). */
export const listOpenDeadlines = () => apiFetch('/deadlines');

export const createTransfer = (data: { fromAccountId?: string; toAccountId?: string; amount: number; plannedDate?: string }) =>
  apiFetch('/accounts/transfers', { method: 'POST', body: data });

// ---------- Catégories ----------
export const listCategories = () => apiFetch('/categories');

// ---------- Budgets variables & dépenses (Lot 3) ----------
export const listVariableBudgets = () => apiFetch('/variable-budgets');

export const getVariableBudget = (id: string) => apiFetch(`/variable-budgets/${id}`);

export const createVariableBudget = (data: {
  categoryId: string;
  referenceAmount: number;
  referencePeriod: 'semaine' | 'mois';
  startDate: string;
  weekStartDay?: number;
}) => apiFetch('/variable-budgets', { method: 'POST', body: data });

export const updateVariableBudget = (id: string, data: { referenceAmount?: number; endDate?: string }) =>
  apiFetch(`/variable-budgets/${id}`, { method: 'PATCH', body: data });

export const findActiveBudgetsForCategory = (categoryId: string) => apiFetch(`/variable-budgets/for-category/${categoryId}`);

/**
 * Saisie rapide « + Dépense » (Lot 3 §2/§16) — une dépense réelle ordinaire ne crée
 * jamais de ChargePlan/Deadline : uniquement une BudgetExpense (si un budget actif
 * correspond) ou une AdHocExpense.
 */
export const createExpense = (data: {
  amount: number;
  accountId: string;
  categoryId?: string;
  spentDate?: string;
  variableBudgetId?: string;
  notes?: string;
}) => apiFetch('/expenses', { method: 'POST', body: data });

// ---------- Enfants ----------
export const listChildren = () => apiFetch('/children');

export const createChild = (data: { firstName: string; lastName: string }) =>
  apiFetch('/children', { method: 'POST', body: data });

export const getChildCosts = (childId: string) => apiFetch(`/children/${childId}/costs`);

// ---------- Charges planifiées (Lot 4) ----------
export const updateChargePlan = (id: string, data: { obligationStatus?: string; financialPlanId?: string | null }) =>
  apiFetch(`/charge-plans/${id}`, { method: 'PATCH', body: data });

export const updateDeadline = (
  id: string,
  data: { dueDate?: string; expectedBillingDate?: string; billingDate?: string; amountCurrent?: number; amountStatus?: string },
) => apiFetch(`/deadlines/${id}`, { method: 'PATCH', body: data });

// ---------- FinancialPlan (Lot 4) ----------
export const listFinancialPlans = () => apiFetch('/financial-plans');

export const getFinancialPlan = (id: string) => apiFetch(`/financial-plans/${id}`);

export const createFinancialPlan = (data: { label: string; periodStart: string; periodEnd: string }) =>
  apiFetch('/financial-plans', { method: 'POST', body: data });

export const addFinancialPlanBeneficiary = (planId: string, data: { beneficiaryType: 'user' | 'child'; userId?: string; childId?: string }) =>
  apiFetch(`/financial-plans/${planId}/beneficiaries`, { method: 'POST', body: data });

// ---------- Assistant frais scolaires (§17) ----------
export interface SchoolWizardItem {
  label: string;
  amount?: number | null;
  dueDate: string;
  obligationStatus?: string;
  childIds?: string[];
}

export const submitSchoolWizard = (data: { label: string; childIds: string[]; periodStart: string; periodEnd: string; items: SchoolWizardItem[] }) =>
  apiFetch('/school-wizard', { method: 'POST', body: data });

// ---------- Actions à traiter ----------
export const listActionsATraiter = () => apiFetch('/actions-a-traiter');

// ---------- Dashboard & Calendrier (Lot 5) ----------
export const getDashboardSummary = (at?: string) => apiFetch(`/dashboard/summary${at ? `?at=${at}` : ''}`);

export const getCalendar = (params?: { at?: string; from?: string; to?: string }) => {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return apiFetch(`/calendar${qs ? `?${qs}` : ''}`);
};

export const updateHouseholdSettings = (data: { securityMarginAmount?: number; seuilAVenirDays?: number; seuilAPayerDays?: number }) =>
  apiFetch('/households/settings', { method: 'PATCH', body: data });

// ---------- Épargne / Provisions / Objectifs (Lot 6) ----------

export interface CreatePocketBody {
  name: string;
  allocationMode: 'virtual_allocation' | 'backed_by_account';
  linkedAccountId?: string;
  ownerUserId?: string;
  beneficiaryChildId?: string;
  hasRecurringContribution?: boolean;
  targetAmount?: number;
  targetDate?: string;
}

export const listPockets = () => apiFetch('/pockets');
export const getPocket = (id: string) => apiFetch(`/pockets/${id}`);
export const createPocket = (data: CreatePocketBody) => apiFetch('/pockets', { method: 'POST', body: data });
export const contributePocket = (id: string, data: { amount: number; date?: string; intentionLabel?: string; confirmed?: boolean }) =>
  apiFetch(`/pockets/${id}/contribute`, { method: 'POST', body: data });
export const withdrawPocket = (id: string, data: { amount: number; date?: string; intentionLabel?: string }) =>
  apiFetch(`/pockets/${id}/withdraw`, { method: 'POST', body: data });
export const listPocketMovements = (id: string) => apiFetch(`/pockets/${id}/movements`);
export const confirmPocketMovement = (movementId: string, data: { actualDate?: string; actualAmount?: number } = {}) =>
  apiFetch(`/pockets/movements/${movementId}/confirm`, { method: 'POST', body: data });

export interface CreateProvisionBody {
  name: string;
  allocationMode: 'virtual_allocation' | 'backed_by_account';
  linkedAccountId?: string;
  isFlexible?: boolean;
}

export const listProvisions = () => apiFetch('/provisions');
export const getProvision = (id: string) => apiFetch(`/provisions/${id}`);
export const createProvision = (data: CreateProvisionBody) => apiFetch('/provisions', { method: 'POST', body: data });
export const contributeProvision = (id: string, data: { amount: number; date?: string; intentionLabel?: string; confirmed?: boolean }) =>
  apiFetch(`/provisions/${id}/contribute`, { method: 'POST', body: data });
export const withdrawProvision = (id: string, data: { amount: number; date?: string; intentionLabel?: string }) =>
  apiFetch(`/provisions/${id}/withdraw`, { method: 'POST', body: data });
export const listProvisionMovements = (id: string) => apiFetch(`/provisions/${id}/movements`);
export const confirmProvisionMovement = (movementId: string, data: { actualDate?: string; actualAmount?: number } = {}) =>
  apiFetch(`/provisions/movements/${movementId}/confirm`, { method: 'POST', body: data });
export const getProvisionSufficiency = (id: string, at?: string) => apiFetch(`/provisions/${id}/sufficiency${at ? `?at=${at}` : ''}`);
export const linkProvisionDeadline = (id: string, deadlineId: string) =>
  apiFetch(`/provisions/${id}/deadlines`, { method: 'POST', body: { deadlineId } });
export const unlinkProvisionDeadline = (id: string, deadlineId: string) =>
  apiFetch(`/provisions/${id}/deadlines/${deadlineId}`, { method: 'DELETE' });

/** §18-20 : « Payer avec Provision » — le compte physique réel reste toujours obligatoire (§19). */
export const payDeadlineWithProvision = (deadlineId: string, data: { amount: number; accountId: string; provisionId: string; paidDate?: string }) =>
  apiFetch(`/deadlines/${deadlineId}/payments`, { method: 'POST', body: { ...data, fundingSource: 'provision' } });

export const getDeadline = (id: string) => apiFetch(`/deadlines/${id}`);

export const createGoal = (data: { label: string; targetAmount: number; targetDate?: string; linkedPocketId?: string }) =>
  apiFetch('/goals', { method: 'POST', body: data });
export const listGoals = () => apiFetch('/goals');
export const getGoal = (id: string) => apiFetch(`/goals/${id}`);
export const addGoalContribution = (id: string, data: { plannedDate: string; plannedAmount: number; confirmed?: boolean }) =>
  apiFetch(`/goals/${id}/contributions`, { method: 'POST', body: data });
export const listGoalContributions = (id: string) => apiFetch(`/goals/${id}/contributions`);
export const confirmGoalContribution = (contributionId: string, data: { actualDate?: string; actualAmount?: number } = {}) =>
  apiFetch(`/goals/contributions/${contributionId}/confirm`, { method: 'POST', body: data });

// ---------- Projection (Lot 7) ----------
export const getProjection = (params: { at?: string; horizon?: number; to?: string } = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])),
  ).toString();
  return apiFetch(`/projection${qs ? `?${qs}` : ''}`);
};
