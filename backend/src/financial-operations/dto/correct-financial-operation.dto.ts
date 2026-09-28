import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * "Modifier" une opération réalisée (§4) — jamais une mutation de la ligne
 * d'origine (immutabilité du ledger) : reversal de l'originale + nouvelle
 * opération corrigée, liées via correction_of_operation_id, dans une seule
 * transaction atomique. kind/comptes source-destination proviennent de
 * l'opération d'origine (pas modifiables ici) — seuls label/date/montant/
 * catégorie sont ajustables.
 */
export class CorrectFinancialOperationDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsDateString()
  date!: string;

  @IsString()
  amount!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
