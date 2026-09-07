import { occurrenceDatesInRange } from './recurrence.util';

function d(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, day));
}

function iso(dates: Date[]): string[] {
  return dates.map((x) => x.toISOString().slice(0, 10));
}

describe('recurrence.util — occurrenceDatesInRange', () => {
  it('mensuel, ancre jour 15 (aucun cas limite) — un par mois', () => {
    const dates = occurrenceDatesInRange('mensuel', d(2026, 1, 15), d(2026, 1, 15), d(2026, 4, 30));
    expect(iso(dates)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
  });

  it('mensuel, ancre jour 28 — reste au 28 tous les mois, y compris février', () => {
    const dates = occurrenceDatesInRange('mensuel', d(2026, 1, 28), d(2026, 1, 28), d(2026, 3, 31));
    expect(iso(dates)).toEqual(['2026-01-28', '2026-02-28', '2026-03-28']);
  });

  it('mensuel, ancre jour 29 — clampé au 28 en février non bissextile, revient au 29 en mars', () => {
    const dates = occurrenceDatesInRange('mensuel', d(2026, 1, 29), d(2026, 1, 29), d(2026, 3, 31));
    expect(iso(dates)).toEqual(['2026-01-29', '2026-02-28', '2026-03-29']);
  });

  it('mensuel, ancre jour 30 — clampé au 28/29 en février, 30 les autres mois (avril = 30 jours, jamais 31)', () => {
    const dates = occurrenceDatesInRange('mensuel', d(2026, 1, 30), d(2026, 1, 30), d(2026, 4, 30));
    expect(iso(dates)).toEqual(['2026-01-30', '2026-02-28', '2026-03-30', '2026-04-30']);
  });

  it('mensuel, ancre jour 31 — jan 31, fév 28, mars 31, avril 30, mai 31 (RG verrouillée avec l\'utilisateur)', () => {
    const dates = occurrenceDatesInRange('mensuel', d(2026, 1, 31), d(2026, 1, 31), d(2026, 5, 31));
    expect(iso(dates)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('mensuel, ancre jour 31, année bissextile — février donne le 29', () => {
    // 2028 est bissextile.
    const dates = occurrenceDatesInRange('mensuel', d(2028, 1, 31), d(2028, 1, 31), d(2028, 2, 29));
    expect(iso(dates)).toEqual(['2028-01-31', '2028-02-29']);
  });

  it("aucune dérive cumulative : le clampage de février n'affecte jamais mars/avril/mai (recalcul indépendant depuis l'ancre)", () => {
    const dates = occurrenceDatesInRange('mensuel', d(2026, 1, 31), d(2026, 1, 31), d(2026, 6, 30));
    // Si le calcul repartait du résultat clampé de février (28) au lieu de l'ancre (31),
    // mars donnerait 28 au lieu de 31 — ce test échouerait.
    expect(iso(dates)).toContain('2026-03-31');
    expect(iso(dates)).toContain('2026-05-31');
  });

  it('hebdomadaire — un tous les 7 jours', () => {
    const dates = occurrenceDatesInRange('hebdomadaire', d(2026, 9, 7), d(2026, 9, 7), d(2026, 9, 28));
    expect(iso(dates)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
  });

  it('trimestriel — tous les 3 mois, même règle de clampage', () => {
    const dates = occurrenceDatesInRange('trimestriel', d(2026, 1, 31), d(2026, 1, 31), d(2026, 10, 31));
    expect(iso(dates)).toEqual(['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31']);
  });

  it('semestriel — tous les 6 mois', () => {
    const dates = occurrenceDatesInRange('semestriel', d(2026, 1, 31), d(2026, 1, 31), d(2027, 2, 28));
    expect(iso(dates)).toEqual(['2026-01-31', '2026-07-31', '2027-01-31']);
  });

  it('annuel — même jour/mois chaque année, clampé pour un 29 février ancré sur année bissextile', () => {
    const dates = occurrenceDatesInRange('annuel', d(2028, 2, 29), d(2028, 2, 29), d(2031, 3, 1));
    expect(iso(dates)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28']);
  });

  it('ponctuel — jamais de génération automatique', () => {
    const dates = occurrenceDatesInRange('ponctuel', d(2026, 1, 15), d(2026, 1, 15), d(2027, 1, 15));
    expect(dates).toEqual([]);
  });

  it('rangeStart postérieur à l\'ancre — reprend correctement au bon endroit sans balayage lent', () => {
    const dates = occurrenceDatesInRange('mensuel', d(2020, 1, 15), d(2026, 1, 1), d(2026, 3, 31));
    expect(iso(dates)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
  });

  it('plafond de sécurité — horizon très long borné à MAX_GENERATED_OCCURRENCES (320, Round 4 §3)', () => {
    const dates = occurrenceDatesInRange('hebdomadaire', d(2026, 1, 1), d(2026, 1, 1), d(2036, 1, 1));
    expect(dates.length).toBeLessThanOrEqual(320);
    expect(dates.length).toBeGreaterThan(60); // le plafond relevé doit réellement avoir un effet, pas rester à l'ancienne valeur
  });

  it('récurrence hebdomadaire génère bien au-delà de 60 occurrences sur un horizon de 60 mois (Round 4 §3/§19 Q)', () => {
    const dates = occurrenceDatesInRange('hebdomadaire', d(2026, 1, 1), d(2026, 1, 1), d(2030, 12, 31));
    // 60 mois ≈ 261 semaines : l'ancien plafond (60) aurait tronqué silencieusement la
    // récurrence dès le 14e mois environ — ce test échoue si le plafond régresse.
    expect(dates.length).toBeGreaterThan(250);
  });
});
