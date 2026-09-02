import { IsBoolean, IsISO8601, IsInt, IsOptional, Max, Min } from 'class-validator';

export class SavingsCapacityDto {
  @IsOptional()
  @IsBoolean()
  recurring?: boolean;

  @IsOptional()
  @IsISO8601()
  date?: string;

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
