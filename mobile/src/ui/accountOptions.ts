import type { AccountApi } from '../api/client';
import type { SelectOption } from './Select';

/**
 * Options "compte" / "compte — sous-compte" partagées pour un Select
 * compte/enveloppe (jamais dupliquées par écran — AjouterScreen, puis
 * PlanningScreen pour la source au paiement et la modification d'échéance).
 * `activeOnly` (par défaut true) exclut les sous-comptes désactivés — les
 * comptes renvoyés par `listAccounts()` sont déjà actifs par défaut.
 */
export function accountSelectOptions(accounts: AccountApi[], includeSubaccounts: boolean, activeOnly = true): SelectOption[] {
  const options: SelectOption[] = [];
  for (const a of accounts) {
    options.push({ value: `acc:${a.id}`, label: a.name });
    if (includeSubaccounts) {
      for (const s of a.subaccounts) {
        if (activeOnly && s.active === false) continue;
        options.push({ value: `sub:${s.id}`, label: `${a.name} — ${s.name}` });
      }
    }
  }
  return options;
}

export function decodeAccountOption(value: string, accounts: AccountApi[]): { accountId: string; subaccountId?: string } {
  if (value.startsWith('sub:')) {
    const subId = value.slice(4);
    const parent = accounts.find((a) => a.subaccounts.some((s) => s.id === subId));
    return { accountId: parent!.id, subaccountId: subId };
  }
  return { accountId: value.slice(4) };
}

/** Encode une paire compte+sous-compte (prévue ou réelle) dans la valeur attendue par le Select ci-dessus. */
export function encodeAccountOption(accountId: string | null, subaccountId: string | null): string | null {
  if (subaccountId) return `sub:${subaccountId}`;
  if (accountId) return `acc:${accountId}`;
  return null;
}
