import { IsISO8601, IsNumber, IsOptional, IsPositive } from 'class-validator';

/**
 * §14 : modification en cours de période — seul le montant de référence et/ou
 * la date de fin peuvent changer. Les BudgetExpense déjà enregistrées ne sont
 * jamais réécrites ; seul le restant se recalcule avec la nouvelle référence.
 */
export class UpdateVariableBudgetDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  referenceAmount?: number;

  @IsOptional()
  @IsISO8601()
  endDate?: string;
}
