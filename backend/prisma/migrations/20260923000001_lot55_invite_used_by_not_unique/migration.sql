-- Corrections consolidées §16 — un utilisateur peut désormais rejoindre plusieurs
-- foyers au fil du temps (changement de foyer actif) : la contrainte d'unicité
-- globale sur used_by_id (héritée du modèle "un seul foyer pour toujours") est
-- supprimée. L'unicité par invitation reste garantie par usedAt + l'update
-- atomique conditionnel (households.service.ts#join), jamais retirée ici.
DROP INDEX "household_invite_used_by_id_key";
