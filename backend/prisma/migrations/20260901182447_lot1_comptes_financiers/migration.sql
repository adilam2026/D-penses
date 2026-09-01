-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('courant', 'epargne', 'especes', 'autre');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('actif', 'archive');

-- CreateEnum
CREATE TYPE "SnapshotSource" AS ENUM ('manuel', 'import');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('pending', 'resolue');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('ecart_rapprochement', 'correction', 'autre');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('prevu', 'confirme', 'annule');

-- CreateEnum
CREATE TYPE "TransferType" AS ENUM ('interne', 'retrait_especes', 'depot_especes');

-- CreateTable
CREATE TABLE "financial_account" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "owner_user_id" TEXT,
    "status" "AccountStatus" NOT NULL DEFAULT 'actif',
    "include_in_operational_treasury" BOOLEAN NOT NULL DEFAULT true,
    "is_protected" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_balance_snapshot" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "declared_balance" DECIMAL(14,2) NOT NULL,
    "declared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "SnapshotSource" NOT NULL DEFAULT 'manuel',
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "account_balance_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "computed_balance" DECIMAL(14,2) NOT NULL,
    "declared_balance" DECIMAL(14,2) NOT NULL,
    "discrepancy" DECIMAL(14,2) NOT NULL,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'pending',
    "reconciled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustment" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT,
    "type" "AdjustmentType" NOT NULL DEFAULT 'autre',
    "linked_reconciliation_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_transfer" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "from_account_id" TEXT,
    "to_account_id" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "planned_date" TIMESTAMP(3) NOT NULL,
    "actual_date" TIMESTAMP(3),
    "status" "TransferStatus" NOT NULL DEFAULT 'prevu',
    "type" "TransferType" NOT NULL DEFAULT 'interne',
    "confirmed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_transfer_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_account" ADD CONSTRAINT "financial_account_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_balance_snapshot" ADD CONSTRAINT "account_balance_snapshot_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation" ADD CONSTRAINT "reconciliation_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment" ADD CONSTRAINT "adjustment_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment" ADD CONSTRAINT "adjustment_linked_reconciliation_id_fkey" FOREIGN KEY ("linked_reconciliation_id") REFERENCES "reconciliation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transfer" ADD CONSTRAINT "account_transfer_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transfer" ADD CONSTRAINT "account_transfer_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "financial_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_transfer" ADD CONSTRAINT "account_transfer_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "financial_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- Isolation stricte par foyer — RLS Lot 1 (docs/04 §S.2)
-- ============================================================

ALTER TABLE "financial_account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_account" FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_account_context ON "financial_account"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

ALTER TABLE "account_balance_snapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_balance_snapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY account_balance_snapshot_context ON "account_balance_snapshot"
  FOR ALL
  USING ("account_id" IN (SELECT id FROM "financial_account" WHERE "household_id" = current_setting('app.current_household_id', true)))
  WITH CHECK ("account_id" IN (SELECT id FROM "financial_account" WHERE "household_id" = current_setting('app.current_household_id', true)));

ALTER TABLE "reconciliation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation" FORCE ROW LEVEL SECURITY;
CREATE POLICY reconciliation_context ON "reconciliation"
  FOR ALL
  USING ("account_id" IN (SELECT id FROM "financial_account" WHERE "household_id" = current_setting('app.current_household_id', true)))
  WITH CHECK ("account_id" IN (SELECT id FROM "financial_account" WHERE "household_id" = current_setting('app.current_household_id', true)));

ALTER TABLE "adjustment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "adjustment" FORCE ROW LEVEL SECURITY;
CREATE POLICY adjustment_context ON "adjustment"
  FOR ALL
  USING ("account_id" IN (SELECT id FROM "financial_account" WHERE "household_id" = current_setting('app.current_household_id', true)))
  WITH CHECK ("account_id" IN (SELECT id FROM "financial_account" WHERE "household_id" = current_setting('app.current_household_id', true)));

ALTER TABLE "account_transfer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_transfer" FORCE ROW LEVEL SECURITY;
CREATE POLICY account_transfer_context ON "account_transfer"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

-- ============================================================
-- LedgerEntry (docs/04 §P.2) — amorce Lot 1 : transferts confirmés + ajustements.
-- Sera étendue par UNION ALL dans les lots suivants (revenus, paiements, dépenses)
-- sans jamais devenir une source de vérité : purement dérivée, en lecture seule.
-- Vue => hérite automatiquement des policies RLS des tables sous-jacentes.
-- ============================================================
CREATE VIEW "ledger_entry" AS
  SELECT 'transfer_in'::text AS kind, id, household_id, actual_date AS occurred_at, amount, to_account_id AS account_id
    FROM "account_transfer" WHERE status = 'confirme' AND to_account_id IS NOT NULL
  UNION ALL
  SELECT 'transfer_out'::text, id, household_id, actual_date, -amount, from_account_id
    FROM "account_transfer" WHERE status = 'confirme' AND from_account_id IS NOT NULL
  UNION ALL
  SELECT 'adjustment'::text, a.id, fa.household_id, a.occurred_at, a.amount, a.account_id
    FROM "adjustment" a JOIN "financial_account" fa ON fa.id = a.account_id;

-- ============================================================
-- Solde courant (RG-080) : dernier AccountBalanceSnapshot + mouvements réels depuis cette date.
-- Jamais un champ balance autoritaire mis à jour impérativement à chaque opération (doc02 §E.8).
-- ============================================================
CREATE VIEW "account_current_balance" AS
  SELECT fa.id AS account_id,
    COALESCE(snap.declared_balance, 0) + COALESCE(mv.movements_since, 0) AS solde_courant
  FROM "financial_account" fa
  LEFT JOIN LATERAL (
    SELECT declared_balance, declared_at
    FROM "account_balance_snapshot"
    WHERE account_id = fa.id
    ORDER BY declared_at DESC
    LIMIT 1
  ) snap ON true
  LEFT JOIN LATERAL (
    SELECT SUM(amount) AS movements_since
    FROM "ledger_entry"
    WHERE account_id = fa.id
      AND occurred_at > COALESCE(snap.declared_at, '-infinity'::timestamp)
  ) mv ON true;
