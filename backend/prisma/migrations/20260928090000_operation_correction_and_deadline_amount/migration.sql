-- AlterTable
ALTER TABLE "financial_operation" ADD COLUMN     "correction_of_operation_id" TEXT;

-- AlterTable
ALTER TABLE "financial_plan_deadline" ADD COLUMN     "expected_amount" DECIMAL(14,2);

-- CreateIndex
CREATE INDEX "financial_operation_correction_of_operation_id_idx" ON "financial_operation"("correction_of_operation_id");

-- AddForeignKey
ALTER TABLE "financial_operation" ADD CONSTRAINT "financial_operation_correction_of_operation_id_fkey" FOREIGN KEY ("correction_of_operation_id") REFERENCES "financial_operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
