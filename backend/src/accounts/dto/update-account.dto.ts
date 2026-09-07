import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * R5 clôture §2 — Modifier/Archiver un compte. `status` est le seul levier
 * d'archivage (jamais de suppression physique, cf. AccountsService.archive) :
 * un compte archivé garde tout son historique, disparaît seulement des
 * sélecteurs de NOUVELLE transaction.
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
}
