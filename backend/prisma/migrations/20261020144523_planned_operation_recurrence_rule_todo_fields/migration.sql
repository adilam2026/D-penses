-- AlterTable
ALTER TABLE "planned_operation" ADD COLUMN     "include_in_todo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "responsible_member_id" TEXT;

-- AlterTable
ALTER TABLE "recurrence_rule" ADD COLUMN     "include_in_todo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "responsible_member_id" TEXT;

-- AddForeignKey
ALTER TABLE "recurrence_rule" ADD CONSTRAINT "recurrence_rule_responsible_member_id_fkey" FOREIGN KEY ("responsible_member_id") REFERENCES "household_membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_operation" ADD CONSTRAINT "planned_operation_responsible_member_id_fkey" FOREIGN KEY ("responsible_member_id") REFERENCES "household_membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
