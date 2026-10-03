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

/** "Réinitialiser les données" (§17) — supprime les données financières du foyer, jamais l'identité/auth. */
export const resetHouseholdData = () => apiFetch('/households/reset', { method: 'POST' });

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

/** Catégories (Organisation → Catégories, §11) — renommage ; "Autres" ne peut jamais être désactivée (refusé côté backend). */
export const renameCategory = (id: string, name: string): Promise<CategoryApi> => apiFetch(`/categories/${id}`, { method: 'PATCH', body: { name } });

/** Désactivation logique — jamais de suppression réelle, l'historique n'est jamais perdu. */
export const archiveCategory = (id: string): Promise<CategoryApi> => apiFetch(`/categories/${id}`, { method: 'DELETE' });

/** Réactiver une catégorie désactivée. */
export const reactivateCategory = (id: string): Promise<CategoryApi> => apiFetch(`/categories/${id}`, { method: 'PATCH', body: { active: true } });

// ---------- Comptes / sous-comptes ----------
export interface SubaccountApi {
  id: string;
  accountId: string;
  name: string;
  active: boolean;
  balance: number;
}

export interface AccountApi {
  id: string;
  name: string;
  bank: string | null;
  type: string;
  ownerMemberId: string | null;
  ownerLabel: string | null;
  active: boolean;
  /** Couleur de carte choisie par l'utilisateur (Lot ciblé §1) — clé de palette prédéfinie, null si compte créé avant cette fonctionnalité. */
  colorKey: string | null;
  balance: number;
  nonAffecte: number;
  subaccounts: SubaccountApi[];
}

/** `includeInactive` (Organisation → Comptes, §7) — jamais passé à `true` par les sélecteurs de nouvelle opération. */
export const listAccounts = (includeInactive = false): Promise<AccountApi[]> =>
  apiFetch(`/accounts${includeInactive ? '?includeInactive=true' : ''}`);
export const getAccount = (id: string): Promise<AccountApi> => apiFetch(`/accounts/${id}`);

export const createAccount = (data: { name: string; bank?: string; type?: string; ownerMemberId?: string; ownerLabel?: string; openingBalance?: string; colorKey?: string }) =>
  apiFetch('/accounts', { method: 'POST', body: data });

export const createSubaccount = (data: { accountId: string; name: string; initialAllocation?: string }) =>
  apiFetch('/accounts/subaccounts', { method: 'POST', body: data });

/** "Modifier" (Détail compte/sous-compte) — renommage uniquement, écran très simple. */
export const renameAccount = (id: string, name: string): Promise<AccountApi> => apiFetch(`/accounts/${id}`, { method: 'PATCH', body: { name } });
export const renameSubaccount = (id: string, name: string): Promise<SubaccountApi> => apiFetch(`/accounts/subaccounts/${id}`, { method: 'PATCH', body: { name } });

/** Comptes (Organisation → Comptes, §7-§8) — édition complète + désactivation/réactivation logique, jamais de suppression physique. */
export const updateAccount = (
  id: string,
  data: { name?: string; bank?: string; type?: string; ownerMemberId?: string; ownerLabel?: string; active?: boolean; colorKey?: string },
): Promise<AccountApi> => apiFetch(`/accounts/${id}`, { method: 'PATCH', body: data });

/** Épargne & sous-comptes (§9-§10) — renommage + désactivation/réactivation logique, jamais de suppression physique. */
export const updateSubaccount = (id: string, data: { name?: string; active?: boolean }): Promise<SubaccountApi> =>
  apiFetch(`/accounts/subaccounts/${id}`, { method: 'PATCH', body: data });

// ---------- Opérations financières (réalisées) ----------
export type OperationKind = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'SAVINGS_CONTRIBUTION' | 'MEDICAL_REIMBURSEMENT' | 'OPENING_BALANCE';
export type BudgetImpact = 'NORMAL' | 'ALREADY_FUNDED' | 'EXCLUDED';

export interface LedgerEntryApi {
  id: string;
  accountId: string;
  subaccountId: string | null;
  amount: number;
  affectsAccountBalance: boolean;
}

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
  correctionOfOperationId: string | null;
  createdAt: string;
  ledgerEntries: LedgerEntryApi[];
}

