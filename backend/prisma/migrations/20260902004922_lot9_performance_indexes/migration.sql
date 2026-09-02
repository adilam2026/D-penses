-- CreateIndex
CREATE INDEX "account_balance_snapshot_account_id_declared_at_idx" ON "account_balance_snapshot"("account_id", "declared_at");

-- CreateIndex
CREATE INDEX "account_transfer_household_id_idx" ON "account_transfer"("household_id");

-- CreateIndex
CREATE INDEX "account_transfer_from_account_id_idx" ON "account_transfer"("from_account_id");

-- CreateIndex
CREATE INDEX "account_transfer_to_account_id_idx" ON "account_transfer"("to_account_id");

-- CreateIndex
CREATE INDEX "account_transfer_planned_date_idx" ON "account_transfer"("planned_date");

-- CreateIndex
CREATE INDEX "adhoc_expense_household_id_idx" ON "adhoc_expense"("household_id");

-- CreateIndex
CREATE INDEX "adhoc_expense_spent_date_idx" ON "adhoc_expense"("spent_date");

-- CreateIndex
CREATE INDEX "adhoc_expense_account_id_idx" ON "adhoc_expense"("account_id");

-- CreateIndex
CREATE INDEX "adjustment_account_id_idx" ON "adjustment"("account_id");

-- CreateIndex
CREATE INDEX "budget_expense_variable_budget_id_spent_date_idx" ON "budget_expense"("variable_budget_id", "spent_date");

-- CreateIndex
CREATE INDEX "budget_expense_account_id_idx" ON "budget_expense"("account_id");

-- CreateIndex
CREATE INDEX "category_household_id_idx" ON "category"("household_id");

-- CreateIndex
CREATE INDEX "charge_plan_household_id_idx" ON "charge_plan"("household_id");

-- CreateIndex
CREATE INDEX "charge_plan_financial_plan_id_idx" ON "charge_plan"("financial_plan_id");

-- CreateIndex
CREATE INDEX "child_household_id_idx" ON "child"("household_id");

-- CreateIndex
CREATE INDEX "deadline_charge_plan_id_idx" ON "deadline"("charge_plan_id");

-- CreateIndex
CREATE INDEX "deadline_due_date_idx" ON "deadline"("due_date");

-- CreateIndex
CREATE INDEX "deadline_provision_id_idx" ON "deadline"("provision_id");

-- CreateIndex
CREATE INDEX "financial_account_household_id_idx" ON "financial_account"("household_id");

-- CreateIndex
CREATE INDEX "financial_plan_household_id_idx" ON "financial_plan"("household_id");

-- CreateIndex
CREATE INDEX "goal_household_id_idx" ON "goal"("household_id");

-- CreateIndex
CREATE INDEX "goal_contribution_goal_id_status_idx" ON "goal_contribution"("goal_id", "status");

-- CreateIndex
CREATE INDEX "goal_contribution_planned_date_idx" ON "goal_contribution"("planned_date");

-- CreateIndex
CREATE INDEX "income_occurrence_income_source_id_idx" ON "income_occurrence"("income_source_id");

-- CreateIndex
CREATE INDEX "income_occurrence_status_usual_date_idx" ON "income_occurrence"("status", "usual_date");

-- CreateIndex
CREATE INDEX "income_source_household_id_idx" ON "income_source"("household_id");

-- CreateIndex
CREATE INDEX "payment_deadline_id_idx" ON "payment"("deadline_id");

-- CreateIndex
CREATE INDEX "payment_account_id_idx" ON "payment"("account_id");

-- CreateIndex
CREATE INDEX "payment_provision_id_idx" ON "payment"("provision_id");

-- CreateIndex
CREATE INDEX "pocket_movement_savings_pocket_id_status_idx" ON "pocket_movement"("savings_pocket_id", "status");

-- CreateIndex
CREATE INDEX "pocket_movement_provision_id_status_idx" ON "pocket_movement"("provision_id", "status");

-- CreateIndex
CREATE INDEX "pocket_movement_planned_date_idx" ON "pocket_movement"("planned_date");

-- CreateIndex
CREATE INDEX "provision_household_id_idx" ON "provision"("household_id");

-- CreateIndex
CREATE INDEX "reconciliation_account_id_idx" ON "reconciliation"("account_id");

-- CreateIndex
CREATE INDEX "savings_pocket_household_id_idx" ON "savings_pocket"("household_id");

-- CreateIndex
CREATE INDEX "variable_budget_household_id_idx" ON "variable_budget"("household_id");
