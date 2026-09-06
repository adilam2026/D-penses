import { IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MinLength } from 'class-validator';

const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel'] as const;
const STATUS_VALUES = ['actif', 'inactif'] as const;

/**
 * Recette post-Vague 3 (§5) : modifier une source de revenu existante, et
 * l'arrêter (status=inactif — déjà filtré par ensureIncomeOccurrencesUntil,
 * jamais un second champ dupliqué) sans jamais casser les IncomeOccurrence
 * déjà reçues (status='recu').
 */
export class UpdateIncomeSourceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  @IsOptional()
  @IsUUID()
  beneficiaryUserId?: string | null;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsIn(RECURRENCE_VALUES)
  recurrenceRule?: (typeof RECURRENCE_VALUES)[number];

  @IsOptional()
  @IsISO8601()
  recurrenceAnchorDate?: string | null;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  usualAmount?: number;

  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @IsOptional()
  @IsUUID()
  defaultAccountId?: string;

  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: (typeof STATUS_VALUES)[number];
}
