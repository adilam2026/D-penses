import { IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MinLength } from 'class-validator';

const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel'] as const;

export class CreateIncomeSourceDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsOptional()
  @IsUUID()
  beneficiaryUserId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsIn(RECURRENCE_VALUES)
  recurrenceRule?: (typeof RECURRENCE_VALUES)[number];

  /** Jour habituel de versement (Lot 11, §1) — ancre de ensureIncomeOccurrencesUntil. Absent = pas de génération automatique. */
  @IsOptional()
  @IsISO8601()
  recurrenceAnchorDate?: string;

  @IsNumber()
  @IsPositive()
  usualAmount!: number;

  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @IsUUID()
  defaultAccountId!: string;
}
