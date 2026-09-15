import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsISO8601, IsNumber, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

const RECURRENCE_VALUES = ['ponctuel', 'hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel'] as const;

/** M8 (guard-rail §12) — un abonnement : jamais mensuel imposé par défaut. */
export class SubscriptionsWizardItemDto {
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

/**
 * guard-rail §12 — le Plan Abonnements est une vue regroupée, sans référentiel
 * dédié (contrairement à Voiture/Maison) : le moteur financier reste celui des
 * charges récurrentes existant.
 */
export class SubscriptionsWizardDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SubscriptionsWizardItemDto)
  items!: SubscriptionsWizardItemDto[];
}
