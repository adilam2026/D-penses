-- Lot 44 / M9B §3 — traçabilité de la Deadline réelle d'origine d'une chaîne de
-- prévision (un ChargePlan pouvant porter plusieurs Deadline distinctes,
-- sourceChargePlanId seul ne suffit pas). Additive uniquement.

-- AlterTable
ALTER TABLE "school_projection" ADD COLUMN     "source_deadline_id" TEXT;

-- CreateIndex
CREATE INDEX "school_projection_source_deadline_id_idx" ON "school_projection"("source_deadline_id");

-- AddForeignKey
ALTER TABLE "school_projection" ADD CONSTRAINT "school_projection_source_deadline_id_fkey" FOREIGN KEY ("source_deadline_id") REFERENCES "deadline"("id") ON DELETE SET NULL ON UPDATE CASCADE;
