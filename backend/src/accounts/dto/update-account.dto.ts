import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AccountType } from '@prisma/client';

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

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

  /** Désactivation/réactivation logique (§8) — jamais de suppression physique d'un compte avec historique. */
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Couleur de carte choisie par l'utilisateur (Lot ciblé §1) — clé de palette prédéfinie, jamais un hex libre. */
  @IsOptional()
  @IsString()
  colorKey?: string;
}
