import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AccountType } from '@prisma/client';

export class CreateAccountDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  bank?: string;

  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  @IsOptional()
  @IsString()
  ownerMemberId?: string;

  @IsOptional()
  @IsString()
  ownerLabel?: string;

  /** Solde d'ouverture — crée automatiquement l'OPENING_BALANCE correspondante. */
  @IsOptional()
  openingBalance?: string;
}
