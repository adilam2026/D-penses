/**
 * Indication d'adresse suffisamment masquée pour l'écran verrouillé :
 * « adil.taha@gmail.com » -> « a•••@g•••.com ».
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '•••';
  const dot = domain.lastIndexOf('.');
  const domainName = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0]}•••@${domainName[0] ?? ''}•••${tld}`;
}
