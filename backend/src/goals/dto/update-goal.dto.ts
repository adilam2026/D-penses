import { IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min, MinLength } from 'class-validator';

const STATUS_VALUES = ['en_cours', 'en_pause', 'atteint', 'abandonne'] as const;

export class UpdateGoalDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  targetAmount?: number;

  @IsOptional()
  @IsISO8601()
  targetDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  priorityLevel?: number;

  @IsOptional()
  @IsUUID()
  linkedPocketId?: string;

  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: (typeof STATUS_VALUES)[number];
}
