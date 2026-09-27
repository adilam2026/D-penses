import { IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { PlannedOperationKind } from '@prisma/client';

export class CreatePlannedOperationDto {
  @IsEnum(PlannedOperationKind)
  kind!: PlannedOperationKind;

  @IsString()
  @MinLength(1)
  label!: string;

  @IsDateString()
  expectedDate!: string;

  @IsString()
  expectedAmount!: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  recurrenceRuleId?: string;

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
