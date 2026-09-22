import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Refonte maquette V6B §13 — modification minimale d'un dossier mutuelle
 * (libellé), jamais le montant engagé (déjà lié à la dépense réelle source,
 * cf. AdHocExpense — se corrige via Corriger/Annuler la dépense, pas ici).
 */
export class UpdateMedicalClaimDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  @IsOptional()
  @IsISO8601()
  visitDate?: string;
}
