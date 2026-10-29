import fs from 'fs';
import path from 'path';

/**
 * Garde-fou : aucun journal (console.*) dans le code qui manipule des codes,
 * mots de passe ou jetons — authentification, client API, écrans de
 * connexion/verrouillage. Un secret ne doit jamais pouvoir finir dans logcat.
 */
function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : listFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const src = path.join(__dirname, '..');
const sensitive = ['auth', 'api', path.join('screens', 'auth')].flatMap((dir) => listFiles(path.join(src, dir)));

it('a trouvé le code d’authentification à analyser', () => {
  expect(sensitive.length).toBeGreaterThan(5);
});

it.each(sensitive.map((f) => [path.relative(src, f), f] as const))('%s : aucun console.*', (_rel, file) => {
  expect(fs.readFileSync(file, 'utf8')).not.toMatch(/\bconsole\.(log|warn|error|info|debug|trace)\s*\(/);
});
