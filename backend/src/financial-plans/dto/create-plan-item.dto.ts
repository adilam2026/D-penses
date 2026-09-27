import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { RecurrenceFrequency } from '@prisma/client';

/** Ajouter un poste au plan (§13/§14) — récurrent (frequency != ONCE) ou ponctuel. */
export class CreatePlanItemDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsOptional()
  @IsString()
  expectedAmount?: string;

  @IsOptional()
  @IsEnum(RecurrenceFrequency)
  frequency?: RecurrenceFrequency;
}
