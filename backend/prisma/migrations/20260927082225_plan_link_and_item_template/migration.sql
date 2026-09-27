-- AlterTable
ALTER TABLE "financial_plan" ADD COLUMN     "account_id" TEXT,
ADD COLUMN     "subaccount_id" TEXT;

-- AlterTable
ALTER TABLE "financial_plan_item" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "expected_amount" DECIMAL(14,2),
ADD COLUMN     "frequency" "RecurrenceFrequency" NOT NULL DEFAULT 'ONCE';

-- AddForeignKey
ALTER TABLE "financial_plan" ADD CONSTRAINT "financial_plan_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_plan" ADD CONSTRAINT "financial_plan_subaccount_id_fkey" FOREIGN KEY ("subaccount_id") REFERENCES "subaccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
