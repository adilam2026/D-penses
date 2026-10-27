-- Récurrences : identité stable des occurrences (migration ADDITIVE).
-- Aucune occurrence existante n'est modifiée : occurrence_index /
-- series_version restent NULL sur les lignes déjà en base jusqu'à la reprise
-- (outil dédié, simulation d'abord). L'unicité historique
-- (recurrence_rule_id, expected_date) est conservée à ce stade.

-- Jour métier d'origine de la série (1..31) — initialisé depuis l'ancrage.
ALTER TABLE "recurrence_rule" ADD COLUMN "anchor_day" INTEGER;
UPDATE "recurrence_rule" SET "anchor_day" = EXTRACT(DAY FROM "anchor_date")::INTEGER WHERE "anchor_day" IS NULL;
ALTER TABLE "recurrence_rule" ADD CONSTRAINT "recurrence_rule_anchor_day_range" CHECK ("anchor_day" IS NULL OR ("anchor_day" BETWEEN 1 AND 31));

-- Version de la série (incrémentée à chaque changement de cadence).
ALTER TABLE "recurrence_rule" ADD COLUMN "series_version" INTEGER NOT NULL DEFAULT 0;

-- Identité logique d'une occurrence + modification manuelle.
ALTER TABLE "planned_operation" ADD COLUMN "occurrence_index" INTEGER;
ALTER TABLE "planned_operation" ADD COLUMN "series_version" INTEGER;
ALTER TABLE "planned_operation" ADD COLUMN "manually_edited" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "planned_operation" ADD CONSTRAINT "planned_operation_occurrence_index_non_negative" CHECK ("occurrence_index" IS NULL OR "occurrence_index" >= 0);

-- Une occurrence logique (règle, version, n°) n'existe qu'une fois. Les
-- valeurs NULL (ponctuelles, lignes antérieures) ne sont jamais en conflit.
CREATE UNIQUE INDEX "planned_operation_rule_version_index_key" ON "planned_operation"("recurrence_rule_id", "series_version", "occurrence_index");
