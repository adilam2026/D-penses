import { monthKeyDiff, monthKeyOf, shiftMonthKey } from '../monthKey';

it('décale un mois, y compris à travers les années', () => {
  expect(shiftMonthKey('2026-11', 1)).toBe('2026-12');
  expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
  expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
  expect(shiftMonthKey('2026-10', 9)).toBe('2027-07');
  expect(shiftMonthKey('2026-10', -22)).toBe('2024-12');
});

it('écart en mois entre deux périodes', () => {
  expect(monthKeyDiff('2026-10', '2027-07')).toBe(9);
  expect(monthKeyDiff('2026-10', '2026-08')).toBe(-2);
  expect(monthKeyDiff('2026-10', '2026-10')).toBe(0);
});

it('construit une clé mois', () => {
  expect(monthKeyOf(2027, 7)).toBe('2027-07');
});
