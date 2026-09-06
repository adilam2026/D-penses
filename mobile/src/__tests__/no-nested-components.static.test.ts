import fs from 'fs';
import path from 'path';

/**
 * Garde-fou de non-régression (Vague 1B §3) — le bug de perte de focus/clavier
 * fermé venait d'un composant (ItemStep) défini À L'INTÉRIEUR de son écran
 * parent : une nouvelle identité de fonction (donc de type React) était créée
 * à chaque render du parent, forçant React à démonter/remonter tout le
 * sous-arbre — d'où le TextInput qui perdait le focus après une frappe.
 *
 * Ce test scanne statiquement TOUT `src/screens` et échoue si un composant
 * (fonction ou const-arrow commençant par une majuscule) est redéclaré à
 * l'intérieur du corps d'un composant `export function` — le même
 * anti-pattern, sur n'importe quel écran, aujourd'hui ou plus tard.
 */
function listScreenFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files = files.concat(listScreenFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.tsx')) files.push(full);
  }
  return files;
}

function findNestedComponentDefs(source: string): string[] {
  const lines = source.split('\n');
  let insideExportedComponent = false;
  const offenders: string[] = [];
  for (const line of lines) {
    if (/^export function [A-Z]/.test(line)) {
      insideExportedComponent = true;
      continue;
    }
    if (insideExportedComponent) {
      if (/^[ \t]+function [A-Z][A-Za-z0-9]*\(/.test(line) || /^[ \t]+const [A-Z][A-Za-z0-9]*\s*=\s*\(/.test(line)) {
        offenders.push(line.trim());
      }
    }
  }
  return offenders;
}

describe('Aucun composant imbriqué dans un écran (garde-fou bug focus/remount)', () => {
  const screensDir = path.join(__dirname, '..', 'screens');
  const files = listScreenFiles(screensDir);

  it('a bien trouvé des écrans à analyser', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [path.relative(screensDir, f), f] as const))('%s ne définit aucun composant à l\'intérieur de son écran exporté', (_name, file) => {
    const source = fs.readFileSync(file, 'utf8');
    const offenders = findNestedComponentDefs(source);
    expect(offenders).toEqual([]);
  });
});
