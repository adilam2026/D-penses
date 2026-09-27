import { ArrayMinSize, IsArray, IsDateString, IsEnum, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RecurrenceFrequency } from '@prisma/client';

class PlanItemInput {
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

class PlanDeadlineInput {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsDateString()
  dueDate!: string;
}

/** Ex. Plan Scolarité — items = postes (Frais école, Fournitures...), deadlines = échéances (Janvier). */
export class CreateFinancialPlanDto {
  @IsString()
  @MinLength(1)
  label!: string;

  /** "Compte lié" (§10/§13) — sert à calculer le disponible actuel du plan. */
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  subaccountId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanItemInput)
  items?: PlanItemInput[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => PlanDeadlineInput)
  deadlines?: PlanDeadlineInput[];
}
