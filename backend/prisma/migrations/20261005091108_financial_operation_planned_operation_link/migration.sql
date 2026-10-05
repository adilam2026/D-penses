-- AlterTable
ALTER TABLE "financial_operation" ADD COLUMN     "planned_operation_id" TEXT;

-- CreateIndex
CREATE INDEX "financial_operation_planned_operation_id_idx" ON "financial_operation"("planned_operation_id");

-- AddForeignKey
ALTER TABLE "financial_operation" ADD CONSTRAINT "financial_operation_planned_operation_id_fkey" FOREIGN KEY ("planned_operation_id") REFERENCES "planned_operation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
