import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsISO8601, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

const ALLOWED_HORIZON_MONTHS = [3, 6, 12, 24, 36, 60] as const;

export class MonthlyMoveDto {
  @IsUUID()
  deadlineId!: string;

  @IsISO8601()
  newDate!: string;
}

/**
 * POST /projection/monthly/simulate (Round 4 §12/§13). `moves` reste PUREMENT EN
 * MÉMOIRE côté service (dateOverrides de computeProjection) — jamais persisté ici,
 * jamais un déplacement réel (IF-10, distinct de PATCH /deadlines/:id).
 */
export class SimulateMonthlyDto {
  @IsOptional()
  @IsIn(ALLOWED_HORIZON_MONTHS)
  horizonMonths?: number;

  @IsOptional()
  @IsISO8601()
  at?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  incomeAccountIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  expenseAccountIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => MonthlyMoveDto)
  moves?: MonthlyMoveDto[];
}
