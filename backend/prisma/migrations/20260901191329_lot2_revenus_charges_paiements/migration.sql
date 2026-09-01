-- CreateEnum
CREATE TYPE "IncomeSourceStatus" AS ENUM ('actif', 'inactif');

-- CreateEnum
CREATE TYPE "IncomeOccurrenceStatus" AS ENUM ('prevu', 'recu', 'en_retard', 'annule');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel');

-- CreateEnum
CREATE TYPE "ChargePlanGenerationMode" AS ENUM ('auto_frequence', 'calendrier_manuel');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('obligatoire', 'optionnelle_envisagee', 'optionnelle_souscrite', 'optionnelle_refusee');

-- CreateEnum
CREATE TYPE "ChargePlanStatus" AS ENUM ('actif', 'inactif');

-- CreateEnum
CREATE TYPE "AmountStatus" AS ENUM ('inconnu', 'estime', 'confirme');

-- CreateEnum
CREATE TYPE "DeadlineFinancialStatus" AS ENUM ('ouverte', 'partiellement_payee', 'soldee', 'annulee');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('paiement', 'remboursement', 'ajustement');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('augmente_paye', 'diminue_paye');

-- CreateEnum
CREATE TYPE "FundingSource" AS ENUM ('compte', 'provision');

-- AlterTable
ALTER TABLE "financial_account" ADD COLUMN     "is_favorite" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "income_source" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "beneficiary_user_id" TEXT,
    "category_id" TEXT,
    "recurrence_rule" "RecurrenceFrequency",
    "usual_amount" DECIMAL(14,2) NOT NULL,
    "is_recurring" BOOLEAN NOT NULL DEFAULT true,
    "default_account_id" TEXT NOT NULL,
    "status" "IncomeSourceStatus" NOT NULL DEFAULT 'actif',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_occurrence" (
    "id" TEXT NOT NULL,
    "income_source_id" TEXT NOT NULL,
    "usual_date" DATE NOT NULL,
    "actual_date" TIMESTAMP(3),
    "planned_amount" DECIMAL(14,2) NOT NULL,
    "actual_amount" DECIMAL(14,2),
    "account_id" TEXT,
    "status" "IncomeOccurrenceStatus" NOT NULL DEFAULT 'prevu',
    "confirmed_by_user_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_occurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_plan" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category_id" TEXT,
    "generation_mode" "ChargePlanGenerationMode" NOT NULL DEFAULT 'auto_frequence',
    "recurrence_rule" "RecurrenceFrequency",
    "default_account_id" TEXT,
    "obligation_status" "ObligationStatus" NOT NULL DEFAULT 'obligatoire',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "priority_level" INTEGER NOT NULL DEFAULT 1,
    "status" "ChargePlanStatus" NOT NULL DEFAULT 'actif',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "charge_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deadline" (
    "id" TEXT NOT NULL,
    "charge_plan_id" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "expected_billing_date" DATE,
    "billing_date" DATE,
    "amount_current" DECIMAL(14,2),
    "amount_status" "AmountStatus" NOT NULL DEFAULT 'estime',
    "amount_initial_estimated" DECIMAL(14,2),
    "confirmed_at" TIMESTAMP(3),
    "financial_status" "DeadlineFinancialStatus" NOT NULL DEFAULT 'ouverte',
    "provision_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "deadline_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_date" TIMESTAMP(3) NOT NULL,
    "account_id" TEXT NOT NULL,
    "type" "PaymentType" NOT NULL DEFAULT 'paiement',
    "direction" "PaymentDirection",
    "funding_source" "FundingSource" NOT NULL DEFAULT 'compte',
    "provision_id" TEXT,
    "recorded_by_id" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "income_source" ADD CONSTRAINT "income_source_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_source" ADD CONSTRAINT "income_source_beneficiary_user_id_fkey" FOREIGN KEY ("beneficiary_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_source" ADD CONSTRAINT "income_source_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_source" ADD CONSTRAINT "income_source_default_account_id_fkey" FOREIGN KEY ("default_account_id") REFERENCES "financial_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_occurrence" ADD CONSTRAINT "income_occurrence_income_source_id_fkey" FOREIGN KEY ("income_source_id") REFERENCES "income_source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_occurrence" ADD CONSTRAINT "income_occurrence_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_occurrence" ADD CONSTRAINT "income_occurrence_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_plan" ADD CONSTRAINT "charge_plan_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_plan" ADD CONSTRAINT "charge_plan_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_plan" ADD CONSTRAINT "charge_plan_default_account_id_fkey" FOREIGN KEY ("default_account_id") REFERENCES "financial_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_charge_plan_id_fkey" FOREIGN KEY ("charge_plan_id") REFERENCES "charge_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_deadline_id_fkey" FOREIGN KEY ("deadline_id") REFERENCES "deadline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Contraintes d'intégrité (docs/04 §P.1, RG-015, RG-102/103)
-- ============================================================

-- RG-015 : Payment.amount toujours strictement positif ; le signe comptable
-- est déduit du type par le moteur, jamais saisi.
ALTER TABLE "payment" ADD CONSTRAINT "payment_amount_positive" CHECK ("amount" > 0);
-- direction n'a de sens que pour un ajustement (doc04 §P.1) ; NOT NULL quand
-- type = ajustement est vérifié côté service (PaymentsService), pas ici, pour
-- rester une simple contrainte d'exclusivité comme dans le modèle de référence.
ALTER TABLE "payment" ADD CONSTRAINT "payment_direction_requires_adjustment" CHECK ("direction" IS NULL OR "type" = 'ajustement');

-- RG-102/RG-103 : amount_current est NULL si et seulement si amount_status = inconnu — jamais 0 dans ce cas.
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_amount_current_matches_status" CHECK (
  ("amount_status" = 'inconnu' AND "amount_current" IS NULL) OR
  ("amount_status" != 'inconnu' AND "amount_current" IS NOT NULL)
);

-- Un seul compte favori par foyer pour la saisie rapide (§14 Lot 2).
CREATE UNIQUE INDEX "financial_account_one_favorite_per_household" ON "financial_account"("household_id") WHERE "is_favorite" = true;

-- ============================================================
-- Isolation stricte par foyer — RLS Lot 2 (docs/04 §S.2)
-- ============================================================

ALTER TABLE "income_source" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "income_source" FORCE ROW LEVEL SECURITY;
CREATE POLICY income_source_context ON "income_source"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

ALTER TABLE "income_occurrence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "income_occurrence" FORCE ROW LEVEL SECURITY;
CREATE POLICY income_occurrence_context ON "income_occurrence"
  FOR ALL
  USING ("income_source_id" IN (SELECT id FROM "income_source" WHERE "household_id" = current_setting('app.current_household_id', true)))
  WITH CHECK ("income_source_id" IN (SELECT id FROM "income_source" WHERE "household_id" = current_setting('app.current_household_id', true)));

ALTER TABLE "charge_plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "charge_plan" FORCE ROW LEVEL SECURITY;
CREATE POLICY charge_plan_context ON "charge_plan"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

ALTER TABLE "deadline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deadline" FORCE ROW LEVEL SECURITY;
CREATE POLICY deadline_context ON "deadline"
  FOR ALL
  USING ("charge_plan_id" IN (SELECT id FROM "charge_plan" WHERE "household_id" = current_setting('app.current_household_id', true)))
  WITH CHECK ("charge_plan_id" IN (SELECT id FROM "charge_plan" WHERE "household_id" = current_setting('app.current_household_id', true)));

ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment" FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_context ON "payment"
  FOR ALL
  USING ("deadline_id" IN (
    SELECT d.id FROM "deadline" d JOIN "charge_plan" cp ON cp.id = d."charge_plan_id"
    WHERE cp."household_id" = current_setting('app.current_household_id', true)
  ))
  WITH CHECK ("deadline_id" IN (
    SELECT d.id FROM "deadline" d JOIN "charge_plan" cp ON cp.id = d."charge_plan_id"
    WHERE cp."household_id" = current_setting('app.current_household_id', true)
  ));

-- ============================================================
-- reste_a_payer (RG-016) — source de vérité unique, jamais recopiée dans
-- plusieurs services. Si amount_current est NULL (amount_status=inconnu),
-- reste_a_payer est NULL par propagation SQL naturelle — jamais 0 (RG-103).
-- ============================================================
CREATE VIEW "deadline_with_balance" AS
  SELECT d.*,
    d."amount_current" - COALESCE(SUM(
      CASE p."type"
        WHEN 'paiement' THEN p."amount"
        WHEN 'remboursement' THEN -p."amount"
        WHEN 'ajustement' THEN CASE p."direction" WHEN 'augmente_paye' THEN p."amount" ELSE -p."amount" END
      END
    ), 0) AS "reste_a_payer"
  FROM "deadline" d LEFT JOIN "payment" p ON p."deadline_id" = d."id"
  GROUP BY d."id";

-- ============================================================
-- LedgerEntry (docs/04 §P.2) — extension Lot 2 : revenus reçus + paiements.
-- Signe sur le SOLDE DU COMPTE (impact trésorerie), à ne jamais confondre avec
-- le signe RG-015 utilisé pour reste_a_payer (impact sur la dette de l'échéance,
-- IF-20). CREATE OR REPLACE conserve les colonnes existantes dans le même ordre
-- et ajoute label/category_id en fin de liste (Transactions, §13).
-- ============================================================
CREATE OR REPLACE VIEW "ledger_entry" AS
  SELECT 'transfer_in'::text AS kind, id, household_id, actual_date AS occurred_at, amount, to_account_id AS account_id,
         'Transfert entrant'::text AS label, NULL::text AS category_id
    FROM "account_transfer" WHERE status = 'confirme' AND to_account_id IS NOT NULL
  UNION ALL
  SELECT 'transfer_out'::text, id, household_id, actual_date, -amount, from_account_id,
         'Transfert sortant'::text, NULL::text
    FROM "account_transfer" WHERE status = 'confirme' AND from_account_id IS NOT NULL
  UNION ALL
  SELECT 'adjustment'::text, a.id, fa.household_id, a.occurred_at, a.amount, a.account_id,
         COALESCE(a.reason, 'Ajustement')::text, NULL::text
    FROM "adjustment" a JOIN "financial_account" fa ON fa.id = a.account_id
  UNION ALL
  SELECT 'income'::text, io.id, isrc.household_id, io.actual_date, io.actual_amount, io.account_id,
         isrc.label, isrc.category_id
    FROM "income_occurrence" io JOIN "income_source" isrc ON isrc.id = io.income_source_id
    WHERE io.status = 'recu'
  UNION ALL
  SELECT 'payment'::text, p.id, cp.household_id, p.paid_date,
    CASE p.type
      WHEN 'paiement' THEN -p.amount          -- sortie du compte payeur (correction V2.1)
      WHEN 'remboursement' THEN p.amount      -- entrée sur le compte receveur
      WHEN 'ajustement' THEN CASE p.direction WHEN 'augmente_paye' THEN -p.amount ELSE p.amount END
    END,
    p.account_id,
    cp.label,
    cp.category_id
  FROM "payment" p
    JOIN "deadline" d ON d.id = p.deadline_id
    JOIN "charge_plan" cp ON cp.id = d.charge_plan_id;