export interface FinancialOperationDetailApi extends FinancialOperationApi {
  reversals: FinancialOperationApi[];
  reversalOfOperation: FinancialOperationApi | null;
  correctedByOperations: FinancialOperationApi[];
  correctionOfOperation: FinancialOperationApi | null;
}

/** Historique filtré (Détail compte/sous-compte, §8/§9) — jamais un filtrage client sur tout l'historique du foyer. */
export const listFinancialOperations = (filters?: { accountId?: string; subaccountId?: string }): Promise<FinancialOperationApi[]> => {
  const params = new URLSearchParams();
  if (filters?.subaccountId) params.set('subaccountId', filters.subaccountId);
  else if (filters?.accountId) params.set('accountId', filters.accountId);
  const qs = params.toString();
  return apiFetch(`/financial-operations${qs ? `?${qs}` : ''}`);
};
export const getFinancialOperation = (id: string): Promise<FinancialOperationDetailApi> => apiFetch(`/financial-operations/${id}`);

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
  /** Ajouter > "Remboursable par mutuelle ?" (visible si Catégorie=Santé). */
  createMedicalClaim?: boolean;
}) => apiFetch('/financial-operations', { method: 'POST', body: data });

/** "Annuler" une transaction réalisée (§4) — reversal exact construit côté serveur, jamais côté client. */
export const cancelFinancialOperation = (id: string, data?: { reason?: string }): Promise<FinancialOperationApi> =>
  apiFetch(`/financial-operations/${id}/cancel`, { method: 'POST', body: data ?? {} });

/** "Modifier" une transaction réalisée (§4) — reversal + nouvelle opération corrigée, atomique côté serveur. */
export const correctFinancialOperation = (
  id: string,
  data: { label: string; date: string; amount: string; categoryId?: string; reason?: string },
): Promise<FinancialOperationApi> => apiFetch(`/financial-operations/${id}/correct`, { method: 'POST', body: data });

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
  recurrenceRuleId?: string;
  sourceAccountId?: string;
  sourceSubaccountId?: string;
  destinationAccountId?: string;
  destinationSubaccountId?: string;
}) => apiFetch('/planned-operations', { method: 'POST', body: data });

export const realizePlannedOperation = (id: string, data: { actualAmount: string; actualDate?: string; label?: string }) =>
  apiFetch(`/planned-operations/${id}/realize`, { method: 'POST', body: data });

export const cancelPlannedOperation = (id: string) => apiFetch(`/planned-operations/${id}/cancel`, { method: 'POST' });

/** Modifier UNE occurrence (appui long, ex. prévu 700 -> réel ajusté avant paiement) — ne touche jamais la règle. */
export const updatePlannedOperation = (
  id: string,
  data: { expectedAmount?: string; expectedDate?: string; label?: string; categoryId?: string; sourceAccountId?: string; sourceSubaccountId?: string; destinationAccountId?: string; destinationSubaccountId?: string },
): Promise<PlannedOperationApi> => apiFetch(`/planned-operations/${id}`, { method: 'PATCH', body: data });

/** "Annuler le paiement" (case verte, appui long) — renversement validé, jamais de suppression de la transaction d'origine. */
export const unrealizePlannedOperation = (id: string): Promise<PlannedOperationApi> => apiFetch(`/planned-operations/${id}/unrealize`, { method: 'POST' });

// ---------- Dossiers santé / mutuelle (§10) ----------
export interface MedicalReimbursementApi {
  id: string;
  claimId: string;
  amount: number;
  date: string;
  operationId: string;
  allocationSubaccountId: string | null;
}

export interface MedicalClaimApi {
  id: string;
  sourceOperationId: string;
  subaccountId: string | null;
  label: string;
  amountEngaged: number;
  amountReimbursed: number;
  reste: number;
  status: 'PENDING' | 'CLOSED';
  closedAt: string | null;
  createdAt: string;
  reimbursements: MedicalReimbursementApi[];
}

export const listMedicalClaims = (subaccountId?: string): Promise<MedicalClaimApi[]> =>
  apiFetch(`/medical-claims${subaccountId ? `?subaccountId=${subaccountId}` : ''}`);

/** "J'ai reçu un remboursement" — crée l'opération MEDICAL_REIMBURSEMENT + la ligne dédiée. */
export const addMedicalReimbursement = (
  claimId: string,
  data: { amount: string; date: string; destinationAccountId: string; allocationSubaccountId?: string },
): Promise<MedicalClaimApi> => apiFetch(`/medical-claims/${claimId}/reimbursements`, { method: 'POST', body: data });

