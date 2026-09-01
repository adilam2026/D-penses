import { IsISO8601, IsNumber, IsOptional, IsPositive, IsUUID } from 'class-validator';

/** RG-014bis : le compte cible est obligatoire à la confirmation (prévu → reçu). */
export class ConfirmIncomeOccurrenceDto {
  @IsNumber()
  @IsPositive()
  actualAmount!: number;

  @IsOptional()
  @IsISO8601()
  actualDate?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;
}
