-- CreateEnum
CREATE TYPE "BeneficiaryType" AS ENUM ('user', 'child');

-- AlterTable
ALTER TABLE "charge_plan" ADD COLUMN     "financial_plan_id" TEXT;

-- CreateTable
CREATE TABLE "financial_plan" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "linked_provision_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_plan_beneficiary" (
    "id" TEXT NOT NULL,
    "financial_plan_id" TEXT NOT NULL,
    "beneficiary_type" "BeneficiaryType" NOT NULL,
    "user_id" TEXT,
    "child_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_plan_beneficiary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charge_plan_child" (
    "charge_plan_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,

    CONSTRAINT "charge_plan_child_pkey" PRIMARY KEY ("charge_plan_id","child_id")
);

-- CreateTable
CREATE TABLE "deadline_child_allocation" (
    "id" TEXT NOT NULL,
    "deadline_id" TEXT NOT NULL,
    "child_id" TEXT NOT NULL,
    "allocation_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deadline_child_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deadline_child_allocation_deadline_id_child_id_key" ON "deadline_child_allocation"("deadline_id", "child_id");

-- AddForeignKey
ALTER TABLE "charge_plan" ADD CONSTRAINT "charge_plan_financial_plan_id_fkey" FOREIGN KEY ("financial_plan_id") REFERENCES "financial_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_plan" ADD CONSTRAINT "financial_plan_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_plan_beneficiary" ADD CONSTRAINT "financial_plan_beneficiary_financial_plan_id_fkey" FOREIGN KEY ("financial_plan_id") REFERENCES "financial_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_plan_beneficiary" ADD CONSTRAINT "financial_plan_beneficiary_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_plan_beneficiary" ADD CONSTRAINT "financial_plan_beneficiary_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "child"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_plan_child" ADD CONSTRAINT "charge_plan_child_charge_plan_id_fkey" FOREIGN KEY ("charge_plan_id") REFERENCES "charge_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charge_plan_child" ADD CONSTRAINT "charge_plan_child_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline_child_allocation" ADD CONSTRAINT "deadline_child_allocation_deadline_id_fkey" FOREIGN KEY ("deadline_id") REFERENCES "deadline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline_child_allocation" ADD CONSTRAINT "deadline_child_allocation_child_id_fkey" FOREIGN KEY ("child_id") REFERENCES "child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Intégrité référentielle des bénéficiaires (RG-114, doc04 §P.1bis, §8 de la demande)
-- ============================================================

-- Type explicite + une seule des deux colonnes renseignée selon le type.
ALTER TABLE "financial_plan_beneficiary" ADD CONSTRAINT "beneficiary_type_consistency" CHECK (
  ("beneficiary_type" = 'user'  AND "user_id"  IS NOT NULL AND "child_id" IS NULL) OR
  ("beneficiary_type" = 'child' AND "child_id" IS NOT NULL AND "user_id"  IS NULL)
);

-- Index uniques PARTIELS — jamais une seule UNIQUE(financial_plan_id, beneficiary_type,
-- user_id, child_id), insuffisante en PostgreSQL avec des colonnes nullables (deux lignes
-- avec user_id=NULL ne sont jamais considérées égales par une contrainte UNIQUE classique).
CREATE UNIQUE INDEX "financial_plan_beneficiary_unique_user" ON "financial_plan_beneficiary"("financial_plan_id", "user_id") WHERE "beneficiary_type" = 'user';
CREATE UNIQUE INDEX "financial_plan_beneficiary_unique_child" ON "financial_plan_beneficiary"("financial_plan_id", "child_id") WHERE "beneficiary_type" = 'child';

-- amount_current toujours strictement positif quand renseigné (cohérent avec RG-102/103).
ALTER TABLE "deadline" ADD CONSTRAINT "deadline_amount_current_positive" CHECK ("amount_current" IS NULL OR "amount_current" > 0);
ALTER TABLE "deadline_child_allocation" ADD CONSTRAINT "deadline_child_allocation_amount_positive" CHECK ("allocation_amount" > 0);

-- ============================================================
-- Isolation stricte par foyer — RLS Lot 4 (docs/04 §S.2)
-- ============================================================

ALTER TABLE "financial_plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_plan" FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_plan_context ON "financial_plan"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

ALTER TABLE "financial_plan_beneficiary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_plan_beneficiary" FORCE ROW LEVEL SECURITY;
CREATE POLICY financial_plan_beneficiary_context ON "financial_plan_beneficiary"
  FOR ALL
  USING ("financial_plan_id" IN (SELECT id FROM "financial_plan" WHERE "household_id" = current_setting('app.current_household_id', true)))
  WITH CHECK ("financial_plan_id" IN (SELECT id FROM "financial_plan" WHERE "household_id" = current_setting('app.current_household_id', true)));

ALTER TABLE "charge_plan_child" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "charge_plan_child" FORCE ROW LEVEL SECURITY;
CREATE POLICY charge_plan_child_context ON "charge_plan_child"
  FOR ALL
  USING ("charge_plan_id" IN (SELECT id FROM "charge_plan" WHERE "household_id" = current_setting('app.current_household_id', true)))
  WITH CHECK ("charge_plan_id" IN (SELECT id FROM "charge_plan" WHERE "household_id" = current_setting('app.current_household_id', true)));

ALTER TABLE "deadline_child_allocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deadline_child_allocation" FORCE ROW LEVEL SECURITY;
CREATE POLICY deadline_child_allocation_context ON "deadline_child_allocation"
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
-- Plafond de ventilation (RG-116bis/IF-29, §11/§12) — dans les DEUX sens :
-- (A) une allocation qui ferait dépasser amount_current est refusée à l'écriture ;
-- (B) une baisse de amount_current qui rendrait la ventilation déjà enregistrée
--     supérieure au nouveau montant est refusée — jamais silencieusement accepté.
-- Défense en profondeur : la même règle est aussi vérifiée côté service (message
-- d'erreur propre), ce trigger garantit l'invariant même pour un accès SQL direct.
-- ============================================================

CREATE FUNCTION check_deadline_allocation_ceiling() RETURNS TRIGGER AS $$
DECLARE
  v_amount_current NUMERIC;
  v_total_allocated NUMERIC;
BEGIN
  SELECT amount_current INTO v_amount_current FROM "deadline" WHERE id = NEW.deadline_id;
  IF v_amount_current IS NOT NULL THEN               -- amount_status = 'inconnu' : rien à borner (RG-103)
    SELECT COALESCE(SUM(allocation_amount), 0) INTO v_total_allocated
    FROM "deadline_child_allocation" WHERE deadline_id = NEW.deadline_id;
    IF v_total_allocated > v_amount_current THEN
      RAISE EXCEPTION 'Ventilation (% DH) supérieure au montant de l''échéance (% DH)', v_total_allocated, v_amount_current;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deadline_allocation_ceiling
  AFTER INSERT OR UPDATE ON "deadline_child_allocation"
  FOR EACH ROW EXECUTE FUNCTION check_deadline_allocation_ceiling();

CREATE FUNCTION check_deadline_amount_against_allocations() RETURNS TRIGGER AS $$
DECLARE
  v_total_allocated NUMERIC;
BEGIN
  IF NEW.amount_current IS NOT NULL THEN
    SELECT COALESCE(SUM(allocation_amount), 0) INTO v_total_allocated
    FROM "deadline_child_allocation" WHERE deadline_id = NEW.id;
    IF v_total_allocated > NEW.amount_current THEN
      RAISE EXCEPTION 'Nouveau montant (% DH) inférieur à la ventilation déjà enregistrée (% DH) — corrigez la ventilation avant de baisser le montant', NEW.amount_current, v_total_allocated;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deadline_amount_vs_allocation
  BEFORE UPDATE ON "deadline"
  FOR EACH ROW EXECUTE FUNCTION check_deadline_amount_against_allocations();