/** Clôture manuelle (§8) — dossier terminé même avec un reste à charge non nul, jamais de modification des montants. */
export const closeMedicalClaimManually = (claimId: string): Promise<MedicalClaimApi> => apiFetch(`/medical-claims/${claimId}/close`, { method: 'POST' });

// ---------- Règles de récurrence (Ajouter > Type=Récurrente, §11 / Checkpoint 3 §18-19) ----------
export type RecurrenceFrequency = 'WEEKLY' | 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'YEARLY' | 'ONCE';

export interface RecurrenceRuleApi {
  id: string;
  frequency: RecurrenceFrequency;
  anchorDate: string;
  label: string | null;
  active: boolean;
  kind: PlannedOperationKind;
  expectedAmount: number;
  categoryId: string | null;
  sourceAccountId: string | null;
  sourceSubaccountId: string | null;
  destinationAccountId: string | null;
  destinationSubaccountId: string | null;
}

export const listRecurrenceRules = (): Promise<RecurrenceRuleApi[]> => apiFetch('/recurrence-rules');

export const createRecurrenceRule = (data: {
  frequency: RecurrenceFrequency;
  anchorDate: string;
  label?: string;
  kind: PlannedOperationKind;
  expectedAmount: string;
  categoryId?: string;
  sourceAccountId?: string;
  sourceSubaccountId?: string;
  destinationAccountId?: string;
  destinationSubaccountId?: string;
}): Promise<RecurrenceRuleApi> => apiFetch('/recurrence-rules', { method: 'POST', body: data });

/** Modifier une règle (§19) : applyFrom pilote "cette occurrence seulement" (jamais le gabarit) vs "cette occurrence et les suivantes". */
export const updateRecurrenceRule = (
  id: string,
  data: {
    applyFrom: 'THIS_OCCURRENCE' | 'THIS_AND_FOLLOWING';
    fromDate: string;
    expectedAmount?: string;
    label?: string;
    categoryId?: string;
    sourceAccountId?: string;
    sourceSubaccountId?: string;
    destinationAccountId?: string;
    destinationSubaccountId?: string;
    active?: boolean;
  },
): Promise<RecurrenceRuleApi> => apiFetch(`/recurrence-rules/${id}`, { method: 'PATCH', body: data });

// ---------- Planning multi-mois (Checkpoint 3) ----------
export type PlanningCellStatus = 'EMPTY' | 'PENDING' | 'REALIZED' | 'MIXED';

export interface PlanningCellItemApi {
  type: 'PLANNED_PENDING' | 'PLANNED_REALIZED' | 'REAL_UNPLANNED';
  plannedOperationId?: string;
  financialOperationId?: string;
  label: string;
  amount: number;
  date: string;
  sourceAccountId: string | null;
  sourceSubaccountId: string | null;
  destinationAccountId: string | null;
  destinationSubaccountId: string | null;
}

export interface PlanningSingleOccurrenceApi {
  plannedOperationId: string;
  status: 'PENDING' | 'REALIZED';
  expectedAmount: number;
  realizedAmount: number | null;
  sourceAccountId: string | null;
  sourceSubaccountId: string | null;
  destinationAccountId: string | null;
  destinationSubaccountId: string | null;
}

export interface PlanningCellApi {
  displayAmount: number;
  budgetAmount: number;
  pendingAmount: number;
  realizedAmount: number;
  status: PlanningCellStatus;
  singleOccurrence: PlanningSingleOccurrenceApi | null;
  items: PlanningCellItemApi[];
}

export interface PlanningRowApi {
  key: string;
  label: string;
  categoryId?: string;
  /** Titre de regroupement visuel uniquement (Lot ciblé §5) — jamais une ligne financière. */
  categoryLabel?: string;
  cells: Record<string, PlanningCellApi>;
}

export interface PlanningMonthSyntheseApi {
  totalRevenus: number;
  totalDepenses: number;
  totalEpargne: number;
  balanceMensuelle: number;
  balanceCumulee: number;
}

export interface PlanningTableApi {
  months: string[];
  revenus: PlanningRowApi[];
  depenses: PlanningRowApi[];
  epargne: PlanningRowApi[];
  synthese: Record<string, PlanningMonthSyntheseApi>;
}

