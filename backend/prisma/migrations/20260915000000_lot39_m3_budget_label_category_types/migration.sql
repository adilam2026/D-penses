-- Lot 39 / M3 — libellé libre du budget + support multi-CategoryType.
-- Additive uniquement : aucune colonne supprimée, category_type_id (singulier)
-- reste en place pour compatibilité ascendante (cf. arbitrage M3).

-- AlterTable
ALTER TABLE "variable_budget" ADD COLUMN     "label" TEXT NOT NULL DEFAULT '';

-- Backfill : label = category.name (jamais categoryType.name, cf. arbitrage M3).
UPDATE "variable_budget" vb
SET "label" = c."name"
FROM "category" c
WHERE c."id" = vb."category_id";

-- CreateTable
CREATE TABLE "variable_budget_category_type" (
    "id" TEXT NOT NULL,
    "variable_budget_id" TEXT NOT NULL,
    "category_type_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variable_budget_category_type_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "variable_budget_category_type_category_type_id_idx" ON "variable_budget_category_type"("category_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "variable_budget_category_type_unique" ON "variable_budget_category_type"("variable_budget_id", "category_type_id");

-- AddForeignKey
ALTER TABLE "variable_budget_category_type" ADD CONSTRAINT "variable_budget_category_type_variable_budget_id_fkey" FOREIGN KEY ("variable_budget_id") REFERENCES "variable_budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variable_budget_category_type" ADD CONSTRAINT "variable_budget_category_type_category_type_id_fkey" FOREIGN KEY ("category_type_id") REFERENCES "category_type"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill : tout budget déjà scopé sur un unique CategoryType (colonne
-- singulière historique) obtient la même ligne dans la table de jonction —
-- comportement observable inchangé (matching identique avant/après ce lot).
INSERT INTO "variable_budget_category_type" ("id", "variable_budget_id", "category_type_id")
SELECT gen_random_uuid(), vb."id", vb."category_type_id"
FROM "variable_budget" vb
WHERE vb."category_type_id" IS NOT NULL;

-- ============================================================
-- Isolation stricte par foyer — RLS (même pattern que variable_budget_version)
-- ============================================================

ALTER TABLE "variable_budget_category_type" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "variable_budget_category_type" FORCE ROW LEVEL SECURITY;
CREATE POLICY variable_budget_category_type_context ON "variable_budget_category_type"
  FOR ALL
  USING ("variable_budget_id" IN (SELECT id FROM "variable_budget" WHERE "household_id" = current_setting('app.current_household_id', true)))
  WITH CHECK ("variable_budget_id" IN (SELECT id FROM "variable_budget" WHERE "household_id" = current_setting('app.current_household_id', true)));
