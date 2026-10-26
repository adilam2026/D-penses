import type { AccountApi } from '../api/client';

/** Libellé "Compte — Sous-compte" partagé (jamais dupliqué par écran). */
export function accountLabelFor(accounts: AccountApi[], accountId: string | null, subaccountId: string | null): string | null {
  if (!accountId) return null;
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return null;
  if (subaccountId) {
    const sub = account.subaccounts.find((s) => s.id === subaccountId);
    if (sub) return `${account.name} — ${sub.name}`;
  }
  return account.name;
}

/**
 * Libellé d'une extrémité de virement (ActionSheet d'un versement) :
 * "Compte" ou "Compte / Enveloppe", lu des vraies données de l'échéance. Si
 * un autre compte porte le même nom, la banque est ajoutée pour lever toute
 * ambiguïté ("Épargne BCP / Voyage").
 */
export function transferEndpointLabel(accounts: AccountApi[], accountId: string | null, subaccountId: string | null): string | null {
  if (!accountId) return null;
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return null;
  const homonym = accounts.some((a) => a.id !== account.id && a.name.trim().toLowerCase() === account.name.trim().toLowerCase());
  const accountName = homonym && account.bank?.trim() ? `${account.name} ${account.bank.trim()}` : account.name;
  const sub = subaccountId ? account.subaccounts.find((s) => s.id === subaccountId) : undefined;
  return sub ? `${accountName} / ${sub.name}` : accountName;
}
