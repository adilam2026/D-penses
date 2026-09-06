-- Lot 12 (§4 cadrage V1) — une enveloppe virtual_allocation peut désormais déclarer
-- un linked_account_id INFORMATIF (localisation déclarée, jamais utilisée par
-- computePocketCurrentAmount ni computeReservedAmounts pour ce mode — RG-071
-- inchangée sur le calcul, seule la contrainte d'exclusion mutuelle est relâchée).
-- backed_by_account continue d'EXIGER linked_account_id (inchangé).

ALTER TABLE "savings_pocket" DROP CONSTRAINT "savings_pocket_allocation_consistency";
ALTER TABLE "savings_pocket" ADD CONSTRAINT "savings_pocket_allocation_consistency" CHECK (
  "allocation_mode" != 'backed_by_account' OR "linked_account_id" IS NOT NULL
);

ALTER TABLE "provision" DROP CONSTRAINT "provision_allocation_consistency";
ALTER TABLE "provision" ADD CONSTRAINT "provision_allocation_consistency" CHECK (
  "allocation_mode" != 'backed_by_account' OR "linked_account_id" IS NOT NULL
);
