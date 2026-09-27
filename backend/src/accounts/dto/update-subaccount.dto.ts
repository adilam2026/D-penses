import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateSubaccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  /** Désactivation/réactivation logique (§10) — le solde/l'historique ne sont jamais perdus. */
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
