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

export const createHousehold = (name: string) => apiFetch('/households', { method: 'POST', body: { name } });

export const getMyHousehold = () => apiFetch('/households/me');

export const createInvite = () => apiFetch('/households/invites', { method: 'POST', body: {} });

export const joinHousehold = (code: string) => apiFetch('/households/join', { method: 'POST', body: { code } });

// ---------- Comptes (Lot 1) ----------
export const listAccounts = () => apiFetch('/accounts');

export const getAccountsSummary = () => apiFetch('/accounts/summary');

export const getQuickAddDefaultAccount = (): Promise<{ accountId: string | null }> => apiFetch('/accounts/quick-add-default');

export const createAccount = (data: { name: string; type: string; initialBalance?: number; includeInOperationalTreasury?: boolean }) =>
  apiFetch('/accounts', { method: 'POST', body: data });

export const setAccountFavorite = (accountId: string) => apiFetch(`/accounts/${accountId}/favorite`, { method: 'POST' });

export const getAccount = (
  accountId: string,
): Promise<{
  id: string;
  name: string;
  type: string;
  status: 'actif' | 'archive';
  includeInOperationalTreasury: boolean;
  soldeCourant: number;
  reservedByEnvelopes: number;
}> => apiFetch(`/accounts/${accountId}`);

// R5 clôture §2 — Modifier / Archiver (jamais de suppression physique).
// R6.1 §8 — includeInOperationalTreasury bascule le pilotage (trésorerie/disponible
// libre/projection) sans jamais toucher au solde ni à l'historique du compte.
export const updateAccount = (
  id: string,
  data: { name?: string; type?: string; status?: 'actif' | 'archive'; includeInOperationalTreasury?: boolean },
) => apiFetch(`/accounts/${id}`, { method: 'PATCH', body: data });

/** `includeArchived` réservé à l'écran de gestion des comptes — les sélecteurs de nouvelle transaction n'appellent jamais ce paramètre. */
export const listAllAccounts = () => apiFetch('/accounts?includeArchived=true');

// ---------- Rapprochement / ajustement de compte (Lot 1) ----------
export const createReconciliation = (accountId: string, data: { declaredBalance: number }) =>
  apiFetch(`/accounts/${accountId}/reconciliations`, { method: 'POST', body: data });

export const listReconciliations = (accountId: string) => apiFetch(`/accounts/${accountId}/reconciliations`);

export const adjustReconciliation = (accountId: string, reconciliationId: string, data: { reason?: string } = {}) =>
  apiFetch(`/accounts/${accountId}/reconciliations/${reconciliationId}/adjust`, { method: 'POST', body: data });

// ---------- Transactions (Lot 2) ----------
export const listTransactions = () => apiFetch('/transactions');

// §5 (recette téléphone réel) : détail enrichi d'une ligne (kind+id l'identifient sans ambiguïté).
export const getTransactionDetail = (kind: string, id: string) => apiFetch(`/transactions/${kind}/${id}`);

// ---------- Revenus (Lot 2) ----------
export const createIncomeSource = (data: {
  label: string;
  usualAmount: number;
  defaultAccountId: string;
  isRecurring?: boolean;
  recurrenceRule?: string;
  recurrenceAnchorDate?: string;
  beneficiaryUserId?: string;
  categoryId?: string;
}) => apiFetch('/income-sources', { method: 'POST', body: data });

export const listIncomeSources = () => apiFetch('/income-sources');

export const getIncomeSource = (id: string) => apiFetch(`/income-sources/${id}`);

export const updateIncomeSource = (
  id: string,
  data: {
    label?: string;
    categoryId?: string | null;
    recurrenceRule?: string;
    recurrenceAnchorDate?: string | null;
    usualAmount?: number;
    isRecurring?: boolean;
    defaultAccountId?: string;
    status?: 'actif' | 'inactif';
  },
) => apiFetch(`/income-sources/${id}`, { method: 'PATCH', body: data });

/** Recette post-Vague 3 (§5) — refusé (409) si une occurrence a déjà été reçue ; désactiver (status=inactif) à la place. */
export const deleteIncomeSource = (id: string) => apiFetch(`/income-sources/${id}`, { method: 'DELETE' });

export const createIncomeOccurrence = (sourceId: string, data: { usualDate: string; plannedAmount?: number }) =>
  apiFetch(`/income-sources/${sourceId}/occurrences`, { method: 'POST', body: data });

export const listIncomeOccurrences = (sourceId: string) => apiFetch(`/income-sources/${sourceId}/occurrences`);

