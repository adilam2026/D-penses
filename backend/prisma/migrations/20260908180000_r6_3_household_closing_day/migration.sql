-- R6.3 (point A) — jour de clôture financière du foyer. Défaut 31 = clôture
-- au dernier jour du mois : rétrocompatible à l'identique avec le découpage
-- par mois civil déjà utilisé partout (Projection, Home) avant R6.3.
ALTER TABLE "household_settings" ADD COLUMN     "closing_day" INTEGER NOT NULL DEFAULT 31;
