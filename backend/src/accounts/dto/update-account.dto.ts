import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AccountOwnerType, AccountType } from '@prisma/client';

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

  /** Propriétaire structuré — combinaison avec ownerMemberId validée côté service (merge avec la valeur actuelle si un seul des deux champs est envoyé). */
  @IsOptional()
  @IsEnum(AccountOwnerType)
  ownerType?: AccountOwnerType;

  /** null explicite accepté (ex. Adil -> Commun/Non défini) — distinct de "absent" (champ inchangé). */
  @IsOptional()
  @IsString()
  ownerMemberId?: string | null;

  /** Simple libellé d'affichage libre — jamais lu pour déterminer ownerType ni le responsable proposé. */
  @IsOptional()
  @IsString()
  ownerLabel?: string | null;

  /** Désactivation/réactivation logique (§8) — jamais de suppression physique d'un compte avec historique. */
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Couleur de carte choisie par l'utilisateur (Lot ciblé §1) — clé de palette prédéfinie, jamais un hex libre. */
  @IsOptional()
  @IsString()
  colorKey?: string;
}
