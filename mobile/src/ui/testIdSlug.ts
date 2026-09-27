/**
 * Convertit un libellé utilisateur en suffixe de testID stable et prévisible
 * (ex. "Test transaction" -> "test-transaction") — utilisé par la recette E2E
 * Maestro pour retrouver un élément par son contenu sans dépendre d'un id
 * généré côté serveur, jamais visible à l'écran ni ne changeant le rendu.
 */
export function testIdSlug(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
