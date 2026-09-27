-- AlterEnum
ALTER TYPE "RecurrenceFrequency" ADD VALUE 'BIMONTHLY';

-- AlterTable
ALTER TABLE "recurrence_rule" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "category_id" TEXT,
ADD COLUMN     "destination_account_id" TEXT,
ADD COLUMN     "destination_subaccount_id" TEXT,
ADD COLUMN     "expected_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "financial_plan_deadline_id" TEXT,
ADD COLUMN     "financial_plan_item_id" TEXT,
ADD COLUMN     "kind" "PlannedOperationKind" NOT NULL DEFAULT 'EXPENSE',
ADD COLUMN     "source_account_id" TEXT,
ADD COLUMN     "source_subaccount_id" TEXT;

-- AddForeignKey
ALTER TABLE "recurrence_rule" ADD CONSTRAINT "recurrence_rule_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_rule" ADD CONSTRAINT "recurrence_rule_financial_plan_item_id_fkey" FOREIGN KEY ("financial_plan_item_id") REFERENCES "financial_plan_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_rule" ADD CONSTRAINT "recurrence_rule_financial_plan_deadline_id_fkey" FOREIGN KEY ("financial_plan_deadline_id") REFERENCES "financial_plan_deadline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_rule" ADD CONSTRAINT "recurrence_rule_source_account_id_fkey" FOREIGN KEY ("source_account_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_rule" ADD CONSTRAINT "recurrence_rule_source_subaccount_id_fkey" FOREIGN KEY ("source_subaccount_id") REFERENCES "subaccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_rule" ADD CONSTRAINT "recurrence_rule_destination_account_id_fkey" FOREIGN KEY ("destination_account_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrence_rule" ADD CONSTRAINT "recurrence_rule_destination_subaccount_id_fkey" FOREIGN KEY ("destination_subaccount_id") REFERENCES "subaccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
