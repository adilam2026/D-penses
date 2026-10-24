-- CreateEnum
CREATE TYPE "AccountOwnerType" AS ENUM ('INDIVIDUAL', 'SHARED', 'UNDEFINED');

-- AlterTable
ALTER TABLE "account" ADD COLUMN     "owner_type" "AccountOwnerType" NOT NULL DEFAULT 'UNDEFINED';

-- Backfill cohérent avec les données déjà en base (jamais une valeur
-- inventée) : un compte qui a déjà un propriétaire individuel structuré
-- (owner_member_id déjà renseigné) devient INDIVIDUAL ; tous les autres
-- restent UNDEFINED — jamais SHARED par défaut, aucune donnée existante ne
-- permet de distinguer "Commun" de "non défini".
UPDATE "account" SET "owner_type" = 'INDIVIDUAL' WHERE "owner_member_id" IS NOT NULL;
