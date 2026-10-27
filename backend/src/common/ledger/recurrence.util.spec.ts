import { RecurrenceFrequency } from '@prisma/client';
import { computeOccurrences, legacyOccurrenceDates, occupiedIndexes, occurrenceDate, StoredOccurrenceRow } from './recurrence.util';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** n premières dates d'une série (n° 0..n-1), calculées directement depuis l'ancrage. */
function firstDates(anchor: string, frequency: RecurrenceFrequency, n: number, anchorDay?: number): string[] {
  return Array.from({ length: n }, (_, k) => iso(occurrenceDate({ anchorDate: d(anchor), anchorDay, frequency }, k)));
}

describe('moteur de récurrence — jour d’origine permanent, dernier jour du mois si absent', () => {
  it('31/01/2027 → 28/02 → 31/03 → 30/04 → 31/05', () => {
    expect(firstDates('2027-01-31', 'MONTHLY', 5)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
  });

  it('31/01/2028 (bissextile) → 29/02 → 31/03', () => {
    expect(firstDates('2028-01-31', 'MONTHLY', 3)).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  it('30/01/2027 → 28/02 → 30/03', () => {
    expect(firstDates('2027-01-30', 'MONTHLY', 3)).toEqual(['2027-01-30', '2027-02-28', '2027-03-30']);
  });

  it('29/01/2027 → 28/02 → 29/03', () => {
    expect(firstDates('2027-01-29', 'MONTHLY', 3)).toEqual(['2027-01-29', '2027-02-28', '2027-03-29']);
  });

  it('29/01/2028 → 29/02 → 29/03', () => {
    expect(firstDates('2028-01-29', 'MONTHLY', 3)).toEqual(['2028-01-29', '2028-02-29', '2028-03-29']);
  });

  it('annuel 29/02/2028 → 28/02/2029 → 28/02/2030 → 28/02/2031 → 29/02/2032', () => {
    expect(firstDates('2028-02-29', 'YEARLY', 5)).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });

  it('bimestriel, trimestriel, semestriel : même règle', () => {
    expect(firstDates('2026-12-31', 'BIMONTHLY', 4)).toEqual(['2026-12-31', '2027-02-28', '2027-04-30', '2027-06-30']);
    expect(firstDates('2026-11-30', 'QUARTERLY', 4)).toEqual(['2026-11-30', '2027-02-28', '2027-05-30', '2027-08-30']);
    expect(firstDates('2026-08-31', 'SEMIANNUAL', 4)).toEqual(['2026-08-31', '2027-02-28', '2027-08-31', '2028-02-29']);
  });

  it('mensuel au 28 et avant : inchangé (même jour chaque mois)', () => {
    expect(firstDates('2027-01-28', 'MONTHLY', 3)).toEqual(['2027-01-28', '2027-02-28', '2027-03-28']);
    expect(firstDates('2026-10-10', 'MONTHLY', 4)).toEqual(['2026-10-10', '2026-11-10', '2026-12-10', '2027-01-10']);
  });

  it('passage décembre → janvier', () => {
    expect(firstDates('2026-12-31', 'MONTHLY', 3)).toEqual(['2026-12-31', '2027-01-31', '2027-02-28']);
    expect(firstDates('2026-10-31', 'MONTHLY', 4)).toEqual(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31']);
  });

  it('anchorDay prime sur le jour d’anchorDate (série du 31 repartie d’un pivot au 28/02)', () => {
    expect(firstDates('2027-02-28', 'MONTHLY', 4, 31)).toEqual(['2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
  });

  it('chaque occurrence ne dépend que de l’ancrage et de son n° (jamais de la précédente)', () => {
    const spec = { anchorDate: d('2027-01-31'), frequency: 'MONTHLY' as const };
    for (let k = 0; k < 600; k++) {
      const date = occurrenceDate(spec, k);
      const expectedMonth = (2027 * 12 + 0 + k) % 12;
      expect(date.getUTCMonth()).toBe(expectedMonth);
      const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      expect(date.getUTCDate()).toBe(Math.min(31, last));
    }
  });

  it('hebdomadaire et ponctuelle', () => {
    expect(firstDates('2026-12-28', 'WEEKLY', 3)).toEqual(['2026-12-28', '2027-01-04', '2027-01-11']);
    expect(computeOccurrences({ anchorDate: d('2027-01-31'), frequency: 'ONCE' }, d('2027-01-01'), d('2027-12-31')).map((o) => o.index)).toEqual([0]);
  });
});

describe('computeOccurrences — plages', () => {
  const spec = { anchorDate: d('2027-01-31'), frequency: 'MONTHLY' as const };

  it('renvoie (n°, date) de la plage, bornes incluses', () => {
    const occ = computeOccurrences(spec, d('2027-02-01'), d('2027-04-30'));
    expect(occ.map((o) => [o.index, iso(o.date)])).toEqual([
      [1, '2027-02-28'],
      [2, '2027-03-31'],
      [3, '2027-04-30'],
    ]);
  });

  it('plage très éloignée : n° et date exacts sans dériver (an 2126)', () => {
    const occ = computeOccurrences(spec, d('2126-02-01'), d('2126-03-31'));
    expect(occ.map((o) => [o.index, iso(o.date)])).toEqual([
      [1189, '2126-02-28'],
      [1190, '2126-03-31'],
    ]);
  });

  it('plage avant l’ancrage : rien ; même date toujours pour un même n°', () => {
    expect(computeOccurrences(spec, d('2026-01-01'), d('2026-12-31'))).toEqual([]);
    const a = computeOccurrences(spec, d('2027-01-01'), d('2028-12-31'));
    const b = computeOccurrences(spec, d('2027-06-15'), d('2027-09-01'));
    for (const o of b) expect(iso(a.find((x) => x.index === o.index)!.date)).toBe(iso(o.date));
  });
});

describe('occupiedIndexes — une occurrence logique existante n’est jamais recréée', () => {
  const rule = { id: 'r', anchorDate: d('2026-10-31'), anchorDay: 31, frequency: 'MONTHLY' as const, seriesVersion: 0 };
  const row = (o: Partial<StoredOccurrenceRow>): StoredOccurrenceRow => ({ recurrenceRuleId: 'r', occurrenceIndex: null, seriesVersion: null, expectedDate: d('2026-10-31'), ...o });

  it('n° occupé quelle que soit la date de la ligne (déplacée, modifiée)', () => {
    const occupied = occupiedIndexes(rule, [row({ occurrenceIndex: 1, seriesVersion: 0, expectedDate: d('2026-11-12') })]);
    expect([...occupied]).toEqual([1]);
  });

  it('anciennes lignes sans n° : rattachées via l’ancien calcul (01/12 = n°1) — jamais de doublon au 30/11', () => {
    expect(legacyOccurrenceDates(d('2026-10-31'), 'MONTHLY', d('2027-01-31')).map(iso)).toEqual(['2026-10-31', '2026-12-01', '2027-01-01']);
    const occupied = occupiedIndexes(rule, [row({ expectedDate: d('2026-10-31') }), row({ expectedDate: d('2026-12-01') }), row({ expectedDate: d('2027-01-01') })]);
    expect([...occupied].sort()).toEqual([0, 1, 2]);
  });

  it('autre règle ou autre version : n’occupe pas la version courante (sauf même mois après le début de version)', () => {
    const v1 = { ...rule, seriesVersion: 1, anchorDate: d('2027-02-28') };
    const occupied = occupiedIndexes(v1, [
      row({ recurrenceRuleId: 'autre', occurrenceIndex: 0, seriesVersion: 1 }),
      row({ occurrenceIndex: 3, seriesVersion: 0, expectedDate: d('2027-01-31') }), // avant la version : ignorée
      row({ occurrenceIndex: 4, seriesVersion: 0, expectedDate: d('2027-03-10') }), // même mois que le n°1 de v1
    ]);
    expect([...occupied]).toEqual([1]);
  });
});
