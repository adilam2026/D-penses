-- Couleur de carte choisie par l'utilisateur (Lot ciblé §1) — additive uniquement,
-- aucune donnée existante modifiée ou supprimée. NULL = compte créé avant cette
-- fonctionnalité, le mobile retombe sur une rotation automatique.
ALTER TABLE "account" ADD COLUMN "color_key" TEXT;
