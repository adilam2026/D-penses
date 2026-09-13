-- T3B — BudgetExpense devient signable comme Payment (correction/annulation
-- par contre-écriture, jamais une réécriture de la ligne originale ni un
-- Adjustment — un Adjustment est scopé accountId, il ne touche jamais la
-- consommation du budget, cf. analyse T3B).
--
-- amount reste strictement positif (CHECK budget_expense_amount_positive déjà
-- existant, inchangé) : le signe réel vient de type/direction, même patron
-- exact que Payment.type/Payment.direction (reste_a_payer).
--
-- source_budget_expense_id (jamais une simple note texte) pointe vers la
-- dépense originale pour toute ligne de correction (type=ajustement) ou
-- d'annulation (type=remboursement) — auditabilité et garde-fou anti-double-
-- annulation (ExpensesService.reverseBudget).
CREATE TYPE "BudgetExpenseType" AS ENUM ('depense', 'remboursement', 'ajustement');
CREATE TYPE "BudgetExpenseDirection" AS ENUM ('augmente_depense', 'diminue_depense');

ALTER TABLE "budget_expense" ADD COLUMN     "direction" "BudgetExpenseDirection",
ADD COLUMN     "source_budget_expense_id" TEXT,
ADD COLUMN     "type" "BudgetExpenseType" NOT NULL DEFAULT 'depense';

-- direction n'a de sens que pour un ajustement (même contrainte que
-- payment_direction_requires_adjustment) — vérifié aussi côté service.
ALTER TABLE "budget_expense" ADD CONSTRAINT "budget_expense_direction_requires_adjustment" CHECK ("direction" IS NULL OR "type" = 'ajustement');

CREATE INDEX "budget_expense_source_budget_expense_id_idx" ON "budget_expense"("source_budget_expense_id");

