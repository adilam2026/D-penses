import { computePocketCardView, computeProvisionCardView, PocketLike, ProvisionSufficiencyLike } from '../envelopesLogic';

function pocket(overrides: Partial<PocketLike> = {}): PocketLike {
  return {
    id: 'p1',
    name: 'Voiture',
    allocationMode: 'virtual_allocation',
    linkedAccountId: 'acc1',
    targetAmount: 10000,
    targetDate: null,
    monthlyContribution: 2000,
    currentAmount: 4500,
    ...overrides,
  };
}

describe('§7A — computePocketCardView (enveloppe permanente)', () => {
  it('calcule le pourcentage disponible/objectif, arrondi', () => {
    expect(computePocketCardView(pocket({ currentAmount: 4500, targetAmount: 10000 }))).toEqual({
      percent: 45,
      status: 'en_cours',
      statusLabel: 'En cours',
    });
  });

  it("objectif atteint (current >= target) plafonne à 100% et change le statut", () => {
    expect(computePocketCardView(pocket({ currentAmount: 12000, targetAmount: 10000 }))).toEqual({
      percent: 100,
      status: 'objectif_atteint',
      statusLabel: 'Objectif atteint',
    });
  });

  it('sans objectif défini (targetAmount null) → réserve libre, jamais un pourcentage fabriqué', () => {
    expect(computePocketCardView(pocket({ currentAmount: 4500, targetAmount: null }))).toEqual({
      percent: 0,
      status: 'sans_objectif',
      statusLabel: 'Réserve libre',
    });
  });

  it('jamais de pourcentage négatif même si currentAmount est négatif (edge case défensif)', () => {
    const view = computePocketCardView(pocket({ currentAmount: -500, targetAmount: 10000 }));
    expect(view.percent).toBe(0);
  });
});

function sufficiency(overrides: Partial<ProvisionSufficiencyLike> = {}): ProvisionSufficiencyLike {
  return {
    currentAmount: 12000,
    steps: [
      { deadlineId: 'd1', dueDate: '2027-01-31', resteAPayer: 30000, cumulativeNeed: 30000, moisRestants: 4, gap: 18000, tauxRequis: 4500 },
    ],
    versementMensuelRecommande: 4500,
    tensionAlert: null,
    ...overrides,
  };
}

describe('§8 — computeProvisionCardView (plan financier à échéances) — recalcul dynamique', () => {
  it('le % constitué se lit contre le besoin cumulé de la PROCHAINE échéance ouverte uniquement', () => {
    const view = computeProvisionCardView(sufficiency());
    expect(view.percent).toBe(40); // 12000/30000
    expect(view.nextDueDate).toBe('2027-01-31');
    expect(view.nextAmount).toBe(30000);
    expect(view.hasOpenSteps).toBe(true);
  });

  it('aucune échéance ouverte (toutes soldées) → 100%, jamais une division par zéro', () => {
    const view = computeProvisionCardView(sufficiency({ steps: [] }));
    expect(view.percent).toBe(100);
    expect(view.hasOpenSteps).toBe(false);
  });

  it('un versement réel inférieur au prévu ne modifie jamais artificiellement le % au-delà du disponible réel', () => {
    // Scénario §8 du cahier des charges : prévu 5000, versé seulement 3000 —
    // le % doit refléter EXACTEMENT le disponible réel (jamais le prévu).
    const view = computeProvisionCardView(sufficiency({ currentAmount: 3000, steps: [{ ...sufficiency().steps[0], cumulativeNeed: 30000 }] }));
    expect(view.percent).toBe(10); // 3000/30000, jamais 5000/30000
  });

  it('un versement supérieur au prévu augmente le % en conséquence (jamais plafonné artificiellement avant 100%)', () => {
    const view = computeProvisionCardView(sufficiency({ currentAmount: 27000, steps: [{ ...sufficiency().steps[0], cumulativeNeed: 30000 }] }));
    expect(view.percent).toBe(90);
  });
});
