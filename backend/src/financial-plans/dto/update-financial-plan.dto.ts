import { IsBoolean, IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Convergence V6C §1/§2 — Modifier un plan : label/description/active
 * pilotent désormais la nouvelle UI (simple regroupement de charges).
 * periodStart/periodEnd/destination restent acceptés (compatibilité des
 * anciens plans wizard) mais ne sont plus jamais envoyés par les nouveaux
 * écrans mobile.
 */
export class UpdateFinancialPlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsISO8601()
  periodStart?: string;

  @IsOptional()
  @IsISO8601()
  periodEnd?: string;

  @IsOptional()
  @IsString()
  destination?: string;
}
