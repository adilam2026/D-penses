-- Lot 11 (§9/§11 cadrage V1) — distinction explicite du type de FinancialPlan
-- (assistant scolaire vs assistant voyage vs plan libre) et destination réelle
-- pour les plans Voyage. Additif uniquement : aucune formule financière ni
-- colonne existante touchée. Les FinancialPlan déjà en base (dont les plans
-- scolaires créés via l'assistant Lot 4) reçoivent le défaut 'other' — un
-- backfill précis vers 'school' n'est pas nécessaire pour la V1 (planType
-- reste purement informatif côté UI, jamais lu par une formule).

CREATE TYPE "FinancialPlanType" AS ENUM ('school', 'travel', 'other');

ALTER TABLE "financial_plan" ADD COLUMN "plan_type" "FinancialPlanType" NOT NULL DEFAULT 'other';
ALTER TABLE "financial_plan" ADD COLUMN "destination" TEXT;
