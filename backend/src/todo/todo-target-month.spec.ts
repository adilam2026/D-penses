import { todoTargetMonth } from './todo.service';
import { monthKeyDiff, monthRange } from '../common/ledger/planning.util';

const at = (iso: string) => new Date(iso);

describe('todoTargetMonth — À faire raisonne en MOIS, jamais en "jour du mois courant"', () => {
  it('31/10 + 1 mois = novembre (jamais décembre), du 28 au 31', () => {
    for (const day of [28, 29, 30, 31]) {
      expect(todoTargetMonth(at(`2026-10-${day}T23:30:00Z`), 1, 1)).toBe('2026-11');
      expect(todoTargetMonth(at(`2026-10-${day}T00:30:00Z`), 0, 1)).toBe('2026-10');
      expect(todoTargetMonth(at(`2026-10-${day}T12:00:00Z`), -1, 1)).toBe('2026-09');
    }
  });

  it('passage janvier → février → mars, année non bissextile et bissextile', () => {
    for (const day of [28, 29, 30, 31]) {
      expect(todoTargetMonth(at(`2027-01-${day}T12:00:00Z`), 1, 1)).toBe('2027-02'); // 2027 : 28 jours
      expect(todoTargetMonth(at(`2027-01-${day}T12:00:00Z`), 2, 1)).toBe('2027-03');
      expect(todoTargetMonth(at(`2028-01-${day}T12:00:00Z`), 1, 1)).toBe('2028-02'); // 2028 : 29 jours
    }
    expect(todoTargetMonth(at('2027-02-28T23:30:00Z'), 1, 1)).toBe('2027-03');
    expect(todoTargetMonth(at('2028-02-29T23:30:00Z'), 1, 1)).toBe('2028-03');
  });

  it('vers le passé depuis une fin de mois : 31/03 - 1 = février, 31/05 - 1 = avril', () => {
    for (const day of [29, 30, 31]) expect(todoTargetMonth(at(`2027-03-${day}T12:00:00Z`), -1, 1)).toBe('2027-02');
    expect(todoTargetMonth(at('2027-05-31T12:00:00Z'), -1, 1)).toBe('2027-04');
    expect(todoTargetMonth(at('2027-07-31T12:00:00Z'), -1, 1)).toBe('2027-06');
  });

  it('passage décembre → janvier, dans les deux sens', () => {
    expect(todoTargetMonth(at('2026-12-31T23:30:00Z'), 1, 1)).toBe('2027-01');
    expect(todoTargetMonth(at('2027-01-01T00:30:00Z'), -1, 1)).toBe('2026-12');
    expect(todoTargetMonth(at('2027-01-31T12:00:00Z'), -1, 1)).toBe('2026-12');
  });

  it('plusieurs mois de décalage, futur et passé', () => {
    expect(todoTargetMonth(at('2026-10-31T12:00:00Z'), 4, 1)).toBe('2027-02');
    expect(todoTargetMonth(at('2026-10-31T12:00:00Z'), 16, 1)).toBe('2028-02');
    expect(todoTargetMonth(at('2026-10-31T12:00:00Z'), 30, 1)).toBe('2029-04');
    expect(todoTargetMonth(at('2026-10-31T12:00:00Z'), -8, 1)).toBe('2026-02');
    expect(todoTargetMonth(at('2026-12-31T12:00:00Z'), 13, 1)).toBe('2028-01');
    expect(todoTargetMonth(at('2027-01-31T12:00:00Z'), -13, 1)).toBe('2025-12');
  });

  it('début de mois paramétrable : décalage à partir du mois FINANCIER courant', () => {
    // Début au 28 : le 30/10 appartient à la période "novembre" (28/10 → 27/11).
    expect(todoTargetMonth(at('2026-10-30T12:00:00Z'), 0, 28)).toBe('2026-11');
    expect(todoTargetMonth(at('2026-10-30T12:00:00Z'), 1, 28)).toBe('2026-12');
    expect(todoTargetMonth(at('2026-10-27T12:00:00Z'), 1, 28)).toBe('2026-11');
    expect(todoTargetMonth(at('2027-01-31T12:00:00Z'), 1, 28)).toBe('2027-03');
  });

  it('toujours le même mois que la colonne correspondante du Planning ; passé exact (tous les jours 2026-2028, décalages -14..14)', () => {
    for (const startDay of [1, 5, 15, 16, 28]) {
      for (let t = Date.UTC(2026, 0, 1, 12); t <= Date.UTC(2028, 11, 31, 12); t += 86400000) {
        const now = new Date(t);
        const planning = monthRange(now, 15, startDay); // mois courant + 14 suivants
        for (let k = 0; k <= 14; k++) expect(todoTargetMonth(now, k, startDay)).toBe(planning[k]);
        // Vers le passé : exactement k mois avant le mois courant.
        for (let k = 1; k <= 14; k++) expect(monthKeyDiff(todoTargetMonth(now, -k, startDay), planning[0])).toBe(k);
      }
    }
  });
});
