import { IsDateString, IsOptional, IsString } from 'class-validator';

export class RealizePlannedOperationDto {
  /** Montant réel — peut différer du montant prévu (ex: prévu 700, réel 820). */
  @IsString()
  actualAmount!: string;

  @IsOptional()
  @IsDateString()
  actualDate?: string;

  @IsOptional()
  @IsString()
  label?: string;
}
