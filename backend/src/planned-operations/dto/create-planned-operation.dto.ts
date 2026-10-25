import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { PlannedOperationKind, ResponsibleSource } from '@prisma/client';

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

  /** Lot "À faire" — RESPONSABLE ≠ SOURCE, jamais déduit des champs source/destination ci-dessus. */
  @IsOptional()
  @IsString()
  responsibleMemberId?: string;

  /** Lot "refonte Planning/À faire" §1 — AUTO (hérité du propriétaire du compte, le mobile pose ce flag quand l'utilisateur n'a jamais touché le champ Responsable) / MANUAL (choix explicite, protégé des cascades futures). Omis -> MANUAL (défaut sûr, cf. service). */
  @IsOptional()
  @IsEnum(ResponsibleSource)
  responsibleSource?: ResponsibleSource;

  @IsOptional()
  @IsBoolean()
  includeInTodo?: boolean;
}
