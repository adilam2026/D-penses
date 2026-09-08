-- R6.2 §1/§5/§10 — 3 évolutions indépendantes de schéma, chacune minimale :
--  1. charge_plan.recurrence_anchor_date : ancre de récurrence éditable (§1/§3),
--     miroir de income_source.recurrence_anchor_date — NULL = comportement
--     historique inchangé (ensureChargeDeadlinesUntil retombe sur start_date).
--  2. payment.account_id devient nullable (§5 CAS B — paiement historique
--     reconstitué sans compte connu, jamais pour un paiement normal).
--  3. recurring_transfer : nouvel objet dédié (§10), jamais une ChargePlan —
--     génère des account_transfer (statut prevu) via le même moteur de
--     récurrence que les revenus/charges.

-- CreateEnum
CREATE TYPE "RecurringTransferStatus" AS ENUM ('actif', 'inactif');

-- DropForeignKey
ALTER TABLE "payment" DROP CONSTRAINT "payment_account_id_fkey";

-- AlterTable
ALTER TABLE "account_transfer" ADD COLUMN     "recurring_transfer_id" TEXT;

-- AlterTable
ALTER TABLE "charge_plan" ADD COLUMN     "recurrence_anchor_date" DATE;

-- AlterTable
ALTER TABLE "payment" ALTER COLUMN "account_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "recurring_transfer" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "from_account_id" TEXT,
    "to_account_id" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "recurrence_rule" "RecurrenceFrequency" NOT NULL,
    "recurrence_anchor_date" DATE NOT NULL,
    "note" TEXT,
    "status" "RecurringTransferStatus" NOT NULL DEFAULT 'actif',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_transfer_household_id_idx" ON "recurring_transfer"("household_id");

-- CreateIndex : anti-doublon pour ensureRecurringTransfersUntil (createMany skipDuplicates),
-- même patron que deadline[charge_plan_id,due_date]/income_occurrence[income_source_id,usual_date].
CREATE UNIQUE INDEX "account_transfer_recurring_transfer_id_planned_date_key" ON "account_transfer"("recurring_transfer_id", "planned_date");

-- AddForeignKey
ALTER TABLE "account_transfer" ADD CONSTRAINT "account_transfer_recurring_transfer_id_fkey" FOREIGN KEY ("recurring_transfer_id") REFERENCES "recurring_transfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transfer" ADD CONSTRAINT "recurring_transfer_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transfer" ADD CONSTRAINT "recurring_transfer_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "financial_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transfer" ADD CONSTRAINT "recurring_transfer_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "financial_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey : ON DELETE SET NULL (jamais CASCADE, RG-015 — un Payment historique reste
-- toujours visible même si son compte est un jour supprimé — cf. convention existante pour
-- FinancialAccount, jamais de DELETE physique en pratique côté service).
ALTER TABLE "payment" ADD CONSTRAINT "payment_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- RLS — recurring_transfer (même patron que account_transfer, isolation stricte par foyer)
-- ============================================================
ALTER TABLE "recurring_transfer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recurring_transfer" FORCE ROW LEVEL SECURITY;
CREATE POLICY recurring_transfer_context ON "recurring_transfer"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));
