import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { PlannedOperationKind, RecurrenceFrequency } from '@prisma/client';

export class CreateRecurrenceRuleDto {
  @IsEnum(RecurrenceFrequency)
  frequency!: RecurrenceFrequency;

  @IsDateString()
  anchorDate!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsEnum(PlannedOperationKind)
  kind!: PlannedOperationKind;

  @IsString()
  expectedAmount!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  financialPlanItemId?: string;

  @IsOptional()
  @IsString()
  financialPlanDeadlineId?: string;

  @IsOptional()
  @IsString()
  sourceAccountId?: string;

  @IsOptional()
  @IsString()
  sourceSubaccountId?: string;

  @IsOptional()
  @IsString()
  destinationAccountId?: string;

  @IsOptional()
  @IsString()
  destinationSubaccountId?: string;
}
