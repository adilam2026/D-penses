/**
 * Fixe l'horloge (Date uniquement — minuteries réelles) au 15 du mois
 * courant, 12:00 UTC, le temps d'un test dont le résultat dépend du jour du
 * mois (ex. "mois restants" arrondis selon le jour). Retourne le mois fixé
 * et un helper de date ; toujours appeler restoreClock() (finally).
 */
export function pinClockToMidMonth(): { year: number; month: number; date: (monthOffset: number, day: number) => string } {
  const real = new Date();
  const year = real.getUTCFullYear();
  const month = real.getUTCMonth();
  jest.useFakeTimers({
    now: new Date(Date.UTC(year, month, 15, 12)),
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
  });
  // Toujours depuis le 1er du mois cible, puis un jour fixe valide.
  const date = (monthOffset: number, day: number) => new Date(Date.UTC(year, month + monthOffset, day)).toISOString().slice(0, 10);
  return { year, month, date };
}

/** Fixe l'horloge (Date uniquement) à un instant précis — ex. un 31 à 23:30 UTC. */
export function pinClockAt(iso: string): void {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
  });
}

export function restoreClock(): void {
  jest.useRealTimers();
}
