-- T3C — AccountTransfer.reverseTransfer() crée un transfert miroir (comptes
-- inversés, même montant) mais ne traçait jusqu'ici AUCUN lien vers l'original
-- (pas même une note texte) et ne bloquait pas un second reverse() sur le même
-- transfert (double miroir = double correction, solde sur-corrigé). Ce champ
-- ferme les deux gaps :
--   - source_transfer_id pointe vers l'original (jamais une réécriture) ;
--   - @unique (nullable, Postgres autorise plusieurs NULL — les transferts
--     normaux ne sont jamais concernés) garantit EN BASE qu'un original ne
--     peut jamais avoir deux miroirs, même en cas de reverse concurrent —
--     filet de sécurité en plus du contrôle métier (ConflictException) dans
--     AccountsService.reverseTransfer().
ALTER TABLE "account_transfer" ADD COLUMN     "source_transfer_id" TEXT;

CREATE UNIQUE INDEX "account_transfer_source_transfer_id_key" ON "account_transfer"("source_transfer_id");

ALTER TABLE "account_transfer" ADD CONSTRAINT "account_transfer_source_transfer_id_fkey" FOREIGN KEY ("source_transfer_id") REFERENCES "account_transfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
