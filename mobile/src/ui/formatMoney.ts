/** Refonte maquette V6B — formatage monétaire/date partagé par les nouveaux écrans. */
export function formatDh(n: number): string {
  return `${Math.round(n).toLocaleString('fr-FR')} DH`;
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

export function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** "2026-10" → "Octobre 2026" (calendrier mensuel des plans financiers, Planning). */
export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, 1));
  const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
