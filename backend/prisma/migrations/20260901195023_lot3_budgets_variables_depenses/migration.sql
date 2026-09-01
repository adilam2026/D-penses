-- CreateEnum
CREATE TYPE "ReferencePeriod" AS ENUM ('semaine', 'mois');

-- CreateTable
CREATE TABLE "variable_budget" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "reference_amount" DECIMAL(14,2) NOT NULL,
    "reference_period" "ReferencePeriod" NOT NULL,
    "week_start_day" INTEGER NOT NULL DEFAULT 1,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variable_budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_expense" (
    "id" TEXT NOT NULL,
    "variable_budget_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "spent_date" TIMESTAMP(3) NOT NULL,
    "category_id" TEXT,
    "account_id" TEXT NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adhoc_expense" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "category_id" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "spent_date" TIMESTAMP(3) NOT NULL,
    "account_id" TEXT NOT NULL,
    "recorded_by_id" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adhoc_expense_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "variable_budget" ADD CONSTRAINT "variable_budget_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable_budget" ADD CONSTRAINT "variable_budget_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_expense" ADD CONSTRAINT "budget_expense_variable_budget_id_fkey" FOREIGN KEY ("variable_budget_id") REFERENCES "variable_budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_expense" ADD CONSTRAINT "budget_expense_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_expense" ADD CONSTRAINT "budget_expense_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_expense" ADD CONSTRAINT "budget_expense_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adhoc_expense" ADD CONSTRAINT "adhoc_expense_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adhoc_expense" ADD CONSTRAINT "adhoc_expense_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adhoc_expense" ADD CONSTRAINT "adhoc_expense_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adhoc_expense" ADD CONSTRAINT "adhoc_expense_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Contraintes d'intégrité (docs/04 §P.1) — dépenses réelles toujours > 0.
-- ============================================================
ALTER TABLE "budget_expense" ADD CONSTRAINT "budget_expense_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "adhoc_expense" ADD CONSTRAINT "adhoc_expense_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "variable_budget" ADD CONSTRAINT "variable_budget_reference_amount_positive" CHECK ("reference_amount" > 0);
ALTER TABLE "variable_budget" ADD CONSTRAINT "variable_budget_week_start_day_range" CHECK ("week_start_day" BETWEEN 1 AND 7);

-- ============================================================
-- Isolation stricte par foyer — RLS Lot 3 (docs/04 §S.2)
-- ============================================================

ALTER TABLE "variable_budget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "variable_budget" FORCE ROW LEVEL SECURITY;
CREATE POLICY variable_budget_context ON "variable_budget"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

ALTER TABLE "budget_expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budget_expense" FORCE ROW LEVEL SECURITY;
CREATE POLICY budget_expense_context ON "budget_expense"
  FOR ALL
  USING ("variable_budget_id" IN (SELECT id FROM "variable_budget" WHERE "household_id" = current_setting('app.current_household_id', true)))
  WITH CHECK ("variable_budget_id" IN (SELECT id FROM "variable_budget" WHERE "household_id" = current_setting('app.current_household_id', true)));

ALTER TABLE "adhoc_expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "adhoc_expense" FORCE ROW LEVEL SECURITY;
CREATE POLICY adhoc_expense_context ON "adhoc_expense"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

-- ============================================================
-- LedgerEntry (docs/04 §P.2) — extension Lot 3 : BudgetExpense et AdHocExpense,
-- toutes deux à -amount sur le solde du compte (§15). CREATE OR REPLACE conserve
-- les colonnes existantes dans le même ordre et ajoute les deux branches en fin
-- de UNION ALL — LedgerEntry reste purement dérivée, jamais une deuxième source
-- de vérité du budget (le consommé_à_date se lit depuis budget_expense, §9).
-- ============================================================
CREATE OR REPLACE VIEW "ledger_entry" AS
  SELECT 'transfer_in'::text AS kind, id, household_id, actual_date AS occurred_at, amount, to_account_id AS account_id,
         'Transfert entrant'::text AS label, NULL::text AS category_id
    FROM "account_transfer" WHERE status = 'confirme' AND to_account_id IS NOT NULL
  UNION ALL
  SELECT 'transfer_out'::text, id, household_id, actual_date, -amount, from_account_id,
         'Transfert sortant'::text, NULL::text
    FROM "account_transfer" WHERE status = 'confirme' AND from_account_id IS NOT NULL
  UNION ALL
  SELECT 'adjustment'::text, a.id, fa.household_id, a.occurred_at, a.amount, a.account_id,
         COALESCE(a.reason, 'Ajustement')::text, NULL::text
    FROM "adjustment" a JOIN "financial_account" fa ON fa.id = a.account_id
  UNION ALL
  SELECT 'income'::text, io.id, isrc.household_id, io.actual_date, io.actual_amount, io.account_id,
         isrc.label, isrc.category_id
    FROM "income_occurrence" io JOIN "income_source" isrc ON isrc.id = io.income_source_id
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
    cp.category_id
  FROM "payment" p
    JOIN "deadline" d ON d.id = p.deadline_id
    JOIN "charge_plan" cp ON cp.id = d.charge_plan_id
  UNION ALL
  SELECT 'budget_expense'::text, be.id, vb.household_id, be.spent_date, -be.amount, be.account_id,
         COALESCE(c.name, 'Dépense budget')::text, be.category_id
  FROM "budget_expense" be
    JOIN "variable_budget" vb ON vb.id = be.variable_budget_id
    LEFT JOIN "category" c ON c.id = be.category_id
  UNION ALL
  SELECT 'adhoc_expense'::text, ae.id, ae.household_id, ae.spent_date, -ae.amount, ae.account_id,
         COALESCE(c.name, 'Dépense ponctuelle')::text, ae.category_id
  FROM "adhoc_expense" ae
    LEFT JOIN "category" c ON c.id = ae.category_id;
