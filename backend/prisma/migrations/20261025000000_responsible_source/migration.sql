-- CreateEnum
CREATE TYPE "ResponsibleSource" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "planned_operation" ADD COLUMN     "responsible_source" "ResponsibleSource" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "recurrence_rule" ADD COLUMN     "responsible_source" "ResponsibleSource" NOT NULL DEFAULT 'MANUAL';

-- Lot "refonte Planning/À faire" §1 (correction prioritaire) — aucune
-- cascade rétroactive sur les données déjà en base : toute ligne existante
-- reste MANUAL (valeur par défaut ci-dessus), qu'elle ait été saisie à la
-- main ou remplie par le précédent backfill owner->responsable — seules les
-- échéances créées/modifiées APRÈS ce lot, avec le flag explicitement posé
-- par le mobile, deviennent AUTO et donc éligibles à la cascade automatique
-- lors d'un futur changement de propriétaire de compte.
