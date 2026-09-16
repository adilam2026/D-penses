import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';

const RECURRENCE_VALUES = ['ponctuel', 'hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel'] as const;

/**
 * M7 (guard-rail §6/§7/§10) — un poste du Plan Voiture (Assurance, Vidange,
 * Réparation...) : la périodicité est TOUJOURS choisie par l'utilisateur, jamais
 * déterminée par les suggestions (mêmes valeurs que RecurrenceFrequency existant,
 * jamais un moteur parallèle).
 */
export class VehicleWizardItemDto {
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

/** guard-rail §10 — sélection d'un véhicule existant OU création (nom uniquement). */
export class VehicleWizardDto {
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  vehicleName?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VehicleWizardItemDto)
  items!: VehicleWizardItemDto[];

  /** Corrections UI/UX (point 3) — même garde-fou anti-doublon que l'école. */
  @IsOptional()
  @IsBoolean()
  confirmDuplicate?: boolean;
}
