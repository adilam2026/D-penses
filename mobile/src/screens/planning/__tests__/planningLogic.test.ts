import { buildPlanningRows, rowsBySection, isCurrentMonth } from '../planningLogic';
import type { MonthBucketApi } from '../../../api/client';

function bucket(overrides: Partial<MonthBucketApi>): MonthBucketApi {
  return {
    month: '2026-09',
    label: 'Septembre 2026',
    total_income: 0,
    total_expense: 0,
    balance: 0,
    cumulative_balance: 0,
    projected_cash_balance: 0,
    projected_cash_balance_prudent: 0,
    prudent_budget_remaining: 0,
    budget_items: [],
    budget_items_this_period: [],
    budget_total_this_period: 0,
    income_items: [],
    expense_items: [],
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
    ...overrides,
  } as MonthBucketApi;
}

describe('buildPlanningRows', () => {
  it('regroupe un revenu récurrent sur plusieurs mois dans la même ligne', () => {
    const months = [
      bucket({ month: '2026-09', income_items: [{ entityType: 'income_occurrence', entityId: 'a', label: 'Salaire', date: '2026-09-05', amount: 15000, accountId: null, accountKnown: true, movable: false, realized: true }] }),
      bucket({ month: '2026-10', income_items: [{ entityType: 'income_occurrence', entityId: 'b', label: 'Salaire', date: '2026-10-05', amount: 15000, accountId: null, accountKnown: true, movable: false, realized: false }] }),
    ];
    const rows = buildPlanningRows(months);
    expect(rows).toHaveLength(1);
    expect(rows[0].section).toBe('revenus');
    expect(rows[0].valuesByMonth).toEqual({ '2026-09': 15000, '2026-10': 15000 });
  });

  it('sépare charges connues et exceptionnel (postes "projet")', () => {
    const months = [
      bucket({
        month: '2026-09',
        expense_items: [
          { entityType: 'deadline', entityId: 'd1', label: 'Loyer', date: '2026-09-01', amount: 4000, accountId: null, accountKnown: true, movable: false, realized: false, category: 'obligatoire' },
          { entityType: 'deadline', entityId: 'd2', label: 'Scolarité T1', date: '2026-09-10', amount: 6000, accountId: null, accountKnown: true, movable: false, realized: false, category: 'projet' },
        ],
      }),
    ];
    const rows = buildPlanningRows(months);
    const grouped = rowsBySection(rows);
    expect(grouped.find((g) => g.section === 'charges')?.rows.map((r) => r.label)).toEqual(['Loyer']);
    expect(grouped.find((g) => g.section === 'exceptionnel')?.rows.map((r) => r.label)).toEqual(['Scolarité T1']);
  });

  it('regroupe les enveloppes (budgets variables) par budget_id', () => {
    const months = [
      bucket({ month: '2026-09', budget_items_this_period: [{ budget_id: 'bud1', label: 'Courses', amount: 2000 }] }),
      bucket({ month: '2026-10', budget_items_this_period: [{ budget_id: 'bud1', label: 'Courses', amount: 2200 }] }),
    ];
    const rows = buildPlanningRows(months);
    expect(rows).toHaveLength(1);
    expect(rows[0].section).toBe('enveloppes');
    expect(rows[0].valuesByMonth).toEqual({ '2026-09': 2000, '2026-10': 2200 });
  });

  it('ajoute le calendrier mensuel réel des plans financiers (provisions) en ENVELOPPES', () => {
    const months = [bucket({ month: '2026-10' }), bucket({ month: '2026-11' })];
    const rows = buildPlanningRows(months, [
      {
        id: 'prov1',
        name: 'Scolarité',
        monthlyCalendar: [
          { month: '2026-10', recommendedAmount: 4500 },
          { month: '2026-11', recommendedAmount: 4500 },
        ],
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].section).toBe('enveloppes');
    expect(rows[0].label).toBe('Scolarité');
    expect(rows[0].valuesByMonth).toEqual({ '2026-10': 4500, '2026-11': 4500 });
  });

  it('un mois à 0 DH dans le calendrier de la provision ne crée pas de ligne', () => {
    const months = [bucket({ month: '2026-10' })];
    const rows = buildPlanningRows(months, [{ id: 'prov1', name: 'Voyage', monthlyCalendar: [{ month: '2026-10', recommendedAmount: 0 }] }]);
    expect(rows).toHaveLength(0);
  });

  it('trie les sections dans l\'ordre revenus/charges/enveloppes/exceptionnel', () => {
    const months = [
      bucket({
        month: '2026-09',
        income_items: [{ entityType: 'income_occurrence', entityId: 'a', label: 'Salaire', date: '2026-09-05', amount: 15000, accountId: null, accountKnown: true, movable: false, realized: true }],
        expense_items: [{ entityType: 'deadline', entityId: 'd1', label: 'Loyer', date: '2026-09-01', amount: 4000, accountId: null, accountKnown: true, movable: false, realized: false, category: 'obligatoire' }],
        budget_items_this_period: [{ budget_id: 'bud1', label: 'Courses', amount: 2000 }],
      }),
    ];
    const grouped = rowsBySection(buildPlanningRows(months));
    expect(grouped.map((g) => g.section)).toEqual(['revenus', 'charges', 'enveloppes']);
  });
});

describe('isCurrentMonth', () => {
  it('reconnaît le mois courant au format YYYY-MM', () => {
    const now = new Date(2026, 8, 22);
    expect(isCurrentMonth('2026-09', now)).toBe(true);
    expect(isCurrentMonth('2026-10', now)).toBe(false);
  });
});
