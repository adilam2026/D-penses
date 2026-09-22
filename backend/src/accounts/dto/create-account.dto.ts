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

  /** Refonte maquette V6B — nom de banque affiché séparément ("CIH • LAMIAA"). */
  @IsOptional()
  @IsString()
  bankName?: string;

  /**
   * Refonte maquette V6B §2C — marque ce compte comme "compte dédié" à une
   * catégorie de dépense (ex. Courses). Marqueur d'affichage uniquement :
   * l'alimentation réelle passe par un AccountTransfer/RecurringTransfer
   * ordinaire (aucun nouveau moteur de mouvement).
   */
  @IsOptional()
  @IsBoolean()
  isDedicated?: boolean;

  @IsOptional()
  @IsUUID()
  dedicatedCategoryId?: string;
}
