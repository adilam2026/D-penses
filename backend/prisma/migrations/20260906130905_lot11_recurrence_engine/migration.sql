-- Lot 11 (§1 refonte UX) — moteur de récurrence commun Revenus + Charges.
-- Aucune formule financière modifiée : ajout additif uniquement, aucune colonne
-- existante touchée, aucune donnée existante réécrite.

-- IncomeSource : date d'ancrage de la récurrence ("jour habituel de versement").
-- NULL par défaut = aucune génération automatique tant que non configuré (RG :
-- ne jamais deviner un jour habituel pour une source déjà existante).
ALTER TABLE "income_source" ADD COLUMN "recurrence_anchor_date" DATE;

-- Anti-doublon (ensureIncomeOccurrencesUntil / createMany skipDuplicates) :
-- vérifié sans conflit sur les données existantes avant migration.
CREATE UNIQUE INDEX "income_occurrence_income_source_id_usual_date_key"
  ON "income_occurrence"("income_source_id", "usual_date");

-- Anti-doublon (ensureChargeDeadlinesUntil / createMany skipDuplicates) :
-- vérifié sans conflit sur les données existantes avant migration.
CREATE UNIQUE INDEX "deadline_charge_plan_id_due_date_key"
  ON "deadline"("charge_plan_id", "due_date");