export const confirmIncomeOccurrence = (
  occurrenceId: string,
  data: { actualAmount: number; actualDate?: string; accountId?: string },
) => apiFetch(`/income-occurrences/${occurrenceId}/confirm`, { method: 'POST', body: data });

// R5 clôture §1 — Annuler une confirmation erronée (revient à "prevu", jamais un DELETE).
export const unconfirmIncomeOccurrence = (occurrenceId: string) =>
  apiFetch(`/income-occurrences/${occurrenceId}/unconfirm`, { method: 'POST' });

// ---------- Charges & paiements (Lot 2) ----------
export const createChargePlan = (data: {
  label: string;
  startDate: string;
  categoryId?: string;
  recurrenceRule?: string;
  recurrenceAnchorDate?: string;
  childIds?: string[];
}) => apiFetch('/charge-plans', { method: 'POST', body: data });

export const createDeadline = (
  chargePlanId: string,
  data: { dueDate: string; amountCurrent?: number; amountStatus?: string; expectedBillingDate?: string },
) => apiFetch(`/charge-plans/${chargePlanId}/deadlines`, { method: 'POST', body: data });

export const listChargePlanDeadlines = (chargePlanId: string) => apiFetch(`/charge-plans/${chargePlanId}/deadlines`);

export const closeDeadline = (id: string) => apiFetch(`/deadlines/${id}/close`, { method: 'POST' });

export const cancelDeadline = (id: string) => apiFetch(`/deadlines/${id}/cancel`, { method: 'POST' });

export const createPayment = (
  deadlineId: string,
  data: { amount: number; accountId: string; paidDate?: string; type?: string },
) => apiFetch(`/deadlines/${deadlineId}/payments`, { method: 'POST', body: data });

export const listPayments = (deadlineId: string) => apiFetch(`/deadlines/${deadlineId}/payments`);

// R5 clôture §1 — Corriger (contre-écriture RG-015) / Annuler (remboursement), jamais une réécriture du Payment original.
export const correctPayment = (deadlineId: string, paymentId: string, data: { correctedAmount: number }) =>
  apiFetch(`/deadlines/${deadlineId}/payments/${paymentId}/correct`, { method: 'POST', body: data });

export const reversePayment = (deadlineId: string, paymentId: string) =>
  apiFetch(`/deadlines/${deadlineId}/payments/${paymentId}/reverse`, { method: 'POST' });

/** Échéances encore ouvertes du foyer — saisie rapide « Paiement d'une échéance » (Lot 3 §2/§16). */
export const listOpenDeadlines = () => apiFetch('/deadlines');

export const createTransfer = (data: { fromAccountId?: string; toAccountId?: string; amount: number; plannedDate?: string }) =>
  apiFetch('/accounts/transfers', { method: 'POST', body: data });

/**
 * R6.2 (§10-12) : "Ajouter > Transfert > Récurrent" — objet séparé d'une charge
 * (jamais une ChargePlan, RG implicite §10). recurrenceRule n'accepte jamais
 * 'ponctuel' ici — un transfert sans répétition passe par createTransfer.
 */
export const createRecurringTransfer = (data: {
  label: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  recurrenceRule: 'hebdomadaire' | 'mensuel' | 'trimestriel' | 'semestriel' | 'annuel';
  recurrenceAnchorDate: string;
  note?: string;
}) => apiFetch('/recurring-transfers', { method: 'POST', body: data });

export const listRecurringTransfers = () => apiFetch('/recurring-transfers');

export const getRecurringTransfer = (id: string) => apiFetch(`/recurring-transfers/${id}`);

/**
 * R6.2 corrections finales §4 — édition d'un transfert récurrent : ne touche
 * jamais les occurrences déjà confirmées (RecurringTransfersService.update
 * ne supprime que les 'prevu' quand la récurrence change), status=inactif =
 * "arrêter la récurrence" (jamais une suppression, l'historique reste
 * consultable).
 */
export const updateRecurringTransfer = (
  id: string,
  data: Partial<{
    label: string;
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    recurrenceRule: 'hebdomadaire' | 'mensuel' | 'trimestriel' | 'semestriel' | 'annuel';
    recurrenceAnchorDate: string;
    note: string;
    status: 'actif' | 'inactif';
  }>,
) => apiFetch(`/recurring-transfers/${id}`, { method: 'PATCH', body: data });

