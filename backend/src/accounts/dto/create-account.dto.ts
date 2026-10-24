import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AccountOwnerType, AccountType } from '@prisma/client';

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

  /** Propriétaire structuré (lot "responsable automatique") — défaut UNDEFINED si omis. Combinaison validée côté service, jamais seulement côté client. */
  @IsOptional()
  @IsEnum(AccountOwnerType)
  ownerType?: AccountOwnerType;

  /** Requis quand ownerType=INDIVIDUAL, doit être absent/null sinon (validé par le service). */
  @IsOptional()
  @IsString()
  ownerMemberId?: string | null;

  /** Simple libellé d'affichage libre — jamais lu pour déterminer ownerType ni le responsable proposé. */
  @IsOptional()
  @IsString()
  ownerLabel?: string | null;

  /** Solde d'ouverture — crée automatiquement l'OPENING_BALANCE correspondante. */
  @IsOptional()
  openingBalance?: string;

  /** Couleur de carte choisie par l'utilisateur (Lot ciblé §1) — clé de palette prédéfinie, jamais un hex libre. */
  @IsOptional()
  @IsString()
  colorKey?: string;
}
