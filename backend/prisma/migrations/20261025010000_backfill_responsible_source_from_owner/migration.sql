-- Lot "refonte Planning/À faire" — correction du backfill (retour recette) :
-- la migration précédente (20261025000000_responsible_source) laissait
-- TOUTE donnée existante à responsible_source=MANUAL par défaut, y compris
-- les échéances sans aucun responsable défini — ce qui empêchait le cas
-- réel rapporté ("Courses" sur "Adil Compte Principal", responsable encore
-- vide, propriétaire du compte défini APRÈS coup) de jamais se corriger
-- automatiquement. Règle corrigée, appliquée ICI une fois pour toute donnée
-- déjà en base au moment de ce lot (jamais rejouée ensuite) :
--
--  1) responsible_member_id déjà renseigné -> MANUAL, jamais réécrit.
--  2) PENDING + responsible_member_id NULL + compte réel source
--     (source_account_id remonte déjà au compte parent même pour une
--     enveloppe/sous-compte) owner_type=INDIVIDUAL -> AUTO et responsable
--     = ce membre.
--  3) PENDING + responsible_member_id NULL, compte SHARED/UNDEFINED ou sans
--     source -> AUTO, responsable reste NULL ("Responsable à définir",
--     mais désormais éligible à une cascade future).
--  4) REALIZED/CANCELLED : jamais touchées (restent au défaut MANUAL posé
--     par la migration précédente) — aucune donnée ni historique financier
--     modifié.
--
-- Après ce backfill, un changement ultérieur du propriétaire du compte
-- recalcule automatiquement (AccountsService#update, déjà en place) toutes
-- les échéances PENDING/règles actives désormais marquées AUTO.

-- 1) Protection explicite — ne doit jamais être réécrit par ce qui suit.
UPDATE "planned_operation" SET "responsible_source" = 'MANUAL' WHERE "responsible_member_id" IS NOT NULL;
UPDATE "recurrence_rule" SET "responsible_source" = 'MANUAL' WHERE "responsible_member_id" IS NOT NULL;

-- 2) Hérite du propriétaire structuré du compte réel source, uniquement
--    pour les échéances futures/non exécutées (PENDING) encore sans
--    responsable.
UPDATE "planned_operation" po
SET "responsible_source" = 'AUTO', "responsible_member_id" = acc."owner_member_id"
FROM "account" acc
WHERE po."source_account_id" = acc."id"
  AND po."status" = 'PENDING'
  AND po."responsible_member_id" IS NULL
  AND acc."owner_type" = 'INDIVIDUAL';

UPDATE "recurrence_rule" rr
SET "responsible_source" = 'AUTO', "responsible_member_id" = acc."owner_member_id"
FROM "account" acc
WHERE rr."source_account_id" = acc."id"
  AND rr."responsible_member_id" IS NULL
  AND acc."owner_type" = 'INDIVIDUAL';

-- 3) Toute autre échéance PENDING / règle encore sans responsable (compte
--    SHARED/UNDEFINED, ou sans compte source du tout) devient AUTO sans
--    responsable (reste NULL) — jamais figée à MANUAL par défaut, pour
--    rester éligible à une cascade future dès qu'un propriétaire sera défini.
UPDATE "planned_operation" SET "responsible_source" = 'AUTO' WHERE "status" = 'PENDING' AND "responsible_member_id" IS NULL AND "responsible_source" <> 'AUTO';
UPDATE "recurrence_rule" SET "responsible_source" = 'AUTO' WHERE "responsible_member_id" IS NULL AND "responsible_source" <> 'AUTO';
