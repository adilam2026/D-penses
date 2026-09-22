import type { MonthBucketApi, MonthlyLineItem } from '../../../api/client';
import { buildPlanningRows, groupRowsByPlan, rowsBySection, FinancialPlanRef } from '../planningLogic';

/**
 * Convergence V6 §4/§11 — tests explicites anti-double-comptage pour le
 * regroupement Planning par plan financier (A-F du cahier des charges) :
 * un plan financier est un simple regroupement de charges, jamais un second
 * calcul de montant, et une charge rattachée à un plan ne doit jamais
 * apparaître deux fois (ni comme ligne autonome en plus du groupe, ni dans
 * la mauvaise section).
 */

function expenseItem(overrides: Partial<MonthlyLineItem> & { label: string; amount: number; date: string }): MonthlyLineItem {
  return {
    entityType: 'deadline',
    entityId: `deadline-${overrides.label}-${overrides.date}`,
    accountId: null,
    accountKnown: false,
    category: 'projet',
    movable: false,
    realized: false,
    financialPlanId: null,
    ...overrides,
  };
}

function makeMonth(month: string, label: string, expense_items: MonthlyLineItem[]): MonthBucketApi {
  return {
    month,
    label,
    total_income: 0,
    total_expense: expense_items.reduce((s, i) => s + i.amount, 0),
    balance: 0,
    cumulative_balance: 0,
    projected_cash_balance: 0,
    projected_cash_balance_prudent: 0,
    prudent_budget_remaining: 0,
    budget_items: [],
    budget_items_this_period: [],
    budget_total_this_period: 0,
    income_items: [],
    expense_items,
    movable_expense_total: 0,
    is_complete: true,
    unknown_count: 0,
    unknown_labels: [],
    contains_estimates: false,
    excluded_by_filter_count: 0,
    excluded_by_filter_total: 0,
    planned_transfer_net_treasury_impact: 0,
    planned_transfer_items: [],
    school_projection_items: [],
    school_projection_impact: 0,
    projected_cash_balance_with_forecasts: 0,
  };
}

const PLAN_ID = 'plan-scolarite-2026-2027';
const PLANS: FinancialPlanRef[] = [{ id: PLAN_ID, label: 'Scolarité 2026-2027' }];

