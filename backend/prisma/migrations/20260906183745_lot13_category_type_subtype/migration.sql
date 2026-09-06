-- AlterTable
ALTER TABLE "adhoc_expense" ADD COLUMN     "category_subtype_id" TEXT,
ADD COLUMN     "category_type_id" TEXT;

-- AlterTable
ALTER TABLE "budget_expense" ADD COLUMN     "category_subtype_id" TEXT,
ADD COLUMN     "category_type_id" TEXT;

-- CreateTable
CREATE TABLE "category_type" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "household_id" TEXT,
    "name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_subtype" (
    "id" TEXT NOT NULL,
    "category_type_id" TEXT NOT NULL,
    "household_id" TEXT,
    "name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_subtype_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "category_type_category_id_idx" ON "category_type"("category_id");

-- CreateIndex
CREATE INDEX "category_type_household_id_idx" ON "category_type"("household_id");

-- CreateIndex
CREATE INDEX "category_subtype_category_type_id_idx" ON "category_subtype"("category_type_id");

-- CreateIndex
CREATE INDEX "category_subtype_household_id_idx" ON "category_subtype"("household_id");

-- AddForeignKey
ALTER TABLE "category_type" ADD CONSTRAINT "category_type_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_type" ADD CONSTRAINT "category_type_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_subtype" ADD CONSTRAINT "category_subtype_category_type_id_fkey" FOREIGN KEY ("category_type_id") REFERENCES "category_type"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_subtype" ADD CONSTRAINT "category_subtype_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_expense" ADD CONSTRAINT "budget_expense_category_type_id_fkey" FOREIGN KEY ("category_type_id") REFERENCES "category_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_expense" ADD CONSTRAINT "budget_expense_category_subtype_id_fkey" FOREIGN KEY ("category_subtype_id") REFERENCES "category_subtype"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adhoc_expense" ADD CONSTRAINT "adhoc_expense_category_type_id_fkey" FOREIGN KEY ("category_type_id") REFERENCES "category_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adhoc_expense" ADD CONSTRAINT "adhoc_expense_category_subtype_id_fkey" FOREIGN KEY ("category_subtype_id") REFERENCES "category_subtype"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- RLS — même politique exacte que "category" (household_id NULL = système,
-- partagé par tous les foyers ; sinon strictement le foyer courant).
-- ============================================================
ALTER TABLE "category_type" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "category_type" FORCE ROW LEVEL SECURITY;

CREATE POLICY category_type_context ON "category_type"
  FOR ALL
  USING ("household_id" IS NULL OR "household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" IS NULL OR "household_id" = current_setting('app.current_household_id', true));

ALTER TABLE "category_subtype" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "category_subtype" FORCE ROW LEVEL SECURITY;

CREATE POLICY category_subtype_context ON "category_subtype"
  FOR ALL
  USING ("household_id" IS NULL OR "household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" IS NULL OR "household_id" = current_setting('app.current_household_id', true));

-- ============================================================
-- Vague 2 §2 — socle de types système par défaut, rattachés aux catégories
-- système existantes (household_id NULL des deux côtés). Volontairement
-- restreint : un socle simple, pas une taxonomie exhaustive (§2 de la demande).
-- Les catégories système sont supposées déjà seedées par une migration Lot 0
-- antérieure (nom exact requis pour le rattachement par nom).
-- ============================================================
DO $$
DECLARE
  cat_alimentation TEXT;
  cat_transport TEXT;
  cat_maison TEXT;
  cat_sante TEXT;
  cat_ecole TEXT;
  cat_vetements TEXT;
  cat_loisirs TEXT;
  cat_vacances TEXT;
  cat_abonnement TEXT;
  cat_impots TEXT;
  cat_autre TEXT;
  t_courses TEXT;
BEGIN
  -- Noms exacts des catégories système seedées par prisma/seed.ts.
  SELECT id INTO cat_alimentation FROM "category" WHERE household_id IS NULL AND name = 'Alimentation' LIMIT 1;
  SELECT id INTO cat_transport FROM "category" WHERE household_id IS NULL AND name = 'Transport' LIMIT 1;
  SELECT id INTO cat_maison FROM "category" WHERE household_id IS NULL AND name = 'Personnel maison' LIMIT 1;
  SELECT id INTO cat_sante FROM "category" WHERE household_id IS NULL AND name = 'Santé' LIMIT 1;
  SELECT id INTO cat_ecole FROM "category" WHERE household_id IS NULL AND name = 'École' LIMIT 1;
  SELECT id INTO cat_vetements FROM "category" WHERE household_id IS NULL AND name = 'Vêtements' LIMIT 1;
  SELECT id INTO cat_loisirs FROM "category" WHERE household_id IS NULL AND name = 'Loisirs' LIMIT 1;
  SELECT id INTO cat_vacances FROM "category" WHERE household_id IS NULL AND name = 'Vacances' LIMIT 1;
  SELECT id INTO cat_abonnement FROM "category" WHERE household_id IS NULL AND name = 'Abonnements' LIMIT 1;
  SELECT id INTO cat_impots FROM "category" WHERE household_id IS NULL AND name = 'Impôts / taxes' LIMIT 1;
  SELECT id INTO cat_autre FROM "category" WHERE household_id IS NULL AND name = 'Autre' LIMIT 1;

  IF cat_alimentation IS NOT NULL THEN
    INSERT INTO "category_type" (id, category_id, household_id, name, is_system, active)
      VALUES (gen_random_uuid(), cat_alimentation, NULL, 'Courses', true, true) RETURNING id INTO t_courses;
    INSERT INTO "category_type" (id, category_id, household_id, name, is_system, active) VALUES
      (gen_random_uuid(), cat_alimentation, NULL, 'Restaurant', true, true);

    INSERT INTO "category_subtype" (id, category_type_id, household_id, name, is_system, active) VALUES
      (gen_random_uuid(), t_courses, NULL, 'Viande', true, true),
      (gen_random_uuid(), t_courses, NULL, 'Fruits & légumes', true, true),
      (gen_random_uuid(), t_courses, NULL, 'Épicerie', true, true),
      (gen_random_uuid(), t_courses, NULL, 'Produits ménagers', true, true),
      (gen_random_uuid(), t_courses, NULL, 'Boulangerie', true, true),
      (gen_random_uuid(), t_courses, NULL, 'Autre', true, true);
  END IF;

  IF cat_transport IS NOT NULL THEN
    INSERT INTO "category_type" (id, category_id, household_id, name, is_system, active) VALUES
      (gen_random_uuid(), cat_transport, NULL, 'Carburant', true, true),
      (gen_random_uuid(), cat_transport, NULL, 'Parking', true, true);
  END IF;

  IF cat_maison IS NOT NULL THEN
    INSERT INTO "category_type" (id, category_id, household_id, name, is_system, active) VALUES
      (gen_random_uuid(), cat_maison, NULL, 'Prestataire', true, true);
  END IF;

  IF cat_sante IS NOT NULL THEN
    INSERT INTO "category_type" (id, category_id, household_id, name, is_system, active) VALUES
      (gen_random_uuid(), cat_sante, NULL, 'Santé', true, true);
  END IF;

  IF cat_ecole IS NOT NULL THEN
    INSERT INTO "category_type" (id, category_id, household_id, name, is_system, active) VALUES
      (gen_random_uuid(), cat_ecole, NULL, 'École', true, true);
  END IF;

  IF cat_vetements IS NOT NULL THEN
    INSERT INTO "category_type" (id, category_id, household_id, name, is_system, active) VALUES
      (gen_random_uuid(), cat_vetements, NULL, 'Vêtements', true, true);
  END IF;

  IF cat_loisirs IS NOT NULL THEN
    INSERT INTO "category_type" (id, category_id, household_id, name, is_system, active) VALUES
      (gen_random_uuid(), cat_loisirs, NULL, 'Loisirs', true, true);
  END IF;

  IF cat_vacances IS NOT NULL THEN
    INSERT INTO "category_type" (id, category_id, household_id, name, is_system, active) VALUES
      (gen_random_uuid(), cat_vacances, NULL, 'Vacances', true, true);
  END IF;

  IF cat_abonnement IS NOT NULL THEN
    INSERT INTO "category_type" (id, category_id, household_id, name, is_system, active) VALUES
      (gen_random_uuid(), cat_abonnement, NULL, 'Abonnement', true, true);
  END IF;

  IF cat_impots IS NOT NULL THEN
    INSERT INTO "category_type" (id, category_id, household_id, name, is_system, active) VALUES
      (gen_random_uuid(), cat_impots, NULL, 'Impôts / taxes', true, true);
  END IF;

  IF cat_autre IS NOT NULL THEN
    INSERT INTO "category_type" (id, category_id, household_id, name, is_system, active) VALUES
      (gen_random_uuid(), cat_autre, NULL, 'Autre', true, true);
  END IF;

  -- Paiement facture n'a pas de catégorie système dédiée univoque : rattaché à
  -- "Autre" s'il existe, sinon ignoré silencieusement (pas de catégorie système
  -- appelée "Facture"/"Paiement" trouvée à ce jour — aucune casse, migration additive).
  IF cat_autre IS NOT NULL THEN
    INSERT INTO "category_type" (id, category_id, household_id, name, is_system, active) VALUES
      (gen_random_uuid(), cat_autre, NULL, 'Paiement facture', true, true);
  END IF;
END $$;