// R6.2 corrections finales §4/§5 — historique/occurrences (toutes les AccountTransfer du
// foyer) : le détail d'un transfert récurrent filtre côté client par recurringTransferId,
// même patron déjà utilisé côté tests e2e (generatedTransfers()) — jamais un second endpoint.
export const listTransfers = () => apiFetch('/accounts/transfers');

/** R6.2 corrections finales §5 — confirme une occurrence encore "prevu" : débit/crédit réel atomique. */
export const confirmTransfer = (id: string) => apiFetch(`/accounts/transfers/${id}/confirm`, { method: 'POST' });

// R5 clôture §1 — Annuler un transfert "prevu" (rien n'a bougé) / Annuler par miroir atomique (confirmé).
export const cancelTransfer = (id: string) => apiFetch(`/accounts/transfers/${id}/cancel`, { method: 'POST' });

export const reverseTransfer = (id: string) => apiFetch(`/accounts/transfers/${id}/reverse`, { method: 'POST' });

// ---------- Catégories ----------
export const listCategories = () => apiFetch('/categories');

export const createCategory = (data: { name: string; kind: 'income' | 'expense' | 'both'; icon?: string }) =>
  apiFetch('/categories', { method: 'POST', body: data });

// Vague 2 §1/§3 — Type (rattaché à une Catégorie) et Sous-type (rattaché à un Type),
// facultatifs, jamais requis pour saisir une transaction.
export const listCategoryTypes = (categoryId: string) => apiFetch(`/categories/${categoryId}/types`);

export const createCategoryType = (categoryId: string, data: { name: string }) =>
  apiFetch(`/categories/${categoryId}/types`, { method: 'POST', body: data });

export const updateCategoryType = (id: string, data: { name?: string; active?: boolean }) =>
  apiFetch(`/category-types/${id}`, { method: 'PATCH', body: data });

export const createCategorySubtype = (categoryTypeId: string, data: { name: string }) =>
  apiFetch(`/category-types/${categoryTypeId}/subtypes`, { method: 'POST', body: data });

export const updateCategorySubtype = (id: string, data: { name?: string; active?: boolean }) =>
  apiFetch(`/category-subtypes/${id}`, { method: 'PATCH', body: data });

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
  categoryTypeId?: string;
  categorySubtypeId?: string;
  spentDate?: string;
  variableBudgetId?: string;
  notes?: string;
}) => apiFetch('/expenses', { method: 'POST', body: data });

// R5 clôture §1 — Modifier (description uniquement, jamais le montant).
export const updateExpenseMetadata = (
  kind: 'adhoc_expense' | 'budget_expense',
  id: string,
  data: { categoryId?: string; categoryTypeId?: string; categorySubtypeId?: string; notes?: string },
) => apiFetch(`/expenses/${kind}/${id}`, { method: 'PATCH', body: data });

// R5 clôture §1 — Corriger/Annuler (Adjustment), adhoc_expense uniquement (cf. rapport pour budget_expense).
export const correctAdhocExpense = (id: string, data: { correctedAmount: number }) =>
  apiFetch(`/expenses/adhoc_expense/${id}/correct`, { method: 'POST', body: data });

export const reverseAdhocExpense = (id: string) => apiFetch(`/expenses/adhoc_expense/${id}/reverse`, { method: 'POST' });

// ---------- Enfants ----------
export const listChildren = () => apiFetch('/children');

export const createChild = (data: { firstName: string; lastName: string }) =>
  apiFetch('/children', { method: 'POST', body: data });

export const getChildCosts = (childId: string) => apiFetch(`/children/${childId}/costs`);

// ---------- Charges planifiées (Lot 4) ----------
export const getChargePlan = (id: string) => apiFetch(`/charge-plans/${id}`);

export const listChargePlans = () => apiFetch('/charge-plans');

export const updateChargePlan = (
  id: string,
  data: {
    label?: string;
    categoryId?: string | null;
    recurrenceRule?: string;
    recurrenceAnchorDate?: string | null;
    amountCurrent?: number;
    amountStatus?: 'inconnu' | 'estime' | 'confirme';
    defaultAccountId?: string | null;
    obligationStatus?: string;
    financialPlanId?: string | null;
    status?: 'actif' | 'inactif';
  },
) => apiFetch(`/charge-plans/${id}`, { method: 'PATCH', body: data });

/** Recette post-Vague 3 (§4) — refusé (409) si un historique de paiement existe ; désactiver (status=inactif) à la place. */
export const deleteChargePlan = (id: string) => apiFetch(`/charge-plans/${id}`, { method: 'DELETE' });

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

