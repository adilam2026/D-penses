import { IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsPositive, IsUUID, Max, Min } from 'class-validator';

const REFERENCE_PERIOD_VALUES = ['semaine', 'mois'] as const;

/**
 * §14 : modification en cours de période — les BudgetExpense déjà enregistrées
 * ne sont jamais réécrites ; seul le restant se recalcule avec la nouvelle
 * référence. R6.4 (§1) : référencePeriod/weekStartDay/categoryId deviennent
 * également modifiables (déjà de simples colonnes, aucune contrainte
 * d'historique dessus contrairement à referenceAmount déjà géré) — seule la
 * fenêtre de période COURANTE en avant change, l'historique (BudgetExpense)
 * reste daté tel quel.
 */
export class UpdateVariableBudgetDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  referenceAmount?: number;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsIn(REFERENCE_PERIOD_VALUES)
  referencePeriod?: (typeof REFERENCE_PERIOD_VALUES)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weekStartDay?: number;

  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
