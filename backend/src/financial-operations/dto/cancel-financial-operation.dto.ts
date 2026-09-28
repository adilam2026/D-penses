import { IsOptional, IsString } from 'class-validator';

/** "Annuler" une opération réalisée (§4) — reversal exact construit côté serveur à partir de l'opération d'origine, jamais des valeurs envoyées par le client. */
export class CancelFinancialOperationDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
