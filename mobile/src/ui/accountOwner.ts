import type { AccountApi, AccountOwnerType, HouseholdMembershipApi } from '../api/client';
import type { SelectOption } from './Select';

/**
 * Propriétaire structuré d'un compte (lot "responsable automatique") —
 * traduit les 4 options UX fixes (Non défini/Adil/Lamiaa/Commun, jamais une
 * saisie libre) vers {ownerType, ownerMemberId}, et inversement. Partagé par
 * CreateAccountScreen et le picker de modification (AccountDetailScreen) —
 * jamais dupliqué.
 */
export const OWNER_UNDEFINED_VALUE = 'undefined';
export const OWNER_SHARED_VALUE = 'shared';

export function ownerSelectOptions(members: HouseholdMembershipApi[]): SelectOption[] {
  return [
    { value: OWNER_UNDEFINED_VALUE, label: 'Non défini' },
    ...members.map((m) => ({ value: `member:${m.id}`, label: m.user.firstName })),
    { value: OWNER_SHARED_VALUE, label: 'Commun' },
  ];
}

export function encodeOwnerOption(ownerType: AccountOwnerType, ownerMemberId: string | null): string {
  if (ownerType === 'INDIVIDUAL' && ownerMemberId) return `member:${ownerMemberId}`;
  if (ownerType === 'SHARED') return OWNER_SHARED_VALUE;
  return OWNER_UNDEFINED_VALUE;
}

export function decodeOwnerOption(value: string): { ownerType: AccountOwnerType; ownerMemberId: string | null } {
  if (value.startsWith('member:')) return { ownerType: 'INDIVIDUAL', ownerMemberId: value.slice('member:'.length) };
  if (value === OWNER_SHARED_VALUE) return { ownerType: 'SHARED', ownerMemberId: null };
  return { ownerType: 'UNDEFINED', ownerMemberId: null };
}

/** Résolution d'affichage — jamais déduite d'ownerLabel ni du nom du compte. */
export function ownerDisplayLabel(ownerType: AccountOwnerType, ownerMemberId: string | null, members: HouseholdMembershipApi[]): string | null {
  if (ownerType === 'INDIVIDUAL') {
    const member = members.find((m) => m.id === ownerMemberId);
    return member ? member.user.firstName : null;
  }
  if (ownerType === 'SHARED') return 'Commun';
  return null;
}

/**
 * Responsable PROPOSÉ par défaut (§2/§7) — depuis le propriétaire STRUCTURÉ
 * du COMPTE RÉEL à débiter (jamais une enveloppe qui n'a pas de propriétaire
 * propre, jamais déduit du nom du compte). `accountId` est toujours le
 * compte réel (sourceAccountId), que la source finale soit ce compte
 * directement ou une de ses enveloppes.
 */
export function proposedResponsibleFromAccount(accounts: AccountApi[], accountId: string | null): string | null {
  if (!accountId) return null;
  const account = accounts.find((a) => a.id === accountId);
  if (!account || account.ownerType !== 'INDIVIDUAL') return null;
  return account.ownerMemberId;
}
