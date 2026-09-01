import { IsBoolean, IsISO8601, IsNumber, IsOptional, IsPositive } from 'class-validator';

/** §24 : contribution prévue ≠ réelle — confirmed=false ne modifie jamais la progression réelle (RG-000). */
export class CreateGoalContributionDto {
  @IsISO8601()
  plannedDate!: string;

  @IsNumber()
  @IsPositive()
  plannedAmount!: number;

  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;

  @IsOptional()
  @IsISO8601()
  actualDate?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  actualAmount?: number;
}
