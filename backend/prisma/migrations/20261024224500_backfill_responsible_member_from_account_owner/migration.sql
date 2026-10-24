-- Backfill contrôlé (lot "responsable automatique" — correction recette) :
-- les SAVINGS_CONTRIBUTION déjà basculées includeInTodo=true par le lot
-- précédent, et dont le responsable n'a jamais été défini, reçoivent le
-- propriétaire STRUCTURÉ de leur compte source — UNIQUEMENT quand ce compte
-- a un propriétaire INDIVIDUAL (jamais déduit du nom du compte, de la
-- banque, d'ownerLabel ou du libellé de l'échéance). Un compte SHARED ou
-- UNDEFINED laisse responsible_member_id strictement inchangé (null).
--
-- Même règle pour RecurrenceRule (gabarit), pour que les occurrences FUTURES
-- générées après ce backfill héritent elles aussi du bon responsable —
-- sinon le problème reviendrait au mois suivant (cf. lot "À faire" §19).

UPDATE "planned_operation" po
SET "responsible_member_id" = acc."owner_member_id"
FROM "account" acc
WHERE po."source_account_id" = acc."id"
  AND po."kind" = 'SAVINGS_CONTRIBUTION'
  AND po."responsible_member_id" IS NULL
  AND acc."owner_type" = 'INDIVIDUAL'
  AND acc."owner_member_id" IS NOT NULL;

UPDATE "recurrence_rule" rr
SET "responsible_member_id" = acc."owner_member_id"
FROM "account" acc
WHERE rr."source_account_id" = acc."id"
  AND rr."kind" = 'SAVINGS_CONTRIBUTION'
  AND rr."responsible_member_id" IS NULL
  AND acc."owner_type" = 'INDIVIDUAL'
  AND acc."owner_member_id" IS NOT NULL;
