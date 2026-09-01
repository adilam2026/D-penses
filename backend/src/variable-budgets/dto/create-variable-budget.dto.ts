import { IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsPositive, IsUUID, Max, Min } from 'class-validator';

export class CreateVariableBudgetDto {
  @IsUUID()
  categoryId!: string;

  @IsNumber()
  @IsPositive()
  referenceAmount!: number;

  @IsIn(['semaine', 'mois'])
  referencePeriod!: 'semaine' | 'mois';

  /** 1=lundi..7=dimanche (RG-098). Défaut lundi. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weekStartDay?: number;

  @IsISO8601()
  startDate!: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;
}
