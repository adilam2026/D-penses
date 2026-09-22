import { buildMonthlyRecommendationCalendar } from './provision.util';

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Refonte maquette V6B §8 — calendrier mensuel de recommandation (jamais un
 * montant unique, jamais stocké : toujours recalculé à partir du disponible
 * réel et des paliers de computeProvisionSufficiency).
 */
describe('buildMonthlyRecommendationCalendar', () => {
  it("répartit le manque sur les mois calendaires jusqu'à l'échéance, dernier mois = reliquat", () => {
    // Référence : 22 septembre 2026. Échéance unique : 30 000 DH le 31 janvier 2027.
    // Disponible réel : 12 000 DH. Manque = 18 000 DH sur 4 mois (oct/nov/dec/jan).
    const calendar = buildMonthlyRecommendationCalendar(
      12000,
      [{ dueDate: utc('2027-01-31'), cumulativeNeed: 30000 }],
      utc('2026-09-22'),
    );

    expect(calendar.map((c) => c.month)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    const total = calendar.reduce((s, c) => s + c.recommendedAmount, 0);
    expect(Math.round(total * 100) / 100).toBe(18000);
    // Les 3 premiers mois portent le même montant plancher, le dernier absorbe le reliquat d'arrondi.
    expect(calendar[0].recommendedAmount).toBe(calendar[1].recommendedAmount);
    expect(calendar[1].recommendedAmount).toBe(calendar[2].recommendedAmount);
  });

  it('bascule automatiquement vers la 2e échéance après la 1re : le mois suivant repart du delta uniquement', () => {
    const calendar = buildMonthlyRecommendationCalendar(
      12000,
      [
        { dueDate: utc('2027-01-31'), cumulativeNeed: 30000 }, // 1re échéance
        { dueDate: utc('2027-04-30'), cumulativeNeed: 42000 }, // 2e échéance, delta = 12 000 sur 3 mois (fév/mar/avr)
      ],
      utc('2026-09-22'),
    );

    const secondStepMonths = calendar.filter((c) => ['2027-02', '2027-03', '2027-04'].includes(c.month));
    expect(secondStepMonths.map((c) => c.month)).toEqual(['2027-02', '2027-03', '2027-04']);
    const secondStepTotal = secondStepMonths.reduce((s, c) => s + c.recommendedAmount, 0);
    // Delta = 42000 - 30000 = 12000 (la 1re échéance est supposée financée à son terme,
    // jamais redemandée : le calendrier ne redouble pas le besoin déjà couvert).
    expect(Math.round(secondStepTotal * 100) / 100).toBe(12000);
  });

  it('un palier déjà entièrement couvert (gap = 0) produit des mois à 0, jamais négatif', () => {
    const calendar = buildMonthlyRecommendationCalendar(50000, [{ dueDate: utc('2026-12-31'), cumulativeNeed: 30000 }], utc('2026-09-22'));
    expect(calendar.every((c) => c.recommendedAmount === 0)).toBe(true);
  });

  it('une échéance dans le mois de référence (imminente) produit un unique mois avec le manque intégral', () => {
    const calendar = buildMonthlyRecommendationCalendar(1000, [{ dueDate: utc('2026-09-28'), cumulativeNeed: 4000 }], utc('2026-09-22'));
    expect(calendar).toEqual([{ month: '2026-09', recommendedAmount: 3000 }]);
  });

  it('versement réel supérieur au prévu réduit mécaniquement les mensualités suivantes', () => {
    const withLowContribution = buildMonthlyRecommendationCalendar(3000, [{ dueDate: utc('2027-01-31'), cumulativeNeed: 30000 }], utc('2026-09-22'));
    const withHigherContribution = buildMonthlyRecommendationCalendar(7000, [{ dueDate: utc('2027-01-31'), cumulativeNeed: 30000 }], utc('2026-09-22'));
    expect(withHigherContribution[0].recommendedAmount).toBeLessThan(withLowContribution[0].recommendedAmount);
  });

  it("sans aucun palier ouvert, le calendrier est vide", () => {
    expect(buildMonthlyRecommendationCalendar(0, [], utc('2026-09-22'))).toEqual([]);
  });
});
