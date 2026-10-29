/**
 * Code personnel : EXACTEMENT 6 chiffres, refusé s'il est manifestement
 * trivial. Volontairement court : 6 chiffres identiques et les suites
 * croissantes/décroissantes de pas 1 (123456, 654321, 012345, 987654…) —
 * pas davantage, pour qu'un code personnel reste simple à choisir.
 */
export const PIN_PATTERN = /^\d{6}$/;

export function isTrivialPin(pin: string): boolean {
  if (!PIN_PATTERN.test(pin)) return false;
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  return steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1);
}
