import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Convergence V6C §1/§2 — un plan financier est désormais un simple
 * regroupement logique de charges (Nom* + Description facultative), plus
 * aucune notion d'objectif/période globale à la création. periodStart/
 * periodEnd restent acceptés (facultatifs, jamais redemandés par la nouvelle
 * UI) uniquement pour ne rien casser côté wizards qui créent leurs plans
 * directement via Prisma (jamais via ce DTO) — le service applique une
 * période large par défaut quand ils sont absents.
 */
export class CreateFinancialPlanDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsISO8601()
  periodStart?: string;

  @IsOptional()
  @IsISO8601()
  periodEnd?: string;

  /** Lot 6 (Provision) — schéma déjà prêt, pas de FK tant que Provision n'existe pas. */
  @IsOptional()
  @IsString()
  linkedProvisionId?: string;
}
