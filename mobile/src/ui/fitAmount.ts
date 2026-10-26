// Largeurs de glyphes en em, mesurées sur Plus Jakarta Sans (Medium à
// ExtraBold) et arrondies vers le haut : l'estimation doit surestimer, pour
// qu'un montant ajusté ne soit jamais tronqué ("42 000 D…").
const DIGIT_EM = 0.72;
const SPACE_EM = 0.25; // espace normale ou fine insécable (U+202F) de toLocaleString('fr-FR')
const UPPER_EM = 0.76;
const LOWER_EM = 0.6;
const CHECK_EM = 0.95; // ✓ (souvent rendu par une police de repli)
const SLASH_EM = 0.55;
const SAFETY = 1.06;

export function estimateTextEm(text: string): number {
  let em = 0;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') em += DIGIT_EM;
    else if (/\s/.test(ch)) em += SPACE_EM;
    else if (ch === '✓') em += CHECK_EM;
    else if (ch === '/' || ch === '-' || ch === '.' || ch === ',') em += SLASH_EM;
    else if (ch === ch.toUpperCase()) em += UPPER_EM;
    else em += LOWER_EM;
  }
  return em * SAFETY;
}

/**
 * Plus grande taille de police (pas de 0,5, plafonnée à maxFontSize) pour
 * laquelle `text` tient sur une ligne dans `availableWidth`. Pas de plancher :
 * un montant exceptionnellement long rapetisse plutôt que d'être tronqué.
 */
export function fitFontSize(text: string, availableWidth: number, maxFontSize: number): number {
  const fitting = Math.floor((availableWidth / estimateTextEm(text)) * 2) / 2;
  return Math.max(1, Math.min(maxFontSize, fitting));
}

/**
 * Texte composé de deux parties (ex. "21 000/" + "42 000 DH") : une seule
 * ligne tant qu'elle reste lisible (≥ minFontSize), sinon les deux parties
 * sur deux lignes, à une taille commune.
 */
export function fitTwoParts(
  first: string,
  second: string,
  availableWidth: number,
  maxFontSize: number,
  minFontSize: number,
): { lines: string[]; fontSize: number } {
  const single = fitFontSize(`${first}${second}`, availableWidth, maxFontSize);
  if (single >= minFontSize) return { lines: [`${first}${second}`], fontSize: single };
  const lines = [first.trimEnd(), second];
  return { lines, fontSize: Math.min(...lines.map((l) => fitFontSize(l, availableWidth, maxFontSize))) };
}

/** En dessous de cette taille, on sacrifie le ✓ plutôt que de rapetisser le montant. */
export const CHECK_MIN_FONT_SIZE = 10;

/**
 * Cellule payée : priorité montant complet > "DH" complet > ✓. Le ✓ n'est
 * gardé que s'il tient sans descendre sous CHECK_MIN_FONT_SIZE.
 */
export function fitPaidAmount(amountText: string, availableWidth: number, maxFontSize: number): { fontSize: number; showCheck: boolean } {
  const withCheck = fitFontSize(`${amountText} ✓`, availableWidth, maxFontSize);
  if (withCheck >= CHECK_MIN_FONT_SIZE) return { fontSize: withCheck, showCheck: true };
  return { fontSize: fitFontSize(amountText, availableWidth, maxFontSize), showCheck: false };
}