-- ON DELETE SET NULL (défaut Prisma pour une relation optionnelle) : aucun
-- impact pratique — budget_expense n'est jamais supprimée ligne par ligne
-- (seul households.service.ts la cascade en bloc via variable_budget.delete,
-- qui supprime alors l'originale ET ses contre-écritures ensemble).
ALTER TABLE "budget_expense" ADD CONSTRAINT "budget_expense_source_budget_expense_id_fkey" FOREIGN KEY ("source_budget_expense_id") REFERENCES "budget_expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ledger_entry — SEULE la branche budget_expense change (CASE type/direction,
-- même formule que la branche payment), les 16 autres colonnes et les 5 autres
-- branches restent identiques à la migration lot33 (aucune régression
-- possible : mêmes noms/ordre/types de colonnes, CREATE OR REPLACE VIEW).
CREATE OR REPLACE VIEW "ledger_entry" AS
  SELECT 'transfer_in'::text AS kind, at.id, at.household_id, at.actual_date AS occurred_at, at.amount, at.to_account_id AS account_id,
         'Transfert entrant'::text AS label, NULL::text AS category_id,
         NULL::text AS category_type_id, NULL::text AS category_type_name,
         NULL::text AS category_subtype_id, NULL::text AS category_subtype_name,
         false AS excluded_from_balance,
         at.confirmed_by_id AS created_by_user_id,
         NULLIF(concat_ws(' ', u.first_name, u.last_name), '') AS created_by_name,
         NULL::text AS budget_id,
         NULL::text AS financial_plan_id
    FROM "account_transfer" at
    LEFT JOIN "user" u ON u.id = at.confirmed_by_id
    WHERE at.status = 'confirme' AND at.to_account_id IS NOT NULL
  UNION ALL
  SELECT 'transfer_out'::text, at.id, at.household_id, at.actual_date, -at.amount, at.from_account_id,
         'Transfert sortant'::text, NULL::text,
         NULL::text, NULL::text, NULL::text, NULL::text,
         false,
         at.confirmed_by_id,
         NULLIF(concat_ws(' ', u.first_name, u.last_name), ''),
         NULL::text,
         NULL::text
    FROM "account_transfer" at
    LEFT JOIN "user" u ON u.id = at.confirmed_by_id
    WHERE at.status = 'confirme' AND at.from_account_id IS NOT NULL
  UNION ALL
  SELECT 'adjustment'::text, a.id, fa.household_id, a.occurred_at, a.amount, a.account_id,
         COALESCE(a.reason, 'Ajustement')::text, NULL::text,
         NULL::text, NULL::text, NULL::text, NULL::text,
         false,
         a.created_by_id,
         NULLIF(concat_ws(' ', u.first_name, u.last_name), ''),
         NULL::text,
         NULL::text
    FROM "adjustment" a
    JOIN "financial_account" fa ON fa.id = a.account_id
    LEFT JOIN "user" u ON u.id = a.created_by_id
  UNION ALL
  SELECT 'income'::text, io.id, isrc.household_id, io.actual_date, io.actual_amount, io.account_id,
         isrc.label, isrc.category_id,
         NULL::text, NULL::text, NULL::text, NULL::text,
         false,
         io.confirmed_by_user_id,
         NULLIF(concat_ws(' ', u.first_name, u.last_name), ''),
         NULL::text,
         NULL::text
    FROM "income_occurrence" io
    JOIN "income_source" isrc ON isrc.id = io.income_source_id
    LEFT JOIN "user" u ON u.id = io.confirmed_by_user_id
    WHERE io.status = 'recu'
  UNION ALL
  SELECT 'payment'::text, p.id, cp.household_id, p.paid_date,
    CASE p.type
      WHEN 'paiement' THEN -p.amount          -- sortie du compte payeur (correction V2.1)
      WHEN 'remboursement' THEN p.amount      -- entrée sur le compte receveur
      WHEN 'ajustement' THEN CASE p.direction WHEN 'augmente_paye' THEN -p.amount ELSE p.amount END
    END,
    p.account_id,
    cp.label,
    cp.category_id,
    NULL::text, NULL::text, NULL::text, NULL::text,
    p.is_historical_import,
    p.recorded_by_id,
    NULLIF(concat_ws(' ', u.first_name, u.last_name), ''),
    NULL::text,
    cp.financial_plan_id
  FROM "payment" p
    JOIN "deadline" d ON d.id = p.deadline_id
    JOIN "charge_plan" cp ON cp.id = d.charge_plan_id
    LEFT JOIN "user" u ON u.id = p.recorded_by_id
  UNION ALL
  -- T3B : même formule signée que la branche payment ci-dessus — depense =
  -- sortie (-amount), remboursement = entrée (+amount), ajustement selon
  -- direction. amount reste positif en base (CHECK), jamais négatif.
  SELECT 'budget_expense'::text, be.id, vb.household_id, be.spent_date,
    CASE be.type
      WHEN 'depense' THEN -be.amount
      WHEN 'remboursement' THEN be.amount
      WHEN 'ajustement' THEN CASE be.direction WHEN 'augmente_depense' THEN -be.amount ELSE be.amount END
    END,
    be.account_id,
         COALESCE(c.name, 'Dépense budget')::text, be.category_id,
         be.category_type_id, ct.name, be.category_subtype_id, cs.name,
         false,
         be.recorded_by_id,
         NULLIF(concat_ws(' ', u.first_name, u.last_name), ''),
         be.variable_budget_id,
         NULL::text
  FROM "budget_expense" be
    JOIN "variable_budget" vb ON vb.id = be.variable_budget_id
    LEFT JOIN "category" c ON c.id = be.category_id
    LEFT JOIN "category_type" ct ON ct.id = be.category_type_id
    LEFT JOIN "category_subtype" cs ON cs.id = be.category_subtype_id
    LEFT JOIN "user" u ON u.id = be.recorded_by_id
  UNION ALL
  SELECT 'adhoc_expense'::text, ae.id, ae.household_id, ae.spent_date, -ae.amount, ae.account_id,
         COALESCE(c.name, 'Dépense ponctuelle')::text, ae.category_id,
         ae.category_type_id, ct.name, ae.category_subtype_id, cs.name,
         false,
         ae.recorded_by_id,
         NULLIF(concat_ws(' ', u.first_name, u.last_name), ''),
         NULL::text,
         NULL::text
  FROM "adhoc_expense" ae
    LEFT JOIN "category" c ON c.id = ae.category_id
    LEFT JOIN "category_type" ct ON ct.id = ae.category_type_id
    LEFT JOIN "category_subtype" cs ON cs.id = ae.category_subtype_id
    LEFT JOIN "user" u ON u.id = ae.recorded_by_id;
