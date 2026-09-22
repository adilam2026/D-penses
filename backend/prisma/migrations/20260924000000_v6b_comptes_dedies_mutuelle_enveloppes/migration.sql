-- CreateEnum
CREATE TYPE "MedicalClaimStatus" AS ENUM ('en_attente', 'partiellement_rembourse', 'cloture');

-- AlterTable
ALTER TABLE "adhoc_expense" ADD COLUMN     "remboursable_mutuelle" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "financial_account" ADD COLUMN     "bank_name" TEXT,
ADD COLUMN     "dedicated_category_id" TEXT,
ADD COLUMN     "is_dedicated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "savings_pocket" ADD COLUMN     "monthly_contribution" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "medical_claim" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "visit_date" DATE NOT NULL,
    "amount_engaged" DECIMAL(14,2) NOT NULL,
    "amount_reimbursed" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reimbursement_date" DATE,
    "reimbursement_account_id" TEXT,
    "allocated_savings_pocket_id" TEXT,
    "source_expense_id" TEXT NOT NULL,
    "status" "MedicalClaimStatus" NOT NULL DEFAULT 'en_attente',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medical_claim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "medical_claim_source_expense_id_key" ON "medical_claim"("source_expense_id");

-- CreateIndex
CREATE INDEX "medical_claim_household_id_idx" ON "medical_claim"("household_id");

-- CreateIndex
CREATE INDEX "medical_claim_status_idx" ON "medical_claim"("status");

-- CreateIndex
CREATE INDEX "financial_account_dedicated_category_id_idx" ON "financial_account"("dedicated_category_id");

-- AddForeignKey
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_dedicated_category_id_fkey" FOREIGN KEY ("dedicated_category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_claim" ADD CONSTRAINT "medical_claim_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_claim" ADD CONSTRAINT "medical_claim_reimbursement_account_id_fkey" FOREIGN KEY ("reimbursement_account_id") REFERENCES "financial_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_claim" ADD CONSTRAINT "medical_claim_allocated_savings_pocket_id_fkey" FOREIGN KEY ("allocated_savings_pocket_id") REFERENCES "savings_pocket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_claim" ADD CONSTRAINT "medical_claim_source_expense_id_fkey" FOREIGN KEY ("source_expense_id") REFERENCES "adhoc_expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "variable_budget_category_type_unique" RENAME TO "variable_budget_category_type_variable_budget_id_category_t_key";

