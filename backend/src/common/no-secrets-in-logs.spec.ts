import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Garde-fou statique : aucun appel de journalisation (Logger Nest ou console)
 * ne doit recevoir une variable portant un secret — code personnel, ancien
 * mot de passe, code email (OTP), jeton de réinitialisation, access/refresh
 * token, ou leurs empreintes.
 */
const SECRET_IDENTIFIERS = [
  'code',
  'otp',
  'password',
  'passwordHash',
  'codeHash',
  'pin',
  'newPin',
  'currentCredential',
  'credential',
  'resetToken',
  'refreshToken',
  'accessToken',
  'token',
  'tokens',
  'DEMO_PASSWORD',
];

function listTsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listTsFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

/** Texte de chaque appel logger.x(...) / console.x(...), parenthèses équilibrées. */
function loggingCalls(source: string): string[] {
  const calls: string[] = [];
  const start = /\b(?:logger|console)\.(?:log|warn|error|debug|verbose|info)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = start.exec(source))) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
      i++;
    }
    calls.push(source.slice(match.index, i));
  }
  return calls;
}

/** Retire le texte littéral des chaînes (garde les ${...} des templates) pour ne juger que les valeurs. */
function valuesOnly(call: string): string {
  return call
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\$]|\\.|\$(?!\{))*`/g, '``')
    .replace(/`((?:[^`\\]|\\.)*)`/g, (_, body: string) => (body.match(/\$\{[^}]*\}/g) ?? []).join(' '));
}

describe('aucun secret dans les journaux (analyse statique)', () => {
  const root = path.join(__dirname, '..', '..');
  const files = [...listTsFiles(path.join(root, 'src')), ...listTsFiles(path.join(root, 'prisma'))];

  it('a trouvé des fichiers à analyser', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [path.relative(root, f), f] as const))('%s', (_rel, file) => {
    const offending = loggingCalls(fs.readFileSync(file, 'utf8')).filter((call) => {
      const values = valuesOnly(call);
      return SECRET_IDENTIFIERS.some((id) => new RegExp(`(?<![\\w.])${id}(?![\\w])`).test(values));
    });
    expect(offending).toEqual([]);
  });
});
