import { Prisma } from '@prisma/client';

/** Une valeur Decimal renvoyée par $queryRaw (ou un number/string) → number JS. */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'object' && 'toNumber' in (value as any)) return (value as any).toNumber();
  return Number(value);
}

/**
 * solde_courant (RG-080) — source de vérité unique, lue depuis la vue
 * account_current_balance (jamais recalculée à la main dans un service).
 */
export async function getAccountBalance(tx: Prisma.TransactionClient, accountId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ solde_courant: unknown }[]>`
    SELECT solde_courant FROM account_current_balance WHERE account_id = ${accountId}
  `;
  return rows.length ? toNumber(rows[0].solde_courant) : 0;
}

export interface DeadlineBalance {
  amountCurrent: number | null;
  resteAPayer: number | null;
}

/**
 * reste_a_payer (RG-016) — source de vérité unique, lue depuis la vue
 * deadline_with_balance. Ne jamais recopier la logique de somme des Payment
 * signés (RG-015) dans un autre service : toujours passer par cette fonction.
 */
export async function getDeadlineBalance(tx: Prisma.TransactionClient, deadlineId: string): Promise<DeadlineBalance | null> {
  const rows = await tx.$queryRaw<Array<{ amount_current: unknown; reste_a_payer: unknown }>>`
    SELECT amount_current, reste_a_payer FROM deadline_with_balance WHERE id = ${deadlineId}
  `;
  if (!rows.length) return null;
  const row = rows[0];
  return {
    amountCurrent: row.amount_current === null ? null : toNumber(row.amount_current),
    resteAPayer: row.reste_a_payer === null ? null : toNumber(row.reste_a_payer),
  };
}
