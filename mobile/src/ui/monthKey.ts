/** "2026-11" décalé de n mois → "2027-01" (n négatif autorisé). */
export function shiftMonthKey(monthKey: string, n: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const index = year * 12 + (month - 1) + n;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Nombre de mois de `from` à `to` ("2026-10" → "2027-07" = 9). */
export function monthKeyDiff(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return ty * 12 + tm - (fy * 12 + fm);
}

export function monthKeyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}
