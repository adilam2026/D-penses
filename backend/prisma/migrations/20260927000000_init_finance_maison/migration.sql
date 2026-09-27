-- CreateEnum
CREATE TYPE "HouseholdRole" AS ENUM ('admin', 'member', 'read_only');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('COURANT', 'EPARGNE', 'ESPECES', 'AUTRE');

-- CreateEnum
CREATE TYPE "OperationKind" AS ENUM ('EXPENSE', 'INCOME', 'TRANSFER', 'SAVINGS_CONTRIBUTION', 'MEDICAL_REIMBURSEMENT', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "PlannedOperationKind" AS ENUM ('EXPENSE', 'INCOME', 'SAVINGS_CONTRIBUTION');

-- CreateEnum
CREATE TYPE "FinancedFrom" AS ENUM ('DIRECT', 'SUBACCOUNT');

-- CreateEnum
CREATE TYPE "BudgetImpact" AS ENUM ('NORMAL', 'ALREADY_FUNDED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "PlannedOperationStatus" AS ENUM ('PENDING', 'REALIZED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY', 'ONCE');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "color" TEXT,
    "email_verified_at" TIMESTAMP(3),
    "active_household_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_membership" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "HouseholdRole" NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_invite" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "role" "HouseholdRole" NOT NULL DEFAULT 'admin',
    "created_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "used_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_otp" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_otp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bank" TEXT,
    "type" "AccountType" NOT NULL DEFAULT 'COURANT',
    "owner_member_id" TEXT,
    "owner_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subaccount" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subaccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_default_fallback" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurrence_rule" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "anchor_date" DATE NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurrence_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_plan" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_plan_item" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "financial_plan_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_plan_deadline" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "due_date" DATE NOT NULL,

    CONSTRAINT "financial_plan_deadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "account_id" TEXT,
    "subaccount_id" TEXT,
    "target_amount" DECIMAL(14,2) NOT NULL,
    "target_date" DATE,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_operation" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "kind" "OperationKind" NOT NULL,
    "label" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "category_id" TEXT,
    "source_account_id" TEXT,
    "source_subaccount_id" TEXT,
    "destination_account_id" TEXT,
    "destination_subaccount_id" TEXT,
    "financed_from" "FinancedFrom",
    "budget_impact" "BudgetImpact" NOT NULL DEFAULT 'NORMAL',
    "reversal_of_operation_id" TEXT,
    "reversal_reason" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entry" (
    "id" TEXT NOT NULL,
    "financial_operation_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "subaccount_id" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "affects_account_balance" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planned_operation" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "kind" "PlannedOperationKind" NOT NULL,
    "recurrence_rule_id" TEXT,
    "category_id" TEXT,
    "financial_plan_item_id" TEXT,
    "financial_plan_deadline_id" TEXT,
    "source_account_id" TEXT,
    "source_subaccount_id" TEXT,
    "destination_account_id" TEXT,
    "destination_subaccount_id" TEXT,
    "expected_amount" DECIMAL(14,2) NOT NULL,
    "expected_date" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "status" "PlannedOperationStatus" NOT NULL DEFAULT 'PENDING',
    "realized_operation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planned_operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_claim" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "source_operation_id" TEXT NOT NULL,
    "subaccount_id" TEXT,
    "label" TEXT NOT NULL,
    "amount_engaged" DECIMAL(14,2) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medical_claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_reimbursement" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "operation_id" TEXT NOT NULL,
    "allocation_subaccount_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medical_reimbursement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "household_membership_household_id_user_id_key" ON "household_membership"("household_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "household_invite_code_key" ON "household_invite"("code");

-- CreateIndex
CREATE INDEX "email_otp_user_id_idx" ON "email_otp"("user_id");

-- CreateIndex
CREATE INDEX "account_household_id_idx" ON "account"("household_id");

-- CreateIndex
CREATE INDEX "subaccount_account_id_idx" ON "subaccount"("account_id");

-- CreateIndex
CREATE INDEX "subaccount_household_id_idx" ON "subaccount"("household_id");

-- CreateIndex
CREATE INDEX "category_household_id_idx" ON "category"("household_id");

-- CreateIndex
CREATE INDEX "recurrence_rule_household_id_idx" ON "recurrence_rule"("household_id");

-- CreateIndex
CREATE INDEX "financial_plan_household_id_idx" ON "financial_plan"("household_id");

-- CreateIndex
CREATE INDEX "financial_plan_item_plan_id_idx" ON "financial_plan_item"("plan_id");

-- CreateIndex
CREATE INDEX "financial_plan_deadline_plan_id_idx" ON "financial_plan_deadline"("plan_id");

-- CreateIndex
CREATE INDEX "goal_household_id_idx" ON "goal"("household_id");

-- CreateIndex
CREATE INDEX "financial_operation_household_id_idx" ON "financial_operation"("household_id");

-- CreateIndex
CREATE INDEX "financial_operation_reversal_of_operation_id_idx" ON "financial_operation"("reversal_of_operation_id");

-- CreateIndex
CREATE INDEX "ledger_entry_financial_operation_id_idx" ON "ledger_entry"("financial_operation_id");

-- CreateIndex
CREATE INDEX "ledger_entry_account_id_idx" ON "ledger_entry"("account_id");

-- CreateIndex
CREATE INDEX "ledger_entry_subaccount_id_idx" ON "ledger_entry"("subaccount_id");

-- CreateIndex
CREATE UNIQUE INDEX "planned_operation_realized_operation_id_key" ON "planned_operation"("realized_operation_id");

-- CreateIndex
CREATE INDEX "planned_operation_household_id_idx" ON "planned_operation"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "planned_operation_recurrence_rule_id_expected_date_key" ON "planned_operation"("recurrence_rule_id", "expected_date");

-- CreateIndex
CREATE INDEX "medical_claim_household_id_idx" ON "medical_claim"("household_id");

-- CreateIndex
CREATE INDEX "medical_reimbursement_claim_id_idx" ON "medical_reimbursement"("claim_id");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_active_household_id_fkey" FOREIGN KEY ("active_household_id") REFERENCES "household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_membership" ADD CONSTRAINT "household_membership_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_membership" ADD CONSTRAINT "household_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invite" ADD CONSTRAINT "household_invite_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invite" ADD CONSTRAINT "household_invite_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invite" ADD CONSTRAINT "household_invite_used_by_id_fkey" FOREIGN KEY ("used_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_otp" ADD CONSTRAINT "email_otp_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_owner_member_id_fkey" FOREIGN KEY ("owner_member_id") REFERENCES "household_membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subaccount" ADD CONSTRAINT "subaccount_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subaccount" ADD CONSTRAINT "subaccount_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_rule" ADD CONSTRAINT "recurrence_rule_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_plan" ADD CONSTRAINT "financial_plan_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_plan_item" ADD CONSTRAINT "financial_plan_item_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "financial_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_plan_deadline" ADD CONSTRAINT "financial_plan_deadline_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "financial_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_subaccount_id_fkey" FOREIGN KEY ("subaccount_id") REFERENCES "subaccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_operation" ADD CONSTRAINT "financial_operation_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_operation" ADD CONSTRAINT "financial_operation_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_operation" ADD CONSTRAINT "financial_operation_source_account_id_fkey" FOREIGN KEY ("source_account_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_operation" ADD CONSTRAINT "financial_operation_source_subaccount_id_fkey" FOREIGN KEY ("source_subaccount_id") REFERENCES "subaccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_operation" ADD CONSTRAINT "financial_operation_destination_account_id_fkey" FOREIGN KEY ("destination_account_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_operation" ADD CONSTRAINT "financial_operation_destination_subaccount_id_fkey" FOREIGN KEY ("destination_subaccount_id") REFERENCES "subaccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_operation" ADD CONSTRAINT "financial_operation_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_operation" ADD CONSTRAINT "financial_operation_reversal_of_operation_id_fkey" FOREIGN KEY ("reversal_of_operation_id") REFERENCES "financial_operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_financial_operation_id_fkey" FOREIGN KEY ("financial_operation_id") REFERENCES "financial_operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_subaccount_id_fkey" FOREIGN KEY ("subaccount_id") REFERENCES "subaccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_operation" ADD CONSTRAINT "planned_operation_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_operation" ADD CONSTRAINT "planned_operation_recurrence_rule_id_fkey" FOREIGN KEY ("recurrence_rule_id") REFERENCES "recurrence_rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_operation" ADD CONSTRAINT "planned_operation_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_operation" ADD CONSTRAINT "planned_operation_financial_plan_item_id_fkey" FOREIGN KEY ("financial_plan_item_id") REFERENCES "financial_plan_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_operation" ADD CONSTRAINT "planned_operation_financial_plan_deadline_id_fkey" FOREIGN KEY ("financial_plan_deadline_id") REFERENCES "financial_plan_deadline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_operation" ADD CONSTRAINT "planned_operation_source_account_id_fkey" FOREIGN KEY ("source_account_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_operation" ADD CONSTRAINT "planned_operation_source_subaccount_id_fkey" FOREIGN KEY ("source_subaccount_id") REFERENCES "subaccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_operation" ADD CONSTRAINT "planned_operation_destination_account_id_fkey" FOREIGN KEY ("destination_account_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_operation" ADD CONSTRAINT "planned_operation_destination_subaccount_id_fkey" FOREIGN KEY ("destination_subaccount_id") REFERENCES "subaccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_operation" ADD CONSTRAINT "planned_operation_realized_operation_id_fkey" FOREIGN KEY ("realized_operation_id") REFERENCES "financial_operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_claim" ADD CONSTRAINT "medical_claim_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_claim" ADD CONSTRAINT "medical_claim_source_operation_id_fkey" FOREIGN KEY ("source_operation_id") REFERENCES "financial_operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_claim" ADD CONSTRAINT "medical_claim_subaccount_id_fkey" FOREIGN KEY ("subaccount_id") REFERENCES "subaccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_reimbursement" ADD CONSTRAINT "medical_reimbursement_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "medical_claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_reimbursement" ADD CONSTRAINT "medical_reimbursement_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "financial_operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_reimbursement" ADD CONSTRAINT "medical_reimbursement_allocation_subaccount_id_fkey" FOREIGN KEY ("allocation_subaccount_id") REFERENCES "subaccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================
-- Isolation stricte par foyer — Row Level Security (defense en profondeur)
-- Meme patron que l'ancien socle (archive/legacy-d-penses-2026-09-27) :
-- app.current_user_id / app.current_household_id positionnes via SET LOCAL
-- a chaque requete (cf. RlsContextService). FORCE necessaire car l'app est
-- proprietaire des tables.
-- ============================================================

-- household
ALTER TABLE "household" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "household" FORCE ROW LEVEL SECURITY;

CREATE POLICY household_context ON "household"
  FOR ALL
  USING ("id" = current_setting('app.current_household_id', true))
  WITH CHECK ("id" = current_setting('app.current_household_id', true));

CREATE POLICY household_membership_visibility ON "household"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "household_membership" hm
    WHERE hm."household_id" = "household"."id"
      AND hm."user_id" = current_setting('app.current_user_id', true)
  ));

