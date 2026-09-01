import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateAccountDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsIn(['courant', 'epargne', 'especes', 'autre'])
  type!: 'courant' | 'epargne' | 'especes' | 'autre';

  @IsOptional()
  @IsBoolean()
  includeInOperationalTreasury?: boolean;

  @IsOptional()
  @IsBoolean()
  isProtected?: boolean;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  /** Solde déclaré à la création — crée le premier AccountBalanceSnapshot (RG-080). */
  @IsOptional()
  @IsNumber()
  initialBalance?: number;
}
