-- Corrections UI/UX finales §10 — une catégorie utilisée n'est plus jamais
-- bloquée à la suppression (ancien comportement : BadRequestException) : elle
-- est désormais archivée (status=inactive) au lieu d'un refus, jamais un hard
-- delete destructif de l'historique. Additif uniquement, défaut 'active'
-- pour toutes les lignes existantes (aucune catégorie n'est masquée par cette
-- migration).
ALTER TABLE "category" ADD COLUMN "status" "ReferentialStatus" NOT NULL DEFAULT 'active';
