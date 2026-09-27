import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { RecurrenceFrequency } from '@prisma/client';

export class CreateRecurrenceRuleDto {
  @IsEnum(RecurrenceFrequency)
  frequency!: RecurrenceFrequency;

  @IsDateString()
  anchorDate!: string;

  @IsOptional()
  @IsString()
  label?: string;
}
