import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel'] as const;
const OBLIGATION_VALUES = ['obligatoire', 'optionnelle_envisagee', 'optionnelle_souscrite', 'optionnelle_refusee'] as const;

export class CreateChargePlanDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  // Lot 2 : seul auto_frequence est implémenté (calendrier_manuel = Lot 4).
  @IsOptional()
  @IsIn(['auto_frequence'])
  generationMode?: 'auto_frequence';

  @IsOptional()
  @IsIn(RECURRENCE_VALUES)
  recurrenceRule?: (typeof RECURRENCE_VALUES)[number];

  @IsOptional()
  @IsUUID()
  defaultAccountId?: string;

  @IsOptional()
  @IsIn(OBLIGATION_VALUES)
  obligationStatus?: (typeof OBLIGATION_VALUES)[number];

  @IsISO8601()
  startDate!: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  priorityLevel?: number;
}
