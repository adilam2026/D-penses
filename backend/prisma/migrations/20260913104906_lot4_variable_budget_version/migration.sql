-- CreateTable
CREATE TABLE "variable_budget_version" (
    "id" TEXT NOT NULL,
    "variable_budget_id" TEXT NOT NULL,
    "reference_amount" DECIMAL(14,2) NOT NULL,
    "reference_period" "ReferencePeriod" NOT NULL,
    "category_id" TEXT NOT NULL,
    "category_type_id" TEXT,
    "week_start_day" INTEGER NOT NULL,
    "include_in_prudent_projection" BOOLEAN NOT NULL,
    "end_date" DATE,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variable_budget_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "variable_budget_version_variable_budget_id_valid_from_idx" ON "variable_budget_version"("variable_budget_id", "valid_from");

-- AddForeignKey
ALTER TABLE "variable_budget_version" ADD CONSTRAINT "variable_budget_version_variable_budget_id_fkey" FOREIGN KEY ("variable_budget_id") REFERENCES "variable_budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Isolation stricte par foyer — RLS Lot 4 (même pattern que budget_expense_context)
-- ============================================================

ALTER TABLE "variable_budget_version" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "variable_budget_version" FORCE ROW LEVEL SECURITY;
CREATE POLICY variable_budget_version_context ON "variable_budget_version"
  FOR ALL
  USING ("variable_budget_id" IN (SELECT id FROM "variable_budget" WHERE "household_id" = current_setting('app.current_household_id', true)))
  WITH CHECK ("variable_budget_id" IN (SELECT id FROM "variable_budget" WHERE "household_id" = current_setting('app.current_household_id', true)));