export const listFinancialPlanBeneficiaries = (planId: string) => apiFetch(`/financial-plans/${planId}/beneficiaries`);

// R5 §2 — Modifier / Supprimer.
export const updateFinancialPlan = (id: string, data: { label?: string; periodStart?: string; periodEnd?: string; destination?: string }) =>
  apiFetch(`/financial-plans/${id}`, { method: 'PATCH', body: data });

export const deleteFinancialPlan = (id: string) => apiFetch(`/financial-plans/${id}`, { method: 'DELETE' });

// R5 §3 — Dupliquer avec sélection explicite des enfants bénéficiaires de la copie.
export const duplicateFinancialPlan = (id: string, data: { label: string; childIds?: string[] }) =>
  apiFetch(`/financial-plans/${id}/duplicate`, { method: 'POST', body: data });

// ---------- Assistant frais scolaires (§17) ----------
export interface SchoolWizardItem {
  label: string;
  amount?: number | null;
  dueDate: string;
  obligationStatus?: string;
  recurrenceRule?: 'hebdomadaire' | 'mensuel' | 'trimestriel' | 'semestriel' | 'annuel';
  childIds?: string[];
  /** R6.2 (§4-9, §8) : poste déjà réglé avant la saisie de ce plan (ex. Uniforme payé en août). */
  alreadyPaid?: { amount: number; paidDate: string; accountId?: string };
}

export const submitSchoolWizard = (data: { label: string; childIds: string[]; periodStart: string; periodEnd: string; items: SchoolWizardItem[] }) =>
  apiFetch('/school-wizard', { method: 'POST', body: data });

// ---------- Assistant Voyage (§39/40 cadrage V1) ----------
export interface TravelWizardItem {
  label: string;
  amount?: number | null;
  dueDate: string;
}

export const submitTravelWizard = (data: {
  label: string;
  destination?: string;
  periodStart: string;
  periodEnd: string;
  linkedProvisionId?: string;
  items: TravelWizardItem[];
}) => apiFetch('/travel-wizard', { method: 'POST', body: data });

// ---------- Actions à traiter ----------
export const listActionsATraiter = () => apiFetch('/actions-a-traiter');

// ---------- Dashboard & Calendrier (Lot 5) ----------
export const getDashboardSummary = (at?: string) => apiFetch(`/dashboard/summary${at ? `?at=${at}` : ''}`);

export const getCalendar = (params?: { at?: string; from?: string; to?: string }) => {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return apiFetch(`/calendar${qs ? `?${qs}` : ''}`);
};

export const updateHouseholdSettings = (data: {
  securityMarginAmount?: number;
  seuilAVenirDays?: number;
  seuilAPayerDays?: number;
  homeBannerDismissed?: boolean;
}) => apiFetch('/households/settings', { method: 'PATCH', body: data });

// Vague 3 §25/§28 — étape d'onboarding marquée "non applicable"/"plus tard", partagée
// entre les adultes du foyer (HouseholdSettings.onboardingSkippedSteps).
export const skipOnboardingStep = (step: string) => apiFetch('/households/onboarding/skip', { method: 'PATCH', body: { step } });

// Vague 3 §24 — réinitialisation des données financières : mot de passe + confirmation
// explicite exigés, action atomique côté backend.
export const resetFinancialData = (data: { password: string; confirm: true }) =>
  apiFetch('/households/reset-financial-data', { method: 'POST', body: data });

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
export const updatePocket = (id: string, data: { name?: string; targetAmount?: number; targetDate?: string; isProtected?: boolean; linkedAccountId?: string }) =>
  apiFetch(`/pockets/${id}`, { method: 'PATCH', body: data });
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
export const updateProvision = (id: string, data: { name?: string; isFlexible?: boolean; linkedAccountId?: string }) =>
  apiFetch(`/provisions/${id}`, { method: 'PATCH', body: data });
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

// ---------- Simulateur What-if (Lot 8) ----------
export const simulatePurchase = (data: { amount: number; date: string; accountId: string; horizonDays?: number; includeEnvisagedOptions?: boolean }) =>
  apiFetch('/simulation/purchase', { method: 'POST', body: data });

export const simulateGoalContribution = (data: { goalId: string; amount: number; date: string; recurring?: boolean; dayOfMonth?: number; horizonDays?: number }) =>
  apiFetch('/simulation/goal-contribution', { method: 'POST', body: data });

export const getSavingsCapacity = (data: { recurring?: boolean; date?: string; dayOfMonth?: number; horizonDays?: number } = {}) =>
  apiFetch('/simulation/savings-capacity', { method: 'POST', body: data });

