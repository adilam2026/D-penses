import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { toNumber } from '../common/ledger/ledger.util';

const ORIGIN_LABEL: Record<string, string> = {
  income: 'Revenu confirmé',
  payment: "Paiement d'une échéance",
  transfer_in: 'Transfert entrant',
  transfer_out: 'Transfert sortant',
  adjustment: 'Ajustement de rapprochement',
  budget_expense: 'Dépense sur budget variable',
  adhoc_expense: 'Dépense ponctuelle',
};

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
  category_type_id: string | null;
  category_type_name: string | null;
  category_subtype_id: string | null;
  category_subtype_name: string | null;
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
  budget_expense: 'dépense',
  adhoc_expense: 'dépense',
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
               fa.name AS account_name, le.label, le.category_id, c.name AS category_name,
               le.category_type_id, le.category_type_name, le.category_subtype_id, le.category_subtype_name
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
        // Vague 2 §20 : "Type · Sous-type" quand un type est renseigné (ex. "Courses · Viande"),
        // sinon le label existant (catégorie/plan) est conservé tel quel — jamais de régression
        // pour les lignes sans type (revenus, paiements, transferts, anciennes dépenses).
        label: r.category_type_name
          ? r.category_subtype_name
            ? `${r.category_type_name} · ${r.category_subtype_name}`
            : r.category_type_name
          : r.label,
        categoryId: r.category_id,
        categoryName: r.category_name,
        categoryTypeId: r.category_type_id,
        categoryTypeName: r.category_type_name,
        categorySubtypeId: r.category_subtype_id,
        categorySubtypeName: r.category_subtype_name,
      }));
    });
  }

  /**
   * Détail enrichi d'une ligne de transaction (§5) — jamais un second calcul :
   * lit directement l'entité réelle (kind+id identifient la ligne sans ambiguïté,
   * cf. ledger_entry) pour exposer ce que LedgerEntry n'expose pas (note, échéance
   * liée, plan financier, enveloppe, contrepartie de transfert).
   */
  async detail(userId: string, householdId: string, kind: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const base = { kind, displayKind: DISPLAY_KIND[kind] ?? kind, id, origin: ORIGIN_LABEL[kind] ?? kind };

      switch (kind) {
        case 'payment': {
          const p = await tx.payment.findFirst({
            where: { id, deadline: { chargePlan: { householdId } } },
            include: { deadline: { include: { chargePlan: { include: { financialPlan: true } } } }, account: true },
          });
          if (!p) throw new NotFoundException('Transaction introuvable');
          const cp = p.deadline.chargePlan;
          return {
            ...base,
            label: cp.label,
            amount: -toNumber(p.amount),
            date: p.paidDate,
            accountId: p.accountId,
            accountName: p.account.name,
            note: p.notes ?? null,
            deadline: { id: p.deadline.id, dueDate: p.deadline.dueDate, chargePlanLabel: cp.label },
            financialPlan: cp.financialPlan ? { id: cp.financialPlan.id, label: cp.financialPlan.label } : null,
            provisionId: p.provisionId,
          };
        }
        case 'income': {
          const o = await tx.incomeOccurrence.findFirst({
            where: { id, incomeSource: { householdId } },
            include: { incomeSource: true, account: true },
          });
          if (!o || o.status !== 'recu' || !o.account) throw new NotFoundException('Transaction introuvable');
          return {
            ...base,
            label: o.incomeSource.label,
            amount: toNumber(o.actualAmount),
            date: o.actualDate,
            accountId: o.accountId,
            accountName: o.account.name,
            note: null,
            deadline: null,
            financialPlan: null,
            provisionId: null,
          };
        }
        case 'adhoc_expense': {
          const e = await tx.adHocExpense.findFirst({
            where: { id, householdId },
            include: { account: true, category: true, categoryType: true, categorySubtype: true },
          });
          if (!e) throw new NotFoundException('Transaction introuvable');
          return {
            ...base,
            label: e.categoryType ? (e.categorySubtype ? `${e.categoryType.name} · ${e.categorySubtype.name}` : e.categoryType.name) : (e.category?.name ?? 'Dépense ponctuelle'),
            amount: -toNumber(e.amount),
            date: e.spentDate,
            accountId: e.accountId,
            accountName: e.account.name,
            note: e.notes ?? null,
            deadline: null,
            financialPlan: null,
            provisionId: null,
          };
        }
        case 'budget_expense': {
          const e = await tx.budgetExpense.findFirst({
            where: { id, variableBudget: { householdId } },
            include: { account: true, category: true, categoryType: true, categorySubtype: true },
          });
          if (!e) throw new NotFoundException('Transaction introuvable');
          return {
            ...base,
            label: e.categoryType ? (e.categorySubtype ? `${e.categoryType.name} · ${e.categorySubtype.name}` : e.categoryType.name) : (e.category?.name ?? 'Dépense budget'),
            amount: -toNumber(e.amount),
            date: e.spentDate,
            accountId: e.accountId,
            accountName: e.account.name,
            note: e.notes ?? null,
            deadline: null,
            financialPlan: null,
            provisionId: null,
          };
        }
        case 'transfer_in':
        case 'transfer_out': {
          const t = await tx.accountTransfer.findFirst({
            where: { id, householdId },
            include: { fromAccount: true, toAccount: true },
          });
          if (!t || t.status !== 'confirme') throw new NotFoundException('Transaction introuvable');
          const isIn = kind === 'transfer_in';
          const account = isIn ? t.toAccount : t.fromAccount;
          const counterpart = isIn ? t.fromAccount : t.toAccount;
          if (!account) throw new NotFoundException('Transaction introuvable');
          return {
            ...base,
            label: isIn ? 'Transfert entrant' : 'Transfert sortant',
            amount: isIn ? toNumber(t.amount) : -toNumber(t.amount),
            date: t.actualDate ?? t.plannedDate,
            accountId: account.id,
            accountName: account.name,
            note: null,
            deadline: null,
            financialPlan: null,
            provisionId: null,
            transferCounterpart: counterpart ? { accountId: counterpart.id, accountName: counterpart.name } : null,
          };
        }
        case 'adjustment': {
          const a = await tx.adjustment.findFirst({ where: { id, account: { householdId } }, include: { account: true } });
          if (!a) throw new NotFoundException('Transaction introuvable');
          return {
            ...base,
            label: a.reason ?? 'Ajustement',
            amount: toNumber(a.amount),
            date: a.occurredAt,
            accountId: a.accountId,
            accountName: a.account.name,
            note: null,
            deadline: null,
            financialPlan: null,
            provisionId: null,
          };
        }
        default:
          throw new BadRequestException(`Type de transaction inconnu : ${kind}`);
      }
    });
  }
}
