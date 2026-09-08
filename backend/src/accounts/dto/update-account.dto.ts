import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

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
}
