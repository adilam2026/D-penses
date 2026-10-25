import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { PlannedOperationKind, RecurrenceFrequency, ResponsibleSource } from '@prisma/client';

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

  /** Lot "À faire" — RESPONSABLE ≠ SOURCE, jamais déduit des champs source/destination ci-dessus. */
  @IsOptional()
  @IsString()
  responsibleMemberId?: string;

  /** Lot "refonte Planning/À faire" §1 — cf. CreatePlannedOperationDto. Omis -> MANUAL (défaut sûr, cf. service). */
  @IsOptional()
  @IsEnum(ResponsibleSource)
  responsibleSource?: ResponsibleSource;

  @IsOptional()
  @IsBoolean()
  includeInTodo?: boolean;
}
