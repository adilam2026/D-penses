-- Lot 40 / M5+M6 — bornage facultatif d'un transfert récurrent + couleur
-- d'identification de l'initiateur. Additive uniquement : aucune colonne
-- supprimée, aucune contrainte NOT NULL, aucune donnée existante modifiée.

-- AlterTable
ALTER TABLE "recurring_transfer" ADD COLUMN     "end_date" DATE;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "color" TEXT;
