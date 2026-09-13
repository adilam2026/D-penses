-- AlterTable
ALTER TABLE "variable_budget" ADD COLUMN     "category_type_id" TEXT;

-- CreateIndex
CREATE INDEX "variable_budget_category_type_id_idx" ON "variable_budget"("category_type_id");

-- AddForeignKey
ALTER TABLE "variable_budget" ADD CONSTRAINT "variable_budget_category_type_id_fkey" FOREIGN KEY ("category_type_id") REFERENCES "category_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;
