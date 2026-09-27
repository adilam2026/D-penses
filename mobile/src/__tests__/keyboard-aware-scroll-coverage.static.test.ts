import fs from 'fs';
import path from 'path';

/**
 * Garde-fou de non-régression (Round 3 §1/§3 — « DERNIÈRE SÉCURISATION AVANT
 * BUILD ») : aucun formulaire important ne doit plus reposer uniquement sur
 * `ScrollView + TextInput + KeyboardAvoidingView` sans mécanisme de défilement
 * jusqu'au champ actif — KeyboardAvoidingView seul ne fait rien sur Android
 * (cf. useKeyboardAwareScroll.ts). Ce test scanne statiquement tout
 * `src/screens` : tout écran combinant un vrai `TextInput` saisissable et un
 * `ScrollView` doit importer `useKeyboardAwareScroll`, sauf exception listée
 * ci-dessous avec sa justification précise (audit Round 3 §1).
 */
function listScreenFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files = files.concat(listScreenFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.includes('__tests__')) files.push(full);
  }
  return files;
}

// Reset Finance Maison (2026-09-27) : tous les écrans métier de l'ancienne
// application ont été supprimés (archive/legacy-d-penses-2026-09-27) — liste
// repartie de zéro. household/HouseholdSetupScreen.tsx est un écran d'INFRA
// conservé tel quel (auth/foyer, hors reset métier), l'exception d'origine
// reste donc valide à l'identique.
const JUSTIFIED_EXCEPTIONS: Record<string, string> = {
  'household/HouseholdSetupScreen.tsx':
    'Un seul TextInput visible à la fois (nom OU code selon le mode), pied de page minimal (erreur, bouton, lien) — rien à faire défiler.',
};

describe('Couverture useKeyboardAwareScroll (garde-fou Round 3 §1/§3)', () => {
  const screensDir = path.join(__dirname, '..', 'screens');
  const files = listScreenFiles(screensDir);

  it('a bien trouvé des écrans à analyser', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [path.relative(screensDir, f), f] as const))(
    '%s : si ScrollView + TextInput réel, utilise useKeyboardAwareScroll (ou justification explicite)',
    (relName, file) => {
      const source = fs.readFileSync(file, 'utf8');
      const hasScrollView = /<ScrollView/.test(source);
      const hasRealTextInput = /<TextInput[\s\S]*?onChangeText/.test(source);
      if (!hasScrollView || !hasRealTextInput) return; // hors périmètre du garde-fou

      const usesHook = /useKeyboardAwareScroll/.test(source);
      const normalized = relName.split(path.sep).join('/');
      if (usesHook) return;

      expect(JUSTIFIED_EXCEPTIONS[normalized]).toBeDefined();
    },
  );

  it('ne liste aucune exception obsolète (le fichier existe toujours et n\'utilise toujours pas le hook)', () => {
    for (const rel of Object.keys(JUSTIFIED_EXCEPTIONS)) {
      const full = path.join(screensDir, rel);
      expect(fs.existsSync(full)).toBe(true);
      const source = fs.readFileSync(full, 'utf8');
      expect(source.includes('useKeyboardAwareScroll')).toBe(false);
    }
  });
});
