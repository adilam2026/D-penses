-- Corrections consolidées §16 — foyer ACTIF explicite et persistant (jamais
-- déduit implicitement du seul plus ancien membership à chaque connexion).
-- NULL = comportement historique inchangé (repli sur le membership le plus
-- ancien, auth.service.ts#activeHouseholdId).
ALTER TABLE "user"
  ADD COLUMN "active_household_id" TEXT;

ALTER TABLE "user"
  ADD CONSTRAINT "user_active_household_id_fkey"
  FOREIGN KEY ("active_household_id") REFERENCES "household"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
