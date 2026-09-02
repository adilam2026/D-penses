import { Prisma } from '@prisma/client';

/** Une valeur Decimal renvoyée par $queryRaw (ou un number/string) → number JS. */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'object' && 'toNumber' in (value as any)) return (value as any).toNumber();
  return Number(value);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
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

/**
 * Lot 9 (§26 — audit performance) : variante en LOT de getAccountBalance, pour les
 * appelants qui bouclaient sur plusieurs comptes (un aller-retour SQL par compte —
 * N+1 mesuré comme cause principale de la lenteur du simulateur de capacité
 * d'épargne, qui rappelle computeProjection jusqu'à 20 fois par requête). Lit
 * EXACTEMENT la même vue account_current_balance, une seule fois pour tous les
 * comptes demandés — aucune formule dupliquée, seule la forme de la requête change.
 * Un compte absent de la vue (aucun mouvement/snapshot) est traité comme 0, comme
 * getAccountBalance.
 */
export async function getAccountBalances(tx: Prisma.TransactionClient, accountIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (accountIds.length === 0) return map;
  const rows = await tx.$queryRaw<{ account_id: string; solde_courant: unknown }[]>`
    SELECT account_id, solde_courant FROM account_current_balance WHERE account_id = ANY(${accountIds})
  `;
  for (const row of rows) map.set(row.account_id, toNumber(row.solde_courant));
  return map;
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

/**
 * Lot 9 (§26) : variante en LOT de getDeadlineBalance — même vue deadline_with_balance,
 * un seul aller-retour SQL pour plusieurs Deadline au lieu d'un par Deadline (N+1
 * mesuré dans deadlineCandidates() du moteur de projection, la boucle la plus coûteuse
 * du simulateur de capacité d'épargne). Une Deadline absente du résultat (id inconnu)
 * n'a pas d'entrée dans la Map, comme getDeadlineBalance renvoie null pour ce cas.
 */
export async function getDeadlineBalances(tx: Prisma.TransactionClient, deadlineIds: string[]): Promise<Map<string, DeadlineBalance>> {
  const map = new Map<string, DeadlineBalance>();
  if (deadlineIds.length === 0) return map;
  const rows = await tx.$queryRaw<Array<{ id: string; amount_current: unknown; reste_a_payer: unknown }>>`
    SELECT id, amount_current, reste_a_payer FROM deadline_with_balance WHERE id = ANY(${deadlineIds})
  `;
  for (const row of rows) {
    map.set(row.id, {
      amountCurrent: row.amount_current === null ? null : toNumber(row.amount_current),
      resteAPayer: row.reste_a_payer === null ? null : toNumber(row.reste_a_payer),
    });
  }
  return map;
}
