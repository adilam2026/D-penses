/** Mêmes règles que le serveur (backend/src/auth/pin.util.ts) — retour immédiat, le serveur reste juge. */
export const PIN_LENGTH = 6;

export function isTrivialPin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return false;
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  return steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1);
}
