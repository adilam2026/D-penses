import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class AnalyzeGoalDto {
  @IsUUID()
  goalId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1095)
  horizonDays?: number;
}