export const analyzeGoal = (goalId: string, horizonDays?: number) =>
  apiFetch('/simulation/goal', { method: 'POST', body: { goalId, horizonDays } });

// ---------- Projection (Lot 7) ----------
export const getProjection = (params: { at?: string; horizon?: number; to?: string } = {}) => {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])),
  ).toString();
  return apiFetch(`/projection${qs ? `?${qs}` : ''}`);
};

// ---------- Projection mensuelle (Round 4) ----------
export interface MonthlyLineItem {
  entityType: 'income_occurrence' | 'deadline' | 'variable_budget';
  entityId: string;
  label: string;
  date: string; // jour exact — date RÉELLE si realized=true, date prévue sinon
  amount: number;
  accountId: string | null;
  accountKnown: boolean;
  amountStatus?: 'estime' | 'confirme';
  category?: 'obligatoire' | 'flexible' | 'projet';
  movable: boolean;
  realized: boolean; // Round 4bis §1 — true = mouvement réel déjà survenu, false = encore prévu
}

export interface MonthBucketApi {
  month: string;
  label: string;
  total_income: number;
  total_expense: number;
  balance: number;
  cumulative_balance: number;
  projected_cash_balance: number; // Round 4bis §7 — trésorerie initiale + cumul des flux
  income_items: MonthlyLineItem[];
  expense_items: MonthlyLineItem[];
  movable_expense_total: number;
  is_complete: boolean;
  unknown_count: number;
  unknown_labels: string[];
  contains_estimates: boolean;
  excluded_by_filter_count: number;
  excluded_by_filter_total: number;
}

export interface MonthlyProjectionApi {
  reference_date: string;
  horizon_end: string;
  horizon_months: number;
  months: MonthBucketApi[];
  summary: {
    total_income: number;
    total_expense: number;
    total_balance: number;
    deficit_months_count: number;
    worst_month: { month: string; balance: number } | null;
    max_monthly_deficit: number | null;
    // Round 4bis §6-§9 — "Balance cumulée" (flux purs, part de zéro) N'EST PAS "Trésorerie" :
    // ces champs partent de la trésorerie RÉELLE initiale, jamais de zéro.
    opening_cash_balance: number;
    cash_low_point: { month: string; value: number } | null;
    max_financing_need: number; // max(0, -min(trésorerie projetée)) — toujours un nombre, 0 si jamais négative
    first_positive_cash_balance_month: string | null;
    treasury_account_ids: string[];
    is_complete: boolean;
    incomplete_months_count: number;
  };
  account_filters: { incomeAccountIds: string[] | null; expenseAccountIds: string[] | null };
}

/** "Compte non encore déterminé" — sentinelle de filtre (§4), même valeur que le backend. */
export const UNDETERMINED_ACCOUNT = '__undetermined__';

export const getMonthlyProjection = (params: {
  at?: string;
  horizonMonths?: number;
  incomeAccountIds?: string[] | null;
  expenseAccountIds?: string[] | null;
}): Promise<MonthlyProjectionApi> => {
  const qs = new URLSearchParams();
  if (params.at) qs.set('at', params.at);
  if (params.horizonMonths) qs.set('horizonMonths', String(params.horizonMonths));
  // "Tous" = paramètre absent (§4) ; une liste vide explicite `=` est distincte (n'inclut rien).
  if (params.incomeAccountIds !== undefined && params.incomeAccountIds !== null) qs.set('incomeAccountIds', params.incomeAccountIds.join(','));
  if (params.expenseAccountIds !== undefined && params.expenseAccountIds !== null) qs.set('expenseAccountIds', params.expenseAccountIds.join(','));
  return apiFetch(`/projection/monthly?${qs.toString()}`);
};

export const simulateMonthlyProjection = (params: {
  at?: string;
  horizonMonths?: number;
  incomeAccountIds?: string[] | null;
  expenseAccountIds?: string[] | null;
  moves: { deadlineId: string; newDate: string }[];
}): Promise<{ baseline: MonthlyProjectionApi; scenario: MonthlyProjectionApi }> => {
  const body: Record<string, unknown> = { at: params.at, horizonMonths: params.horizonMonths, moves: params.moves };
  if (params.incomeAccountIds) body.incomeAccountIds = params.incomeAccountIds;
  if (params.expenseAccountIds) body.expenseAccountIds = params.expenseAccountIds;
  return apiFetch('/projection/monthly/simulate', { method: 'POST', body });
};
