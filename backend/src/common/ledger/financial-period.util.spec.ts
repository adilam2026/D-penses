import {
  clampClosingDay,
  financialPeriodKeyOf,
  financialPeriodLabel,
  getFinancialPeriodBounds,
  getFinancialPeriodOf,
} from './financial-period.util';

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

describe('financial-period.util — R6.3 (points A/C/J)', () => {
  it('clôture=25 : 25/09 appartient à Septembre, 26/09 et 27/09 à Octobre', () => {
    expect(financialPeriodKeyOf(utc('2026-09-25'), 25)).toBe('2026-09');
    expect(financialPeriodKeyOf(utc('2026-09-26'), 25)).toBe('2026-10');
    expect(financialPeriodKeyOf(utc('2026-09-27'), 25)).toBe('2026-10');
  });

  it('clôture=25 : bornes de la période Septembre 2026 = 26/08/2026 → 25/09/2026', () => {
    const bounds = getFinancialPeriodBounds(2026, 8, 25); // monthIndex0=8 → septembre
    expect(bounds.start.toISOString().slice(0, 10)).toBe('2026-08-26');
    expect(bounds.end.toISOString().slice(0, 10)).toBe('2026-09-25');
    expect(financialPeriodLabel({ year: 2026, monthIndex0: 8 })).toBe('Septembre 2026');
  });

  it('clôture=31 : février clôture le 28 (ou 29 en bissextile), mars revient bien au 31 — aucune dérive', () => {
    expect(clampClosingDay(31, 2026, 1)).toBe(28); // février 2026 (non bissextile)
    expect(clampClosingDay(31, 2028, 1)).toBe(29); // février 2028 (bissextile)
    expect(clampClosingDay(31, 2026, 2)).toBe(31); // mars — jamais dégradé par le clamp de février

    expect(financialPeriodKeyOf(utc('2026-02-28'), 31)).toBe('2026-02');
    expect(financialPeriodKeyOf(utc('2026-03-01'), 31)).toBe('2026-03');
    expect(financialPeriodKeyOf(utc('2026-03-31'), 31)).toBe('2026-03');
    expect(financialPeriodKeyOf(utc('2026-04-01'), 31)).toBe('2026-04');

    const marchBounds = getFinancialPeriodBounds(2026, 2, 31);
    expect(marchBounds.start.toISOString().slice(0, 10)).toBe('2026-03-01');
    expect(marchBounds.end.toISOString().slice(0, 10)).toBe('2026-03-31');
  });

  it('clôture=31 (défaut) reproduit exactement le découpage par mois civil, rétrocompatible', () => {
    for (let m = 0; m < 12; m += 1) {
      const bounds = getFinancialPeriodBounds(2026, m, 31);
      expect(bounds.start.getUTCDate()).toBe(1);
      expect(bounds.start.getUTCMonth()).toBe(m);
      expect(bounds.end.getUTCMonth()).toBe(m);
    }
  });

  it('ne modifie jamais la date réelle passée en entrée', () => {
    const original = utc('2026-09-27');
    const copy = new Date(original.getTime());
    getFinancialPeriodOf(original, 25);
    expect(original.getTime()).toBe(copy.getTime());
  });
});
