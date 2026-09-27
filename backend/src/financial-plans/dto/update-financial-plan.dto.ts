import { IsOptional, IsString, MinLength } from 'class-validator';

/** Modifier un plan (§13) — libellé et compte lié uniquement, jamais les échéances/postes ici. */
export class UpdateFinancialPlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  subaccountId?: string;
}
