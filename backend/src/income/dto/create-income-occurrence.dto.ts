import { IsISO8601, IsNumber, IsOptional, IsPositive } from 'class-validator';

export class CreateIncomeOccurrenceDto {
  @IsISO8601()
  usualDate!: string;

  /** Si omis, reprend IncomeSource.usualAmount. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  plannedAmount?: number;
}
