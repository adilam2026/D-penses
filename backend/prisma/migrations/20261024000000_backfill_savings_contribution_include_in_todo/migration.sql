-- Backfill contrôlé (lot "À faire" — correction recette) : les échéances et
-- règles de récurrence de VERSEMENT (SAVINGS_CONTRIBUTION) déjà en base avant
-- le développement de "À faire" rejoignent la checklist par défaut, comme
-- toute nouvelle SAVINGS_CONTRIBUTION créée depuis ce lot. Aucune DÉPENSE ni
-- aucun REVENU existant n'est jamais activé automatiquement (include_in_todo
-- y reste false), et aucun responsable n'est jamais inventé ici
-- (responsible_member_id n'est jamais touché par ce backfill) : une action
-- ainsi activée reste visible dans "Tous" avec "Responsable à définir"
-- jusqu'à affectation explicite.

UPDATE "planned_operation"
SET "include_in_todo" = true
WHERE "kind" = 'SAVINGS_CONTRIBUTION' AND "include_in_todo" = false;

UPDATE "recurrence_rule"
SET "include_in_todo" = true
WHERE "kind" = 'SAVINGS_CONTRIBUTION' AND "include_in_todo" = false;
