-- Lot 42 / M9 — prévision pluriannuelle des postes École, additive uniquement.
-- Aucune colonne supprimée, aucune contrainte NOT NULL sur du texte historique,
-- aucune vraie Deadline créée par avance (school_projection reste une table à
-- part, jamais lue par les moteurs de trésorerie/engagements existants).

-- CreateEnum
CREATE TYPE "SchoolProjectionIncreaseType" AS ENUM ('aucune', 'fixe', 'pourcentage');

-- CreateEnum
CREATE TYPE "SchoolProjectionStatus" AS ENUM ('projete', 'remplacee');

-- AlterTable
ALTER TABLE "financial_plan" ADD COLUMN     "school_name" TEXT,
ADD COLUMN     "school_year" TEXT;

-- CreateTable
CREATE TABLE "school_projection" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "school_name" TEXT,
    "label" TEXT NOT NULL,
    "school_year" TEXT NOT NULL,
    "target_date" DATE NOT NULL,
    "source_financial_plan_id" TEXT NOT NULL,
    "source_charge_plan_id" TEXT NOT NULL,
    "reference_amount" DECIMAL(14,2) NOT NULL,
    "increase_type" "SchoolProjectionIncreaseType" NOT NULL,
    "increase_value" DECIMAL(14,2),
    "computed_amount" DECIMAL(14,2) NOT NULL,
    "status" "SchoolProjectionStatus" NOT NULL DEFAULT 'projete',
    "previous_projection_id" TEXT,
    "replaced_by_financial_plan_id" TEXT,
    "replaced_by_deadline_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_projection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_projection_previous_projection_id_key" ON "school_projection"("previous_projection_id");

-- CreateIndex
CREATE INDEX "school_projection_household_id_idx" ON "school_projection"("household_id");

-- CreateIndex
CREATE INDEX "school_projection_child_id_idx" ON "school_projection"("child_id");

-- CreateIndex
CREATE INDEX "school_projection_source_financial_plan_id_idx" ON "school_projection"("source_financial_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "school_projection_source_charge_plan_id_school_year_key" ON "school_projection"("source_charge_plan_id", "school_year");

-- AddForeignKey
ALTER TABLE "school_projection" ADD CONSTRAINT "school_projection_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_projection" ADD CONSTRAINT "school_projection_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_projection" ADD CONSTRAINT "school_projection_source_financial_plan_id_fkey" FOREIGN KEY ("source_financial_plan_id") REFERENCES "financial_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_projection" ADD CONSTRAINT "school_projection_source_charge_plan_id_fkey" FOREIGN KEY ("source_charge_plan_id") REFERENCES "charge_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_projection" ADD CONSTRAINT "school_projection_previous_projection_id_fkey" FOREIGN KEY ("previous_projection_id") REFERENCES "school_projection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_projection" ADD CONSTRAINT "school_projection_replaced_by_financial_plan_id_fkey" FOREIGN KEY ("replaced_by_financial_plan_id") REFERENCES "financial_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_projection" ADD CONSTRAINT "school_projection_replaced_by_deadline_id_fkey" FOREIGN KEY ("replaced_by_deadline_id") REFERENCES "deadline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- RLS — school_projection (même patron que recurring_transfer, isolation stricte par foyer)
-- ============================================================
ALTER TABLE "school_projection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_projection" FORCE ROW LEVEL SECURITY;
CREATE POLICY school_projection_context ON "school_projection"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));