describe('planningLogic — regroupement par plan financier (Convergence V6 §3/§4/§11)', () => {
  test('A — plan avec 3 charges dans le même mois : ligne parent = somme exacte (21800+1950+3395=27145)', () => {
    const months = [
      makeMonth('2026-09', 'Sept. 2026', [
        expenseItem({ label: 'Scolarité T1', amount: 21800, date: '2026-09-15', financialPlanId: PLAN_ID }),
        expenseItem({ label: 'Restauration T1', amount: 1950, date: '2026-09-15', financialPlanId: PLAN_ID }),
        expenseItem({ label: 'Uniforme', amount: 3395, date: '2026-09-20', financialPlanId: PLAN_ID }),
      ]),
    ];
    const rows = buildPlanningRows(months);
    const groups = groupRowsByPlan(rows, PLANS);
    const planItem = groups.find((g) => g.kind === 'plan');
    expect(planItem).toBeDefined();
    expect(planItem!.row.valuesByMonth['2026-09']).toBe(27145);
  });

  test('B — plan replié : une seule ligne parent visible dans le groupe (pas de sous-lignes exposées tant que non demandées)', () => {
    const months = [
      makeMonth('2026-09', 'Sept. 2026', [
        expenseItem({ label: 'Scolarité T1', amount: 21800, date: '2026-09-15', financialPlanId: PLAN_ID }),
        expenseItem({ label: 'Restauration T1', amount: 1950, date: '2026-09-15', financialPlanId: PLAN_ID }),
        expenseItem({ label: 'Uniforme', amount: 3395, date: '2026-09-20', financialPlanId: PLAN_ID }),
      ]),
    ];
    const rows = buildPlanningRows(months);
    const groups = groupRowsByPlan(rows, PLANS);
    // Un seul PlanningTreeItem de type 'plan' pour ce plan — jamais un item
    // 'standalone' en plus pour les mêmes charges (cf. test D).
    expect(groups.filter((g) => g.kind === 'plan' && g.row.financialPlanId === PLAN_ID)).toHaveLength(1);
  });

  test('C — plan déplié : ligne parent + exactement 3 sous-lignes (enfants du groupe)', () => {
    const months = [
      makeMonth('2026-09', 'Sept. 2026', [
        expenseItem({ label: 'Scolarité T1', amount: 21800, date: '2026-09-15', financialPlanId: PLAN_ID }),
        expenseItem({ label: 'Restauration T1', amount: 1950, date: '2026-09-15', financialPlanId: PLAN_ID }),
        expenseItem({ label: 'Uniforme', amount: 3395, date: '2026-09-20', financialPlanId: PLAN_ID }),
      ]),
    ];
    const rows = buildPlanningRows(months);
    const groups = groupRowsByPlan(rows, PLANS);
    const planItem = groups.find((g) => g.kind === 'plan');
    expect(planItem).toBeDefined();
    expect(planItem!.row.children).toHaveLength(3);
    expect(planItem!.row.children.map((c) => c.label).sort()).toEqual(['Restauration T1', 'Scolarité T1', 'Uniforme'].sort());
  });

  test('D — une charge liée à un plan ne doit JAMAIS apparaître une deuxième fois comme charge autonome', () => {
    const months = [
      makeMonth('2026-09', 'Sept. 2026', [
        expenseItem({ label: 'Scolarité T1', amount: 21800, date: '2026-09-15', financialPlanId: PLAN_ID }),
        expenseItem({ label: 'LYDEC', amount: 850, date: '2026-09-05', financialPlanId: null }),
      ]),
    ];
    const rows = buildPlanningRows(months);
    const groups = groupRowsByPlan(rows, PLANS);
    // "Scolarité T1" ne doit exister ni comme item standalone, ni ailleurs
    // qu'à l'intérieur du groupe du plan (aucune duplication de projection).
    const standaloneLabels = groups.filter((g) => g.kind === 'standalone').map((g) => g.row.label);
    expect(standaloneLabels).not.toContain('Scolarité T1');
    expect(standaloneLabels).toContain('LYDEC');
    const planItem = groups.find((g) => g.kind === 'plan');
    expect(planItem!.row.children.map((c) => c.label)).toEqual(['Scolarité T1']);
    // Le total du mois (parent du plan + charge autonome) ne compte chaque
    // charge qu'une seule fois : 21800 (plan) + 850 (LYDEC) = 21650 jamais
    // 22650+21800 (double comptage).
    const total = groups.reduce((sum, g) => sum + (g.row.valuesByMonth['2026-09'] ?? 0), 0);
    expect(total).toBe(22650);
  });

  test('E — plan avec charges sur plusieurs mois : chaque colonne affiche uniquement la somme des charges de CE mois', () => {
    const months = [
      makeMonth('2026-09', 'Sept. 2026', [expenseItem({ label: 'Scolarité T1', amount: 21800, date: '2026-09-15', financialPlanId: PLAN_ID })]),
      makeMonth('2027-01', 'Janv. 2027', [expenseItem({ label: 'Scolarité T2', amount: 21800, date: '2027-01-10', financialPlanId: PLAN_ID })]),
      makeMonth('2027-04', 'Avril 2027', [expenseItem({ label: 'Scolarité T3', amount: 21800, date: '2027-04-10', financialPlanId: PLAN_ID })]),
    ];
    const rows = buildPlanningRows(months);
    const groups = groupRowsByPlan(rows, PLANS);
    const planItem = groups.find((g) => g.kind === 'plan');
    expect(planItem!.row.valuesByMonth['2026-09']).toBe(21800);
    expect(planItem!.row.valuesByMonth['2027-01']).toBe(21800);
    expect(planItem!.row.valuesByMonth['2027-04']).toBe(21800);
    // Aucun mois ne doit accumuler le cumul des mois précédents (jamais 43600/65400).
    expect(Object.keys(planItem!.row.valuesByMonth)).toHaveLength(3);
  });

  test('§3 — un plan financier apparaît dans CHARGES CONNUES, jamais en EXCEPTIONNEL (même si category backend="projet")', () => {
    const months = [
      makeMonth('2026-09', 'Sept. 2026', [
        expenseItem({ label: 'Scolarité T1', amount: 21800, date: '2026-09-15', financialPlanId: PLAN_ID, category: 'projet' }),
      ]),
    ];
    const rows = buildPlanningRows(months);
    expect(rows.find((r) => r.label === 'Scolarité T1')?.section).toBe('charges');
    const bySection = rowsBySection(rows);
    expect(bySection.find((s) => s.section === 'exceptionnel')).toBeUndefined();
    expect(bySection.find((s) => s.section === 'charges')).toBeDefined();
  });
});
