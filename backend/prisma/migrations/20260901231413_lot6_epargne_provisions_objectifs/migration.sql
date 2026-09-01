-- CreateEnum
CREATE TYPE "AllocationMode" AS ENUM ('virtual_allocation', 'backed_by_account');

-- CreateEnum
CREATE TYPE "PocketType" AS ENUM ('savings_pocket', 'provision');

-- CreateEnum
CREATE TYPE "PocketMovementStatus" AS ENUM ('prevu', 'confirme', 'en_retard', 'annule');

-- CreateEnum
CREATE TYPE "PocketMovementType" AS ENUM ('contribution', 'retrait');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('en_cours', 'en_pause', 'atteint', 'abandonne');

-- CreateEnum
CREATE TYPE "GoalContributionStatus" AS ENUM ('prevu', 'confirme', 'annule');

-- CreateTable
CREATE TABLE "savings_pocket" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "beneficiary_child_id" TEXT,
    "is_protected" BOOLEAN NOT NULL DEFAULT false,
    "allocation_mode" "AllocationMode" NOT NULL,
    "linked_account_id" TEXT,
    "target_amount" DECIMAL(14,2),
    "target_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savings_pocket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provision" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "allocation_mode" "AllocationMode" NOT NULL,
    "linked_account_id" TEXT,
    "is_flexible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pocket_movement" (
    "id" TEXT NOT NULL,
    "pocket_type" "PocketType" NOT NULL,
    "savings_pocket_id" TEXT,
    "provision_id" TEXT,
    "planned_date" DATE NOT NULL,
    "planned_amount" DECIMAL(14,2) NOT NULL,
    "actual_date" TIMESTAMP(3),
    "actual_amount" DECIMAL(14,2),
    "status" "PocketMovementStatus" NOT NULL DEFAULT 'prevu',
    "movement_type" "PocketMovementType" NOT NULL,
    "intention_label" TEXT,
    "recorded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pocket_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "target_amount" DECIMAL(14,2) NOT NULL,
    "target_date" DATE,
    "priority_level" INTEGER NOT NULL DEFAULT 1,
    "linked_pocket_id" TEXT,
    "status" "GoalStatus" NOT NULL DEFAULT 'en_cours',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_contribution" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "planned_date" DATE NOT NULL,
    "planned_amount" DECIMAL(14,2) NOT NULL,
    "actual_date" TIMESTAMP(3),
    "actual_amount" DECIMAL(14,2),
    "status" "GoalContributionStatus" NOT NULL DEFAULT 'prevu',
    "recorded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_contribution_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_provision_id_fkey" FOREIGN KEY ("provision_id") REFERENCES "provision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_provision_id_fkey" FOREIGN KEY ("provision_id") REFERENCES "provision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_plan" ADD CONSTRAINT "financial_plan_linked_provision_id_fkey" FOREIGN KEY ("linked_provision_id") REFERENCES "provision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_pocket" ADD CONSTRAINT "savings_pocket_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_pocket" ADD CONSTRAINT "savings_pocket_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_pocket" ADD CONSTRAINT "savings_pocket_beneficiary_child_id_fkey" FOREIGN KEY ("beneficiary_child_id") REFERENCES "child"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_pocket" ADD CONSTRAINT "savings_pocket_linked_account_id_fkey" FOREIGN KEY ("linked_account_id") REFERENCES "financial_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provision" ADD CONSTRAINT "provision_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provision" ADD CONSTRAINT "provision_linked_account_id_fkey" FOREIGN KEY ("linked_account_id") REFERENCES "financial_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pocket_movement" ADD CONSTRAINT "pocket_movement_savings_pocket_id_fkey" FOREIGN KEY ("savings_pocket_id") REFERENCES "savings_pocket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pocket_movement" ADD CONSTRAINT "pocket_movement_provision_id_fkey" FOREIGN KEY ("provision_id") REFERENCES "provision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pocket_movement" ADD CONSTRAINT "pocket_movement_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal" ADD CONSTRAINT "goal_linked_pocket_id_fkey" FOREIGN KEY ("linked_pocket_id") REFERENCES "savings_pocket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contribution" ADD CONSTRAINT "goal_contribution_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_contribution" ADD CONSTRAINT "goal_contribution_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Contraintes d'intégrité (docs/02 §E.5bis RG-070→074, doc04 §P.1) — Lot 6.
-- ============================================================

-- RG-071 : linked_account_id renseigné SSI allocation_mode = backed_by_account —
-- jamais un compte "orphelin" ni une poche virtuelle qui pointerait accidentellement
-- vers un compte (ce qui laisserait croire à un adossement qui n'existe pas).
ALTER TABLE "savings_pocket" ADD CONSTRAINT "savings_pocket_allocation_consistency" CHECK (
  ("allocation_mode" = 'backed_by_account' AND "linked_account_id" IS NOT NULL) OR
  ("allocation_mode" = 'virtual_allocation' AND "linked_account_id" IS NULL)
);
ALTER TABLE "provision" ADD CONSTRAINT "provision_allocation_consistency" CHECK (
  ("allocation_mode" = 'backed_by_account' AND "linked_account_id" IS NOT NULL) OR
  ("allocation_mode" = 'virtual_allocation' AND "linked_account_id" IS NULL)
);
ALTER TABLE "savings_pocket" ADD CONSTRAINT "savings_pocket_target_amount_positive" CHECK ("target_amount" IS NULL OR "target_amount" > 0);

-- RG-072/IF-14 : un compte ne backe qu'UNE seule poche/provision à la fois — un index
-- unique partiel par table ne suffit pas (il n'empêche pas le même compte d'être
-- utilisé simultanément par une SavingsPocket ET une Provision) : un trigger couvre
-- l'unicité croisée entre les deux tables, cf. plus bas.
CREATE UNIQUE INDEX "savings_pocket_linked_account_unique" ON "savings_pocket"("linked_account_id") WHERE "allocation_mode" = 'backed_by_account';
CREATE UNIQUE INDEX "provision_linked_account_unique" ON "provision"("linked_account_id") WHERE "allocation_mode" = 'backed_by_account';

CREATE FUNCTION check_linked_account_cross_unique() RETURNS TRIGGER AS $$
DECLARE
  v_conflict BOOLEAN;
BEGIN
  IF NEW."allocation_mode" <> 'backed_by_account' OR NEW."linked_account_id" IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'savings_pocket' THEN
    SELECT EXISTS(
      SELECT 1 FROM "provision" WHERE "linked_account_id" = NEW."linked_account_id" AND "allocation_mode" = 'backed_by_account'
    ) INTO v_conflict;
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM "savings_pocket" WHERE "linked_account_id" = NEW."linked_account_id" AND "allocation_mode" = 'backed_by_account'
    ) INTO v_conflict;
  END IF;
  IF v_conflict THEN
    RAISE EXCEPTION 'Ce compte est déjà dédié à une autre poche/provision (RG-072/IF-14)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_savings_pocket_linked_account_cross_unique
  BEFORE INSERT OR UPDATE ON "savings_pocket"
  FOR EACH ROW EXECUTE FUNCTION check_linked_account_cross_unique();

CREATE TRIGGER trg_provision_linked_account_cross_unique
  BEFORE INSERT OR UPDATE ON "provision"
  FOR EACH ROW EXECUTE FUNCTION check_linked_account_cross_unique();

-- RG-114 (patron réutilisé) : discriminant typé + exactement une des deux FK renseignée.
ALTER TABLE "pocket_movement" ADD CONSTRAINT "pocket_movement_type_consistency" CHECK (
  ("pocket_type" = 'savings_pocket' AND "savings_pocket_id" IS NOT NULL AND "provision_id" IS NULL) OR
  ("pocket_type" = 'provision' AND "provision_id" IS NOT NULL AND "savings_pocket_id" IS NULL)
);
-- Montants toujours positifs (§4) — le signe est déduit de movement_type, jamais saisi.
ALTER TABLE "pocket_movement" ADD CONSTRAINT "pocket_movement_planned_amount_positive" CHECK ("planned_amount" > 0);
ALTER TABLE "pocket_movement" ADD CONSTRAINT "pocket_movement_actual_amount_positive" CHECK ("actual_amount" IS NULL OR "actual_amount" > 0);
-- Un mouvement confirmé porte toujours sa date/montant réel (§16/17) — jamais confirmé sans effet réel.
ALTER TABLE "pocket_movement" ADD CONSTRAINT "pocket_movement_confirme_has_actual" CHECK (
  "status" <> 'confirme' OR ("actual_date" IS NOT NULL AND "actual_amount" IS NOT NULL)
);

ALTER TABLE "goal" ADD CONSTRAINT "goal_target_amount_positive" CHECK ("target_amount" > 0);
ALTER TABLE "goal_contribution" ADD CONSTRAINT "goal_contribution_planned_amount_positive" CHECK ("planned_amount" > 0);
ALTER TABLE "goal_contribution" ADD CONSTRAINT "goal_contribution_actual_amount_positive" CHECK ("actual_amount" IS NULL OR "actual_amount" > 0);
ALTER TABLE "goal_contribution" ADD CONSTRAINT "goal_contribution_confirme_has_actual" CHECK (
  "status" <> 'confirme' OR ("actual_date" IS NOT NULL AND "actual_amount" IS NOT NULL)
);

-- ============================================================
-- Isolation stricte par foyer — RLS Lot 6 (docs/04 §S.2)
-- ============================================================

ALTER TABLE "savings_pocket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "savings_pocket" FORCE ROW LEVEL SECURITY;
CREATE POLICY savings_pocket_context ON "savings_pocket"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

ALTER TABLE "provision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provision" FORCE ROW LEVEL SECURITY;
CREATE POLICY provision_context ON "provision"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

ALTER TABLE "pocket_movement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pocket_movement" FORCE ROW LEVEL SECURITY;
CREATE POLICY pocket_movement_context ON "pocket_movement"
  FOR ALL
  USING (
    "savings_pocket_id" IN (SELECT id FROM "savings_pocket" WHERE "household_id" = current_setting('app.current_household_id', true))
    OR "provision_id" IN (SELECT id FROM "provision" WHERE "household_id" = current_setting('app.current_household_id', true))
  )
  WITH CHECK (
    "savings_pocket_id" IN (SELECT id FROM "savings_pocket" WHERE "household_id" = current_setting('app.current_household_id', true))
    OR "provision_id" IN (SELECT id FROM "provision" WHERE "household_id" = current_setting('app.current_household_id', true))
  );

ALTER TABLE "goal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goal" FORCE ROW LEVEL SECURITY;
CREATE POLICY goal_context ON "goal"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

ALTER TABLE "goal_contribution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goal_contribution" FORCE ROW LEVEL SECURITY;
CREATE POLICY goal_contribution_context ON "goal_contribution"
  FOR ALL
  USING ("goal_id" IN (SELECT id FROM "goal" WHERE "household_id" = current_setting('app.current_household_id', true)))
  WITH CHECK ("goal_id" IN (SELECT id FROM "goal" WHERE "household_id" = current_setting('app.current_household_id', true)));
