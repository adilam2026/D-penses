import { Injectable } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { toNumber } from '../common/ledger/ledger.util';

interface LedgerRow {
  kind: string;
  id: string;
  occurred_at: Date;
  amount: unknown;
  account_id: string;
  account_name: string;
  label: string | null;
  category_id: string | null;
  category_name: string | null;
}

// Regroupement d'affichage pour l'écran Transactions (§13) : +revenu / -paiement / transfert —
// LedgerEntry reste la seule source, purement dérivée (docs/04 §P.2) : cette table n'ajoute
// aucune donnée, elle ne fait que nommer les `kind` de la vue pour l'UI.
const DISPLAY_KIND: Record<string, string> = {
  income: 'revenu',
  payment: 'paiement',
  transfer_in: 'transfert',
  transfer_out: 'transfert',
  adjustment: 'ajustement',
};

@Injectable()
export class TransactionsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  /** Écran Transactions (§13) — LedgerEntry, purement dérivée, jamais une table source de vérité. */
  async list(userId: string, householdId: string, limit = 200) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const rows = await tx.$queryRaw<LedgerRow[]>`
        SELECT le.kind, le.id, le.occurred_at, le.amount, le.account_id,
               fa.name AS account_name, le.label, le.category_id, c.name AS category_name
        FROM ledger_entry le
        JOIN financial_account fa ON fa.id = le.account_id
        LEFT JOIN category c ON c.id = le.category_id
        WHERE le.household_id = ${householdId}
        ORDER BY le.occurred_at DESC, le.id DESC
        LIMIT ${limit}
      `;

      return rows.map((r) => ({
        kind: r.kind,
        displayKind: DISPLAY_KIND[r.kind] ?? r.kind,
        id: r.id,
        occurredAt: r.occurred_at,
        amount: toNumber(r.amount),
        accountId: r.account_id,
        accountName: r.account_name,
        label: r.label,
        categoryId: r.category_id,
        categoryName: r.category_name,
      }));
    });
  }
}
