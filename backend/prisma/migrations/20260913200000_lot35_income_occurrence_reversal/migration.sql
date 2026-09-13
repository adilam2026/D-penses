-- T3A — historique des annulations (unconfirm) d'une IncomeOccurrence : une
-- NOUVELLE ligne à chaque appel, jamais une mise à jour (plusieurs cycles
-- confirm/unconfirm sur la même occurrence restent tous consultables via
-- GET /income-occurrences/:id/reversals). N'impacte ni ledger_entry, ni le
-- solde, ni la projection — IncomeOccurrence garde exactement son
-- comportement actuel (status→prevu, actual_*→null), cette table n'est
-- qu'une trace consultée à part.
--
-- Pas de ON DELETE CASCADE sur income_occurrence_id (volontaire, prisma en
-- infère RESTRICT par défaut) : IncomeOccurrence peut être supprimée
-- physiquement (cascade depuis IncomeSource.delete), mais IncomeService.
-- removeSource() bloque déjà toute suppression dès qu'une occurrence de la
-- source a un historique de réversion (nouveau garde-fou, même message clair
-- que le garde-fou existant sur les occurrences 'recu') ; la contrainte FK
-- RESTRICT reste un filet de sécurité pour qu'aucun futur appel ne puisse
-- effacer silencieusement cet audit.
CREATE TABLE "income_occurrence_reversal" (
    "id" TEXT NOT NULL,
    "income_occurrence_id" TEXT NOT NULL,
    "actual_amount" DECIMAL(14,2) NOT NULL,
    "actual_date" TIMESTAMP(3) NOT NULL,
    "confirmed_by_user_id" TEXT,
    "reversed_by_user_id" TEXT NOT NULL,
    "reversed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "income_occurrence_reversal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "income_occurrence_reversal_income_occurrence_id_reversed_at_idx" ON "income_occurrence_reversal"("income_occurrence_id", "reversed_at");

ALTER TABLE "income_occurrence_reversal" ADD CONSTRAINT "income_occurrence_reversal_income_occurrence_id_fkey" FOREIGN KEY ("income_occurrence_id") REFERENCES "income_occurrence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "income_occurrence_reversal" ADD CONSTRAINT "income_occurrence_reversal_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "income_occurrence_reversal" ADD CONSTRAINT "income_occurrence_reversal_reversed_by_user_id_fkey" FOREIGN KEY ("reversed_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS — même pattern exact que income_occurrence (jointure via income_source.household_id
-- contre la GUC app.current_household_id, cf. migration lot2_revenus_charges_paiements).
ALTER TABLE "income_occurrence_reversal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "income_occurrence_reversal" FORCE ROW LEVEL SECURITY;
CREATE POLICY income_occurrence_reversal_context ON "income_occurrence_reversal"
  FOR ALL
  USING ("income_occurrence_id" IN (
    SELECT io.id FROM "income_occurrence" io
    JOIN "income_source" isrc ON isrc.id = io."income_source_id"
    WHERE isrc."household_id" = current_setting('app.current_household_id', true)
  ))
  WITH CHECK ("income_occurrence_id" IN (
    SELECT io.id FROM "income_occurrence" io
    JOIN "income_source" isrc ON isrc.id = io."income_source_id"
    WHERE isrc."household_id" = current_setting('app.current_household_id', true)
  ));
