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
