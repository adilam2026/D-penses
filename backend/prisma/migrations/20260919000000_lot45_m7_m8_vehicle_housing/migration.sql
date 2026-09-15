-- Lot 45 / M7+M8 — référentiels Vehicle/Housing ultra-simples (id/household_id/name/
-- status uniquement, aucune fiche technique) + rattachement direct sur FinancialPlan
-- et ChargePlan. Additif uniquement : aucune colonne supprimée, aucun moteur financier
-- nouveau (Vehicle/Housing ne sont jamais lus par les moteurs de trésorerie/engagements
-- existants, seulement une contextualisation d'affichage "Libellé · Entité").

-- CreateEnum
CREATE TYPE "ReferentialStatus" AS ENUM ('active', 'inactive');

-- AlterEnum
ALTER TYPE "FinancialPlanType" ADD VALUE 'vehicle';
ALTER TYPE "FinancialPlanType" ADD VALUE 'housing';
ALTER TYPE "FinancialPlanType" ADD VALUE 'subscriptions';

-- AlterTable
ALTER TABLE "charge_plan" ADD COLUMN     "housing_id" TEXT,
ADD COLUMN     "vehicle_id" TEXT;

-- AlterTable
ALTER TABLE "financial_plan" ADD COLUMN     "housing_id" TEXT,
ADD COLUMN     "vehicle_id" TEXT;

-- CreateTable
CREATE TABLE "vehicle" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ReferentialStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "housing" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ReferentialStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "housing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_household_id_idx" ON "vehicle"("household_id");

-- CreateIndex
CREATE INDEX "housing_household_id_idx" ON "housing"("household_id");

-- CreateIndex
CREATE INDEX "charge_plan_vehicle_id_idx" ON "charge_plan"("vehicle_id");

-- CreateIndex
CREATE INDEX "charge_plan_housing_id_idx" ON "charge_plan"("housing_id");

-- CreateIndex
CREATE INDEX "financial_plan_vehicle_id_idx" ON "financial_plan"("vehicle_id");

-- CreateIndex
CREATE INDEX "financial_plan_housing_id_idx" ON "financial_plan"("housing_id");

-- AddForeignKey
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "housing" ADD CONSTRAINT "housing_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_plan" ADD CONSTRAINT "charge_plan_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_plan" ADD CONSTRAINT "charge_plan_housing_id_fkey" FOREIGN KEY ("housing_id") REFERENCES "housing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_plan" ADD CONSTRAINT "financial_plan_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_plan" ADD CONSTRAINT "financial_plan_housing_id_fkey" FOREIGN KEY ("housing_id") REFERENCES "housing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- RLS — vehicle / housing (même patron que school_projection/recurring_transfer,
-- isolation stricte par foyer)
-- ============================================================
ALTER TABLE "vehicle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vehicle" FORCE ROW LEVEL SECURITY;
CREATE POLICY vehicle_context ON "vehicle"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

ALTER TABLE "housing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "housing" FORCE ROW LEVEL SECURITY;
CREATE POLICY housing_context ON "housing"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));
