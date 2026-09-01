import { IsDateString, IsNumber, IsOptional, IsPositive, IsUUID } from 'class-validator';

export class CreateTransferDto {
  @IsOptional()
  @IsUUID()
  fromAccountId?: string;

  @IsOptional()
  @IsUUID()
  toAccountId?: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  /** Défaut : aujourd'hui. Une date future crée un transfert `prevu` (document 03 §I.12). */
  @IsOptional()
  @IsDateString()
  plannedDate?: string;
}