CREATE POLICY household_insert ON "household"
  FOR INSERT
  WITH CHECK (true);

-- household_membership
ALTER TABLE "household_membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "household_membership" FORCE ROW LEVEL SECURITY;

CREATE POLICY hm_context ON "household_membership"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

CREATE POLICY hm_self_visibility ON "household_membership"
  FOR SELECT
  USING ("user_id" = current_setting('app.current_user_id', true));

CREATE POLICY hm_insert ON "household_membership"
  FOR INSERT
  WITH CHECK (true);

-- household_invite : contexte normal + lookup/redemption par code (avant d'avoir un contexte)
ALTER TABLE "household_invite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "household_invite" FORCE ROW LEVEL SECURITY;

CREATE POLICY household_invite_context ON "household_invite"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

CREATE POLICY household_invite_lookup_by_code ON "household_invite"
  FOR SELECT
  USING (
    ("used_at" IS NULL AND "expires_at" > now())
    OR "used_by_id" = current_setting('app.current_user_id', true)
  );

CREATE POLICY household_invite_redeem ON "household_invite"
  FOR UPDATE
  USING ("used_at" IS NULL AND "expires_at" > now())
  WITH CHECK (true);

-- account
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account" FORCE ROW LEVEL SECURITY;
CREATE POLICY account_context ON "account"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

-- subaccount (household_id direct, cf. schema)
ALTER TABLE "subaccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subaccount" FORCE ROW LEVEL SECURITY;
CREATE POLICY subaccount_context ON "subaccount"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

-- category
ALTER TABLE "category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "category" FORCE ROW LEVEL SECURITY;
CREATE POLICY category_context ON "category"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

-- recurrence_rule
ALTER TABLE "recurrence_rule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recurrence_rule" FORCE ROW LEVEL SECURITY;
CREATE POLICY recurrence_rule_context ON "recurrence_rule"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

-- financial_plan
ALTER TABLE "financial_plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_plan" FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_plan_context ON "financial_plan"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

-- financial_plan_item (pas de household_id direct — via plan_id)
ALTER TABLE "financial_plan_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_plan_item" FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_plan_item_context ON "financial_plan_item"
  FOR ALL
  USING ("plan_id" IN (SELECT id FROM "financial_plan" WHERE "household_id" = current_setting('app.current_household_id', true)))
  WITH CHECK ("plan_id" IN (SELECT id FROM "financial_plan" WHERE "household_id" = current_setting('app.current_household_id', true)));

-- financial_plan_deadline (pas de household_id direct — via plan_id)
ALTER TABLE "financial_plan_deadline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_plan_deadline" FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_plan_deadline_context ON "financial_plan_deadline"
  FOR ALL
  USING ("plan_id" IN (SELECT id FROM "financial_plan" WHERE "household_id" = current_setting('app.current_household_id', true)))
  WITH CHECK ("plan_id" IN (SELECT id FROM "financial_plan" WHERE "household_id" = current_setting('app.current_household_id', true)));

-- goal
ALTER TABLE "goal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goal" FORCE ROW LEVEL SECURITY;
CREATE POLICY goal_context ON "goal"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

-- financial_operation
ALTER TABLE "financial_operation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_operation" FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_operation_context ON "financial_operation"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

-- ledger_entry (pas de household_id direct — via financial_operation_id, jamais NULL)
ALTER TABLE "ledger_entry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_entry" FORCE ROW LEVEL SECURITY;
CREATE POLICY ledger_entry_context ON "ledger_entry"
  FOR ALL
  USING ("financial_operation_id" IN (SELECT id FROM "financial_operation" WHERE "household_id" = current_setting('app.current_household_id', true)))
  WITH CHECK ("financial_operation_id" IN (SELECT id FROM "financial_operation" WHERE "household_id" = current_setting('app.current_household_id', true)));

-- planned_operation
ALTER TABLE "planned_operation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "planned_operation" FORCE ROW LEVEL SECURITY;
CREATE POLICY planned_operation_context ON "planned_operation"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

-- medical_claim
ALTER TABLE "medical_claim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medical_claim" FORCE ROW LEVEL SECURITY;
CREATE POLICY medical_claim_context ON "medical_claim"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

-- medical_reimbursement (pas de household_id direct — via claim_id)
ALTER TABLE "medical_reimbursement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medical_reimbursement" FORCE ROW LEVEL SECURITY;
CREATE POLICY medical_reimbursement_context ON "medical_reimbursement"
  FOR ALL
  USING ("claim_id" IN (SELECT id FROM "medical_claim" WHERE "household_id" = current_setting('app.current_household_id', true)))
  WITH CHECK ("claim_id" IN (SELECT id FROM "medical_claim" WHERE "household_id" = current_setting('app.current_household_id', true)));
