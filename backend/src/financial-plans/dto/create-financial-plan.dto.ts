import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PlanItemInput {
  @IsString()
  @MinLength(1)
  label!: string;
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
