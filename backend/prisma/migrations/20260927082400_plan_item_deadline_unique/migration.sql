-- Idempotence des éléments récurrents de plan (§14 Checkpoint 4) : jamais deux
-- planned_operations pour la même paire (item, échéance) — index partiel car
-- la grande majorité des planned_operations n'a ni l'un ni l'autre renseigné.
CREATE UNIQUE INDEX "planned_operation_item_deadline_unique"
  ON "planned_operation" ("financial_plan_item_id", "financial_plan_deadline_id")
  WHERE "financial_plan_item_id" IS NOT NULL AND "financial_plan_deadline_id" IS NOT NULL;
