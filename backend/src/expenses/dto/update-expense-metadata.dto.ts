import { IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * R5 clôture §1 — Modifier une dépense réelle : uniquement les champs sans
 * impact sur le ledger (jamais amount/accountId/spentDate, cf. Corriger/Annuler
 * pour ces cas-là) — une dépense réelle a déjà produit un effet réel sur le
 * solde du compte, seule sa description est sûre à modifier directement.
 */
export class UpdateExpenseMetadataDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  categoryTypeId?: string;

  @IsOptional()
  @IsUUID()
  categorySubtypeId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
