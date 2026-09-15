import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { budgetExpenseConsumptionAmount, contextualLabel, toNumber } from '../common/ledger/ledger.util';

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
  // Lot T1 — initiateur unifié + rattachements budget/plan (colonnes 14-17 de
  // ledger_entry, cf. migration 20260913180000) : NULL explicite quand la
  // branche source n'a structurellement pas la donnée, jamais déduit.
  created_by_user_id: string | null;
  created_by_name: string | null;
  budget_id: string | null;
  financial_plan_id: string | null;
  // M7+M8 (guard-rail §4/§14) — NULL hors branche 'payment' (jamais de Plan
  // Voiture/Maison sur un budget_expense/adhoc_expense/transfert/ajustement/revenu).
  vehicle_id: string | null;
  housing_id: string | null;
}

export interface TransactionListFilters {
  limit?: number;
  /** ISO 8601 datetime — borne incluse (occurred_at >= from). */
  from?: string;
  /** ISO 8601 datetime — borne exclue (occurred_at < to), convention [from, to). */
  to?: string;
  /** Liste de kinds séparés par virgule (ex. "income,payment"), valeurs = celles de ledger_entry.kind. */
  kind?: string;
  accountId?: string;
  categoryId?: string;
  budgetId?: string;
  financialPlanId?: string;
  createdByUserId?: string;
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

  /**
   * Écran Transactions (§13) — LedgerEntry, purement dérivée, jamais une table
   * source de vérité.
   *
   * Lot T1 — filtres serveur additifs (période, kind, compte, catégorie,
   * budget, plan financier, initiateur), tous combinés en AND. Construits via
   * Prisma.sql/Prisma.join (paramétré, jamais de concaténation de chaîne) —
   * seuls les noms de colonnes sont statiques, toute valeur utilisateur passe
   * par un placeholder. Aucun changement des règles de trésorerie : ce filtre
   * ne fait que restreindre les lignes déjà retournées par la vue.
   */
  async list(userId: string, householdId: string, filters: TransactionListFilters = {}) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const limit = filters.limit && filters.limit > 0 ? filters.limit : 200;

      const conditions: Prisma.Sql[] = [Prisma.sql`le.household_id = ${householdId}`];
      if (filters.from) conditions.push(Prisma.sql`le.occurred_at >= ${new Date(filters.from)}`);
      if (filters.to) conditions.push(Prisma.sql`le.occurred_at < ${new Date(filters.to)}`);
      if (filters.kind) {
        const kinds = filters.kind.split(',').map((k) => k.trim()).filter(Boolean);
        if (kinds.length) conditions.push(Prisma.sql`le.kind IN (${Prisma.join(kinds)})`);
      }
      if (filters.accountId) conditions.push(Prisma.sql`le.account_id = ${filters.accountId}`);
      if (filters.categoryId) conditions.push(Prisma.sql`le.category_id = ${filters.categoryId}`);
      if (filters.budgetId) conditions.push(Prisma.sql`le.budget_id = ${filters.budgetId}`);
      if (filters.financialPlanId) conditions.push(Prisma.sql`le.financial_plan_id = ${filters.financialPlanId}`);
      if (filters.createdByUserId) conditions.push(Prisma.sql`le.created_by_user_id = ${filters.createdByUserId}`);

      const rows = await tx.$queryRaw<(LedgerRow & { vehicle_name: string | null; housing_name: string | null; travel_destination: string | null })[]>(Prisma.sql`
        SELECT le.kind, le.id, le.occurred_at, le.amount, le.account_id,
               fa.name AS account_name, le.label, le.category_id, c.name AS category_name,
               le.category_type_id, le.category_type_name, le.category_subtype_id, le.category_subtype_name,
               le.created_by_user_id, le.created_by_name, le.budget_id, le.financial_plan_id,
               le.vehicle_id, le.housing_id, v.name AS vehicle_name, h.name AS housing_name,
               fp.destination AS travel_destination
        FROM ledger_entry le
        JOIN financial_account fa ON fa.id = le.account_id
        LEFT JOIN category c ON c.id = le.category_id
        LEFT JOIN vehicle v ON v.id = le.vehicle_id
        LEFT JOIN housing h ON h.id = le.housing_id
        LEFT JOIN financial_plan fp ON fp.id = le.financial_plan_id AND fp.plan_type = 'travel'
        WHERE ${Prisma.join(conditions, ' AND ')}
        ORDER BY le.occurred_at DESC, le.id DESC
        LIMIT ${limit}
      `);

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
        // M7+M8 (guard-rail §4/§14) : contextualisation "Libellé · Entité" appliquée APRÈS
        // (jamais avant, pour ne pas interférer avec le pattern Type · Sous-type existant).
        label: contextualLabel(
          r.category_type_name ? (r.category_subtype_name ? `${r.category_type_name} · ${r.category_subtype_name}` : r.category_type_name) : (r.label ?? ''),
          { vehicleName: r.vehicle_name, housingName: r.housing_name, travelDestination: r.travel_destination },
        ),
        categoryId: r.category_id,
        categoryName: r.category_name,
        categoryTypeId: r.category_type_id,
        categoryTypeName: r.category_type_name,
        categorySubtypeId: r.category_subtype_id,
        categorySubtypeName: r.category_subtype_name,
        createdByUserId: r.created_by_user_id,
        createdByName: r.created_by_name,
        budgetId: r.budget_id,
        financialPlanId: r.financial_plan_id,
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
            include: {
              deadline: { include: { chargePlan: { include: { financialPlan: true, vehicle: true, housing: true } } } },
              account: true,
            },
          });
          if (!p) throw new NotFoundException('Transaction introuvable');
          const cp = p.deadline.chargePlan;
          // M7+M8 (guard-rail §4/§14) — "Libellé · Entité", jamais stocké dans cp.label.
          const contextualized = contextualLabel(cp.label, {
            vehicleName: cp.vehicle?.name,
            housingName: cp.housing?.name,
            travelDestination: cp.financialPlan?.planType === 'travel' ? cp.financialPlan.destination : undefined,
          });
          return {
            ...base,
            label: contextualized,
            amount: -toNumber(p.amount),
            date: p.paidDate,
            accountId: p.accountId,
            // R6.2 (§5 CAS B) : un paiement historique "déjà payé" sans compte connu
            // n'a débité aucun compte réel — jamais un nom de compte inventé.
            accountName: p.account?.name ?? null,
            note: p.notes ?? null,
            deadline: { id: p.deadline.id, dueDate: p.deadline.dueDate, chargePlanLabel: contextualized },
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
            // T3B — signe compte inverse de la consommation (même CASE que
            // ledger_entry) : jamais -amount brut, une correction/annulation
            // (type≠depense) doit s'afficher avec le bon signe.
            amount: -budgetExpenseConsumptionAmount(e.type, e.direction, toNumber(e.amount)),
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
