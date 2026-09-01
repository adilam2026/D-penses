import { IsInt, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min, MinLength } from 'class-validator';

export class CreateGoalDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsNumber()
  @IsPositive()
  targetAmount!: number;

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
}
