import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * R5 clôture §2 — Modifier/Archiver un compte. `status` est le seul levier
 * d'archivage (jamais de suppression physique, cf. AccountsService.archive) :
 * un compte archivé garde tout son historique, disparaît seulement des
 * sélecteurs de NOUVELLE transaction.
 *
 * R6.1 (§6/§8) : `includeInOperationalTreasury` (déjà modélisé et déjà consommé
 * par treasury.util.ts/monthly-projection.util.ts depuis le Lot 5) était jusqu'ici
 * réglable uniquement à la création — jamais modifiable après coup. Même règle
 * que `status` : jamais de suppression, un simple bascule qui exclut le compte
 * des calculs de pilotage (trésorerie/disponible libre/projection) sans jamais
 * toucher son solde ni son historique.
 */
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(['courant', 'epargne', 'especes', 'autre'])
  type?: 'courant' | 'epargne' | 'especes' | 'autre';

  @IsOptional()
  @IsIn(['actif', 'archive'])
  status?: 'actif' | 'archive';

  @IsOptional()
  @IsBoolean()
  includeInOperationalTreasury?: boolean;

  /**
   * Corrections consolidées §5 — solde masqué par défaut à l'ouverture de
   * l'app, mémorisé compte par compte. Purement visuel, jamais lu par un
   * moteur financier.
   */
  @IsOptional()
  @IsBoolean()
  hideBalanceByDefault?: boolean;

  /**
   * Corrections consolidées §6 — visibilité sur l'accueil, INDÉPENDANTE de
   * includeInOperationalTreasury : un compte peut être piloté et absent de
   * "Mes comptes" (Accueil), ou hors pilotage et quand même affiché.
   */
  @IsOptional()
  @IsBoolean()
  showOnHome?: boolean;

  /** Refonte maquette V6B — nom de banque affiché séparément. */
  @IsOptional()
  @IsString()
  bankName?: string;

  /** Refonte maquette V6B §5 — propriétaire affiché ("CIH • Lamiaa"), simple libellé dérivé de User.firstName. */
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  /** Refonte maquette V6B §2C — voir CreateAccountDto.isDedicated. */
  @IsOptional()
  @IsBoolean()
  isDedicated?: boolean;

  @IsOptional()
  @IsUUID()
  dedicatedCategoryId?: string;
}
