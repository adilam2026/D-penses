import { IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

/** R5 §2 — Modifier un plan : identité/période uniquement, jamais planType (structurel, fixé à la création). */
export class UpdateFinancialPlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

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
