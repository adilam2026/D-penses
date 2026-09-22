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
