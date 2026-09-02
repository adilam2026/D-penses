import { IsBoolean, IsISO8601, IsInt, IsNumber, IsOptional, IsPositive, IsUUID, Max, Min } from 'class-validator';

export class SimulateGoalContributionDto {
  @IsUUID()
  goalId!: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsISO8601()
  date!: string;

  @IsOptional()
  @IsBoolean()
  recurring?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  dayOfMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  horizonDays?: number;
}
