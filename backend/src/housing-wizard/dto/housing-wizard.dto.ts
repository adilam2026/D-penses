import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';

const RECURRENCE_VALUES = ['ponctuel', 'hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel'] as const;

/** M8 (guard-rail §6/§7/§11) — un poste du Plan Maison, périodicité toujours choisie. */
export class HousingWizardItemDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsOptional()
  @IsNumber()
  amount?: number | null;

  @IsIn(RECURRENCE_VALUES)
  recurrenceRule!: (typeof RECURRENCE_VALUES)[number];

  @IsISO8601()
  dueDate!: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;
}

/** guard-rail §11 — sélection d'un logement existant OU création (nom uniquement). */
export class HousingWizardDto {
  @IsOptional()
  @IsUUID()
  housingId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  housingName?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => HousingWizardItemDto)
  items!: HousingWizardItemDto[];
}
