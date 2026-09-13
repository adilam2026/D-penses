-- CreateEnum
CREATE TYPE "MonthMode" AS ENUM ('calendaire', 'financier', 'personnalise');

-- AlterTable: variable_budget — DEFAULT couvre toutes les lignes existantes
-- (aucune n'avait de notion de mode mensuel avant ce lot ; calendaire = comportement
-- civil déjà en vigueur, donc rétrocompatible à l'identique).
ALTER TABLE "variable_budget" ADD COLUMN     "custom_start_day" INTEGER,
ADD COLUMN     "month_mode" "MonthMode" NOT NULL DEFAULT 'calendaire';

-- AlterTable: variable_budget_version — month_mode ajouté NULLABLE d'abord (table
-- non vide en production : des segments Lot 4 existent déjà), backfillé
-- explicitement à 'calendaire' (seul mode qui existait avant ce lot pour tout
-- segment déjà clos), puis rendu NOT NULL SANS DEFAULT — même convention que
-- week_start_day sur cette table : toujours fourni explicitement par le service
-- à la création d'un segment, jamais par une valeur par défaut côté DB.
ALTER TABLE "variable_budget_version" ADD COLUMN     "custom_start_day" INTEGER,
ADD COLUMN     "financial_closing_day_snapshot" INTEGER,
ADD COLUMN     "month_mode" "MonthMode";

UPDATE "variable_budget_version" SET "month_mode" = 'calendaire' WHERE "month_mode" IS NULL;

ALTER TABLE "variable_budget_version" ALTER COLUMN "month_mode" SET NOT NULL;
