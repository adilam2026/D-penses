import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateFinancialPlanDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsISO8601()
  periodStart!: string;

  @IsISO8601()
  periodEnd!: string;

  /** Lot 6 (Provision) — schéma déjà prêt, pas de FK tant que Provision n'existe pas. */
  @IsOptional()
  @IsString()
  linkedProvisionId?: string;
}