/** Endpoint agrégé unique — jamais 1 requête par ligne/mois/catégorie. */
export const getPlanning = (months: number): Promise<PlanningTableApi> => apiFetch(`/planning?months=${months}`);

// ---------- Plans financiers (Checkpoint 3/4) ----------
export interface FinancialPlanDeadlineItemApi {
  plannedOperationId: string;
  itemId: string | null;
  label: string;
  amount: number;
  status: 'PENDING' | 'REALIZED';
}

export interface FinancialPlanDeadlineSummaryApi {
  deadlineId: string;
  label: string;
  dueDate: string;
  /** Montant propre de l'échéance, saisi à sa création — jamais additionné à totalPrevu (déjà inclus dedans). */
  expectedAmount: number | null;
  totalPrevu: number;
  disponible: number;
  reste: number;
  monthsRemaining: number;
  recommendedMonthly: number;
  paid: boolean;
  items: FinancialPlanDeadlineItemApi[];
}

export interface FinancialPlanItemApi {
  id: string;
  label: string;
  expectedAmount: number | null;
  frequency: RecurrenceFrequency;
  active: boolean;
}

export interface FinancialPlanApi {
  id: string;
  label: string;
  accountId: string | null;
  subaccountId: string | null;
  disponibleActuel: number | null;
  items: FinancialPlanItemApi[];
  deadlines: FinancialPlanDeadlineSummaryApi[];
  nextDeadline: FinancialPlanDeadlineSummaryApi | null;
}

export const listFinancialPlans = (): Promise<FinancialPlanApi[]> => apiFetch('/financial-plans');
export const getFinancialPlan = (id: string): Promise<FinancialPlanApi> => apiFetch(`/financial-plans/${id}`);

export const createFinancialPlan = (data: {
  label: string;
  accountId?: string;
  subaccountId?: string;
  items?: { label: string; expectedAmount?: string; frequency?: RecurrenceFrequency }[];
  deadlines?: { label: string; dueDate: string }[];
}): Promise<FinancialPlanApi> => apiFetch('/financial-plans', { method: 'POST', body: data });

export const updateFinancialPlan = (id: string, data: { label?: string; accountId?: string; subaccountId?: string }): Promise<FinancialPlanApi> =>
  apiFetch(`/financial-plans/${id}`, { method: 'PATCH', body: data });

/** Ajouter un poste (§13/§14) — récurrent (frequency != ONCE) ou ponctuel, backfill immédiat sur les échéances existantes si récurrent. */
export const addFinancialPlanItem = (planId: string, data: { label: string; expectedAmount?: string; frequency?: RecurrenceFrequency }): Promise<FinancialPlanItemApi> =>
  apiFetch(`/financial-plans/${planId}/items`, { method: 'POST', body: data });

export const addFinancialPlanDeadline = (planId: string, data: { label: string; dueDate: string; amount: string }) =>
  apiFetch(`/financial-plans/${planId}/deadlines`, { method: 'POST', body: data });

/** "Détail d'une échéance" (§12) — ajoute/ajuste le montant d'un poste pour CETTE échéance précisément. */
export const addItemToDeadline = (deadlineId: string, data: { itemId: string; amount: string }) =>
  apiFetch(`/financial-plans/deadlines/${deadlineId}/items`, { method: 'POST', body: data });

/** "Marquer comme payée" (§12) — réalise en bloc toutes les lignes encore prévues de cette échéance. */
export const markDeadlinePaid = (deadlineId: string) => apiFetch(`/financial-plans/deadlines/${deadlineId}/mark-paid`, { method: 'POST' });

// ---------- Objectifs simples (§16-17) ----------
export interface GoalApi {
  id: string;
  accountId: string | null;
  subaccountId: string | null;
  targetAmount: number;
  targetDate: string | null;
  label: string | null;
  current: number;
  percent: number;
}

export const listGoals = (): Promise<GoalApi[]> => apiFetch('/goals');

export const createGoal = (data: { accountId?: string; subaccountId?: string; targetAmount: string; targetDate?: string; label?: string }): Promise<GoalApi> =>
  apiFetch('/goals', { method: 'POST', body: data });

export const deleteGoal = (id: string) => apiFetch(`/goals/${id}`, { method: 'DELETE' });
