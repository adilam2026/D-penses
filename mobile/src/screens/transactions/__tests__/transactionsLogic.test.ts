import { LedgerEntry, groupByMonthAndPlan, isPlanHeaderRow, sortLedgerEntries } from '../transactionsLogic';

/**
 * Corrections consolidées §12/§13 — tests unitaires purs du moteur de tri et
 * de regroupement (plus fiables que des assertions d'ordre DOM sur l'écran).
 */
function entry(overrides: Partial<LedgerEntry> & Pick<LedgerEntry, 'id' | 'occurredAt' | 'label'>): LedgerEntry {
  return {
    kind: 'adhoc_expense',
    displayKind: 'depense',
    amount: -10,
    accountName: 'Compte',
    categoryId: null,
    categoryName: null,
    categoryTypeName: null,
    categorySubtypeName: null,
    createdByUserId: null,
    createdByName: null,
    budgetId: null,
    financialPlanId: null,
    ...overrides,
  };
}

describe('§13 — sortLedgerEntries', () => {
  it('trie par jour décroissant, puis alphabétiquement par libellé pour le même jour', () => {
    const entries = [
      entry({ id: 'sept', occurredAt: '2026-09-15T10:00:00.000Z', label: 'Septembre' }),
      entry({ id: 'z', occurredAt: '2026-09-10T08:00:00.000Z', label: 'Zoo' }),
      entry({ id: 'a', occurredAt: '2026-09-10T18:00:00.000Z', label: 'Alimentation' }),
      entry({ id: 'm', occurredAt: '2026-09-10T12:00:00.000Z', label: 'Médecin' }),
    ];

    const sorted = sortLedgerEntries(entries);

    expect(sorted.map((e) => e.id)).toEqual(['sept', 'a', 'm', 'z']);
  });

  it('ne modifie jamais le tableau original (fonction pure)', () => {
    const entries = [entry({ id: 'b', occurredAt: '2026-09-10T00:00:00.000Z', label: 'B' }), entry({ id: 'a', occurredAt: '2026-09-10T00:00:00.000Z', label: 'A' })];
    const original = [...entries];

    sortLedgerEntries(entries);

    expect(entries).toEqual(original);
  });
});

describe('§12 — groupByMonthAndPlan', () => {
  it('groupe par mois puis par plan financier, avec "Autres" en dernier pour les transactions sans plan', () => {
    const entries = [
      entry({ id: 'ecole', occurredAt: '2026-09-05T00:00:00.000Z', label: 'Scolarité T1', financialPlanId: 'plan-school' }),
      entry({ id: 'salaire', occurredAt: '2026-09-10T00:00:00.000Z', label: 'Salaire', financialPlanId: null }),
      entry({ id: 'voyage', occurredAt: '2026-09-12T00:00:00.000Z', label: 'Billet avion', financialPlanId: 'plan-travel' }),
    ];
    const planLabelById = { 'plan-school': 'École 2026', 'plan-travel': 'Voyage Espagne' };

    const sections = groupByMonthAndPlan(entries, planLabelById);

    expect(sections).toHaveLength(1);
    const rows = sections[0].data;
    const headers = rows.filter(isPlanHeaderRow).map((r) => r.label);
    // Ordre = première apparition dans le tri par date décroissante (Voyage le 12,
    // École le 5) — "Autres" reste toujours en dernier quel que soit cet ordre.
    expect(headers).toEqual(['Voyage Espagne', 'École 2026', 'Autres']);

    // Partition stricte : chaque transaction listée UNE seule fois, dans le bon sous-groupe.
    const idsByGroup: Record<string, string[]> = {};
    let currentGroup = '';
    for (const row of rows) {
      if (isPlanHeaderRow(row)) {
        currentGroup = row.label;
        idsByGroup[currentGroup] = [];
      } else {
        idsByGroup[currentGroup].push(row.id);
      }
    }
    expect(idsByGroup['École 2026']).toEqual(['ecole']);
    expect(idsByGroup['Voyage Espagne']).toEqual(['voyage']);
    expect(idsByGroup['Autres']).toEqual(['salaire']);
  });

  it('jamais de bucket "Autres" quand toutes les transactions sont liées à un plan', () => {
    const entries = [entry({ id: 'ecole', occurredAt: '2026-09-05T00:00:00.000Z', label: 'Scolarité T1', financialPlanId: 'plan-school' })];

    const sections = groupByMonthAndPlan(entries, { 'plan-school': 'École 2026' });

    const headers = sections[0].data.filter(isPlanHeaderRow).map((r) => r.label);
    expect(headers).toEqual(['École 2026']);
  });

  // Point 3 (révision) — niveau 2 : FinancialPlan si présent, SINON catégorie,
  // SINON "Autres". Auparavant, une transaction sans plan tombait directement
  // dans "Autres" même si elle avait une catégorie — jamais utilisée comme repli.
  it('utilise la catégorie comme repli quand aucun plan n\'est rattaché (jamais "Autres" prématurément)', () => {
    const entries = [
      entry({ id: 'ecole', occurredAt: '2026-09-05T00:00:00.000Z', label: 'Scolarité T1', financialPlanId: 'plan-school' }),
      entry({ id: 'courses1', occurredAt: '2026-09-08T00:00:00.000Z', label: 'Carrefour', categoryId: 'cat-alim', categoryName: 'Alimentation' }),
      entry({ id: 'courses2', occurredAt: '2026-09-09T00:00:00.000Z', label: 'Boucherie', categoryId: 'cat-alim', categoryName: 'Alimentation' }),
      entry({ id: 'salaire', occurredAt: '2026-09-10T00:00:00.000Z', label: 'Salaire' }), // ni plan ni catégorie
    ];

    const sections = groupByMonthAndPlan(entries, { 'plan-school': 'École 2026' });

    const rows = sections[0].data;

    // Partition stricte : chaque transaction listée une seule fois, sous le bon groupe.
    const idsByGroup: Record<string, string[]> = {};
    let currentGroup = '';
    for (const row of rows) {
      if (isPlanHeaderRow(row)) {
        currentGroup = row.label;
        idsByGroup[currentGroup] = [];
      } else {
        idsByGroup[currentGroup].push(row.id);
      }
    }
    expect(idsByGroup['École 2026']).toEqual(['ecole']);
    // Les 2 courses partagent la MÊME catégorie → un seul groupe "Alimentation", jamais dupliqué.
    expect(idsByGroup['Alimentation']).toEqual(['courses2', 'courses1']);
    expect(idsByGroup['Autres']).toEqual(['salaire']);
    // Ordre des groupes = première apparition dans le tri par date décroissante
    // (Alimentation le 09-09, École le 09-05) — "Autres" toujours en dernier.
    expect(Object.keys(idsByGroup)).toEqual(['Alimentation', 'École 2026', 'Autres']);
  });

  it('mois différents produisent des sections distinctes, plus récent en premier', () => {
    const entries = [
      entry({ id: 'aout', occurredAt: '2026-08-15T00:00:00.000Z', label: 'Août' }),
      entry({ id: 'sept', occurredAt: '2026-09-15T00:00:00.000Z', label: 'Septembre' }),
    ];

    const sections = groupByMonthAndPlan(entries, {});

    expect(sections.map((s) => s.title)).toEqual(['septembre 2026', 'août 2026']);
  });
});
