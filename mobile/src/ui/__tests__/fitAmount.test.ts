import { CHECK_MIN_FONT_SIZE, estimateTextEm, fitFontSize, fitPaidAmount, fitTwoParts } from '../fitAmount';
import { formatDh } from '../formatMoney';

// Largeur d'une colonne mois du Planning : (écran - 2×30 - 4) / 4.4.
const COLUMN_360 = (360 - 60 - 4) / 4.4;
const COLUMN_390 = (390 - 60 - 4) / 4.4;
const CHIP_INSET = 12;

const VALUES: [number, number][] = [
  // [montant, taille minimale acceptable sur un écran de 360 dp]
  [600, 11],
  [9000, 10.5],
  [42000, 9.5],
  [100000, 8.5],
  [1000000, 7],
];

describe.each([
  ['360 dp', COLUMN_360],
  ['390 dp', COLUMN_390],
])('montants Planning sur un écran de %s', (_label, column) => {
  it.each(VALUES)('%d : montant complet avec "DH", jamais tronqué, taille raisonnable', (amount, minFont) => {
    const text = formatDh(amount);
    expect(text.endsWith(' DH')).toBe(true);
    for (const avail of [column - 4, column - CHIP_INSET]) {
      const size = fitFontSize(text, avail, 11);
      expect(estimateTextEm(text) * size).toBeLessThanOrEqual(avail);
      expect(size).toBeLessThanOrEqual(11);
      expect(size).toBeGreaterThanOrEqual(minFont - 1);
    }
  });

  it('montant payé : le ✓ est sacrifié avant de rapetisser le montant', () => {
    for (const [amount] of VALUES) {
      const text = formatDh(amount);
      const { fontSize, showCheck } = fitPaidAmount(text, column - CHIP_INSET, 11);
      const shown = showCheck ? `${text} ✓` : text;
      expect(estimateTextEm(shown) * fontSize).toBeLessThanOrEqual(column - CHIP_INSET);
      if (showCheck) expect(fontSize).toBeGreaterThanOrEqual(CHECK_MIN_FONT_SIZE);
      else expect(fitFontSize(`${text} ✓`, column - CHIP_INSET, 11)).toBeLessThan(CHECK_MIN_FONT_SIZE);
    }
  });
});

it('petits montants payés : le ✓ reste affiché', () => {
  expect(fitPaidAmount(formatDh(600), COLUMN_390 - CHIP_INSET, 11).showCheck).toBe(true);
});

it("aucune taille plancher : un montant exceptionnel rapetisse au lieu d'être coupé", () => {
  const text = formatDh(123456789);
  const size = fitFontSize(text, COLUMN_360 - 4, 11);
  expect(estimateTextEm(text) * size).toBeLessThanOrEqual(COLUMN_360 - 4);
  expect(size).toBeGreaterThan(0);
});

it('case mixte : passe sur deux lignes lisibles plutôt que de descendre sous le minimum', () => {
  const avail = COLUMN_360 - 8;
  const short = fitTwoParts('300/', formatDh(600), avail, 9.5, 8);
  expect(short.lines).toEqual([`300/${formatDh(600)}`]);
  const long = fitTwoParts(`${(21000).toLocaleString('fr-FR')}/`, formatDh(42000), avail, 9.5, 8);
  expect(long.lines).toEqual([`${(21000).toLocaleString('fr-FR')}/`, formatDh(42000)]);
  expect(long.fontSize).toBeGreaterThanOrEqual(8);
  for (const line of long.lines) expect(estimateTextEm(line) * long.fontSize).toBeLessThanOrEqual(avail);
});
