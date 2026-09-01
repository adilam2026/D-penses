import { IsBoolean, IsISO8601, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

/** §28 : « Mettre de côté » (virtual_allocation). confirmed=false planifie sans effet réel (§16). */
export class ContributeDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsISO8601()
  date?: string;

  @IsOptional()
  @IsString()
  intentionLabel?: string;

  /** Défaut true : « mettre de côté » est par défaut une action réelle immédiate. */
  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;
}
